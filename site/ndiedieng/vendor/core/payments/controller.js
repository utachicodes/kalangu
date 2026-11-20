/**
 * Payment controller (docs/payments-design.md §4.3, §5, §6).
 *
 * Owns the money-moving steps that sit between the engine and the provider
 * port: offer (policy + operator resolution), begin (re-check and record),
 * initiate, and settle (check-status, never trust a callback alone).
 * It knows nothing about screens or sessions; the engine passes it plain
 * values and gets plain results back.
 */
import { createPolicyCheck, fromMinorUnits, toMinorUnits } from "./policy.js";
import { isFinalPaymentStatus } from "./store.js";
export const DEFAULT_POLL_SCHEDULE_MS = [60_000, 120_000, 300_000, 900_000, 3_600_000];
export const DEFAULT_GIVE_UP_AFTER_MS = 72 * 3_600_000;
export const DEFAULT_POLL_REPEAT_MS = 3_600_000;
/** After this many failed deliveries the outcome stays in the store for a human. */
export const MAX_NOTIFY_ATTEMPTS = 5;
const DAY_MS = 24 * 3_600_000;
const NON_FINAL = ["CREATED", "ACCEPTED", "PROCESSING", "IN_RECONCILIATION", "UNKNOWN"];
export function createPaymentController(config, deps) {
    const { provider, store } = config;
    const { clock, logger, mask } = deps;
    const policy = buildPolicy(config.policy);
    const schedule = config.pollScheduleMs ?? DEFAULT_POLL_SCHEDULE_MS;
    const giveUpAfterMs = config.giveUpAfterMs ?? DEFAULT_GIVE_UP_AFTER_MS;
    const pollRepeatMs = config.pollRepeatMs ?? DEFAULT_POLL_REPEAT_MS;
    const newId = config.newId ?? (() => globalThis.crypto.randomUUID());
    // Saves duplicate provider calls when one process settles the same payment
    // twice at once. Correctness across processes does not depend on it: that
    // comes from the store's `transition`, `claimNotification` and `withPhoneLock`.
    const settling = new Map();
    const sleep = (ms) => new Promise((resolve) => clock.setTimeout(resolve, ms));
    async function checkPolicy(phone, amount, currency) {
        const totals = await store.totals(phone, currency, clock.now() - DAY_MS);
        const refusal = policy.check({
            amount,
            currency,
            pendingCount: totals.pendingCount,
            completedTodayMinorUnits: toMinorUnits(totals.pending, currency) + toMinorUnits(totals.completed, currency),
        });
        if (refusal) {
            logger.info("Payment refused by policy", { phone: mask(phone), amount, currency, rule: refusal.reason });
            return { ok: false, reason: refusal.reason, message: refusal.message };
        }
        return null;
    }
    async function finalize(payment) {
        // Only a final payment has an outcome to announce. A record that moved on to another
        // non-final status while a caller held an older view must never be announced as done.
        if (!isFinalPaymentStatus(payment.status))
            return;
        if (payment.notifiedAt !== undefined)
            return;
        // Claim first, atomically: of any number of racing callers, one wins.
        const claimed = await store.claimNotification(payment.id, clock.now());
        if (!claimed)
            return;
        try {
            await deps.onFinal(claimed);
        }
        catch (err) {
            // Give the claim back, so the next reconcile sweep tries again instead of
            // the user never hearing the outcome.
            await store.releaseNotification(payment.id);
            const attempts = (claimed.notifyAttempts ?? 0) + 1;
            logger.error(attempts >= MAX_NOTIFY_ATTEMPTS
                ? "Payment outcome could not be delivered; giving up, it stays in the store"
                : "Payment outcome could not be delivered; reconcile will retry", { payment: payment.id, phone: mask(payment.phone), attempts, error: describe(err) });
        }
    }
    /**
     * Records a status. `from` is what the caller's decision was based on; it defaults to any
     * non-final status, which keeps a final status final. A conclusion drawn from one observation
     * (the provider has never seen it) passes that observation's status, so it cannot overwrite
     * newer state another process recorded in the meantime.
     */
    async function apply(id, status, failureCode, from = NON_FINAL) {
        const final = isFinalPaymentStatus(status);
        const next = await store.transition(id, {
            status,
            ...(failureCode !== undefined ? { failureCode } : {}),
            ...(final ? { finalizedAt: clock.now() } : {}),
        }, from);
        if (!next) {
            // Already final: someone else got there first. Their outcome stands.
            const current = await store.get(id);
            if (!current)
                throw new Error(`Payment ${id} not found`);
            await finalize(current);
            return current;
        }
        if (final)
            await finalize(next);
        return next;
    }
    async function settleOnce(id) {
        const current = await store.get(id);
        if (!current)
            return null;
        if (isFinalPaymentStatus(current.status)) {
            await finalize(current); // Delivers an outcome missed by a crash; no-op otherwise.
            return current;
        }
        const result = await provider.status(id);
        if (!result.found) {
            // The provider has never seen it. Only safe to fail if initiation was unconfirmed.
            if (current.status === "UNKNOWN")
                return apply(id, "FAILED", "NOT_FOUND", ["UNKNOWN"]);
            return current;
        }
        if (!result.status || result.status === current.status)
            return current;
        return apply(id, result.status);
    }
    /** Initiates with the provider and records what it said. Never fails a payment on a guess. */
    async function initiate(payment) {
        let outcome = "UNKNOWN";
        let failureCode;
        try {
            const result = await provider.initiate(payment);
            failureCode = result.failureCode;
            if (result.status === "ACCEPTED" || result.status === "DUPLICATE_IGNORED")
                outcome = "ACCEPTED";
            else if (result.status === "REJECTED")
                outcome = "REJECTED";
        }
        catch (err) {
            // Network or provider failure: the money may or may not have moved.
            logger.error("Payment initiation outcome unknown", { payment: payment.id, error: describe(err) });
        }
        return apply(payment.id, outcome, failureCode);
    }
    async function giveUp(payment) {
        logger.error("Payment unresolved: no final status within the give-up window", {
            payment: payment.id,
            phone: mask(payment.phone),
        });
        return apply(payment.id, "UNRESOLVED");
    }
    return {
        payeeName: config.payeeName,
        async offer(phone, spec) {
            const refused = await checkPolicy(phone, spec.amount, spec.currency);
            if (refused)
                return refused;
            const choice = await provider.resolve(phone, spec.amount, spec.currency);
            if ("kind" in choice) {
                logger.info("Payment refused by provider", { phone: mask(phone), rule: choice.kind });
                return { ok: false, reason: choice.kind, message: choice.message };
            }
            return {
                ok: true,
                offer: {
                    amount: spec.amount,
                    currency: spec.currency,
                    reason: spec.reason,
                    provider: choice.provider,
                    providerPhone: choice.phone,
                },
            };
        },
        begin(phone, offer, where) {
            // Check and create under one lock, or two simultaneous "Yes" answers
            // could both pass a limit that only one of them should.
            return store.withPhoneLock(phone, async () => {
                const refused = await checkPolicy(phone, offer.amount, offer.currency);
                if (refused)
                    return refused;
                const now = clock.now();
                const payment = {
                    id: newId(),
                    phone,
                    provider: offer.provider,
                    providerPhone: offer.providerPhone,
                    amount: fromMinorUnits(toMinorUnits(offer.amount, offer.currency)),
                    currency: offer.currency,
                    reason: offer.reason,
                    stepId: where.stepId,
                    locale: where.locale,
                    status: "CREATED",
                    createdAt: now,
                    updatedAt: now,
                };
                await store.create(payment);
                return { ok: true, payment };
            });
        },
        async run(id) {
            const payment = await store.get(id);
            if (!payment)
                return;
            const updated = await initiate(payment);
            if (isFinalPaymentStatus(updated.status))
                return;
            for (let i = 0;; i++) {
                const wait = schedule[i] ?? pollRepeatMs;
                await sleep(wait);
                let current = null;
                try {
                    current = await this.settle(id);
                }
                catch (err) {
                    logger.error("Payment status check failed", { payment: id, error: describe(err) });
                }
                if (current && isFinalPaymentStatus(current.status))
                    return;
                if (clock.now() - payment.createdAt >= giveUpAfterMs) {
                    await giveUp(payment);
                    return;
                }
            }
        },
        async reconcile(options = {}) {
            const minAgeMs = options.minAgeMs ?? 30_000;
            const reinitiateWithinMs = options.reinitiateWithinMs ?? 600_000;
            const pending = await store.pending(minAgeMs);
            let completed = 0;
            let failed = 0;
            let unresolved = 0;
            let stillPending = 0;
            let redelivered = 0;
            let errors = 0;
            for (const payment of pending) {
                try {
                    let current = await this.settle(payment.id);
                    if (current?.status === "CREATED") {
                        // The provider has never seen it: the process died before initiating.
                        current =
                            clock.now() - payment.createdAt <= reinitiateWithinMs
                                ? await initiate(current)
                                : await apply(payment.id, "FAILED", "NOT_FOUND", ["CREATED"]);
                    }
                    if (current && !isFinalPaymentStatus(current.status) && clock.now() - payment.createdAt >= giveUpAfterMs) {
                        current = await giveUp(payment);
                    }
                    if (!current)
                        continue;
                    if (current.status === "COMPLETED")
                        completed++;
                    else if (current.status === "UNRESOLVED")
                        unresolved++;
                    else if (isFinalPaymentStatus(current.status))
                        failed++;
                    else
                        stillPending++;
                }
                catch (err) {
                    errors++;
                    logger.error("Reconciliation failed for a payment", { payment: payment.id, error: describe(err) });
                    // A provider that keeps failing must not keep a payment pending forever.
                    if (clock.now() - payment.createdAt >= giveUpAfterMs) {
                        try {
                            await giveUp(payment);
                            unresolved++;
                        }
                        catch (giveUpErr) {
                            logger.error("Could not mark a payment unresolved", { payment: payment.id, error: describe(giveUpErr) });
                        }
                    }
                }
            }
            // Final payments whose outcome never reached the user (the SMS failed, or the
            // process died between recording the status and sending it).
            for (const payment of await store.unnotified()) {
                if ((payment.notifyAttempts ?? 0) >= MAX_NOTIFY_ATTEMPTS)
                    continue;
                if (clock.now() - (payment.finalizedAt ?? payment.updatedAt) < minAgeMs)
                    continue;
                try {
                    await finalize(payment);
                    if ((await store.get(payment.id))?.notifiedAt !== undefined)
                        redelivered++;
                }
                catch (err) {
                    errors++;
                    logger.error("Redelivering a payment outcome failed", { payment: payment.id, error: describe(err) });
                }
            }
            logger.info("Payments reconciled", { checked: pending.length, completed, failed, unresolved, stillPending, redelivered, errors });
            return { checked: pending.length, completed, failed, unresolved, stillPending, redelivered, errors };
        },
        settle(id) {
            const running = settling.get(id);
            if (running)
                return running;
            const task = settleOnce(id).finally(() => settling.delete(id));
            settling.set(id, task);
            return task;
        },
    };
}
/** Turns the decimal-string config into checked limits. Throws on anything unbounded. */
function describe(err) {
    return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}
function buildPolicy(config) {
    if (!config)
        throw new TypeError("payments needs a policy: unbounded payments cannot be configured");
    if (config.currencies.length === 0)
        throw new TypeError("payments.policy.currencies must list at least one currency");
    const minor = (record, what) => {
        const out = new Map();
        for (const [currency, amount] of Object.entries(record ?? {})) {
            try {
                out.set(currency, toMinorUnits(amount, currency));
            }
            catch {
                throw new TypeError(`payments.policy.${what}.${currency} must be a decimal string such as "5000", got ${JSON.stringify(amount)}`);
            }
        }
        return out;
    };
    const maxPerPayment = minor(config.maxPerPayment, "maxPerPayment");
    for (const currency of config.currencies) {
        if (!maxPerPayment.has(currency)) {
            throw new TypeError(`payments.policy.maxPerPayment needs a limit for ${currency}`);
        }
    }
    return createPolicyCheck({
        currencies: config.currencies,
        maxPerPayment,
        maxPerDayPerPhone: minor(config.maxPerDayPerPhone, "maxPerDayPerPhone"),
        maxPendingPerPhone: config.maxPendingPerPhone ?? 1,
    });
}