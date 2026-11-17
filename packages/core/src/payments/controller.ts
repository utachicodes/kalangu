/**
 * Payment controller (docs/payments-design.md §4.3, §5, §6).
 *
 * Owns the money-moving steps that sit between the engine and the provider
 * port: offer (policy + operator resolution), begin (re-check and record),
 * initiate, and settle (check-status, never trust a callback alone).
 * It knows nothing about screens or sessions; the engine passes it plain
 * values and gets plain results back.
 */

import type { Clock } from "../clock.js";
import type { Logger } from "../logger.js";
import { createPolicyCheck, fromMinorUnits, toMinorUnits, type PaymentRefusal, type PolicyCheck } from "./policy.js";
import type { PaymentProvider, Refusal } from "./provider.js";
import { isFinalPaymentStatus, type PaymentRecord, type PaymentStatus, type PaymentStore } from "./store.js";

/** Decimal-string limits, as written in `createAgent({ payments })`. */
export interface PaymentPolicyConfig {
  /** Currencies the agent accepts. Anything else is refused. */
  readonly currencies: readonly string[];
  /** Per currency, e.g. `{ KES: "5000" }`. Required for every accepted currency. */
  readonly maxPerPayment: Readonly<Record<string, string>>;
  /** Per currency, rolling 24 hours, pending payments included. Optional. */
  readonly maxPerDayPerPhone?: Readonly<Record<string, string>>;
  /** Payments in flight per phone. Default 1. */
  readonly maxPendingPerPhone?: number;
}

export interface PaymentsConfig {
  readonly provider: PaymentProvider;
  readonly store: PaymentStore;
  /** Who is paid. Shown on the confirm screen; never taken from a model. */
  readonly payeeName: string;
  /** No policy, no payments. */
  readonly policy: PaymentPolicyConfig;
  /**
   * Waits between status checks after initiating, in ms. After the last one
   * it repeats hourly until `giveUpAfterMs`. Default 1, 2, 5, 15, 60 minutes.
   */
  readonly pollScheduleMs?: readonly number[];
  /** Wait between status checks once `pollScheduleMs` is used up, in ms. Default hourly. */
  readonly pollRepeatMs?: number;
  /** Mark a payment UNRESOLVED after this long without a final status. Default 72 h. */
  readonly giveUpAfterMs?: number;
  /** Id source, for tests. Default `crypto.randomUUID`. */
  readonly newId?: () => string;
}

/** What a reconciliation sweep did. */
export interface ReconcileReport {
  /** Non-final payments examined. */
  readonly checked: number;
  /** Of those, how they ended up. */
  readonly completed: number;
  readonly failed: number;
  readonly unresolved: number;
  readonly stillPending: number;
  /** Final payments whose outcome had not reached the user and was delivered now. */
  readonly redelivered: number;
  /** Payments whose check threw (provider down, store error); retried next sweep. */
  readonly errors: number;
}

export interface ReconcileOptions {
  /**
   * Skip payments younger than this, in ms, so a sweep never races the
   * process that is still starting them. Default 30 seconds.
   */
  readonly minAgeMs?: number;
  /**
   * A payment recorded but never initiated (the process died in between) is
   * initiated again, safely, since our id is the idempotency key, while it
   * is younger than this. Older ones are failed as never started. Default 10 minutes.
   */
  readonly reinitiateWithinMs?: number;
}

export const DEFAULT_POLL_SCHEDULE_MS: readonly number[] = [60_000, 120_000, 300_000, 900_000, 3_600_000];
export const DEFAULT_GIVE_UP_AFTER_MS = 72 * 3_600_000;
export const DEFAULT_POLL_REPEAT_MS = 3_600_000;
/** After this many failed deliveries the outcome stays in the store for a human. */
export const MAX_NOTIFY_ATTEMPTS = 5;
const DAY_MS = 24 * 3_600_000;
const NON_FINAL: readonly PaymentStatus[] = ["CREATED", "ACCEPTED", "PROCESSING", "IN_RECONCILIATION", "UNKNOWN"];

/** What the user is shown and, on "Yes", exactly what is paid. */
export interface Offer {
  readonly amount: string;
  readonly currency: string;
  readonly reason: string;
  readonly provider: string;
  readonly providerPhone: string;
}

/** Why a payment was refused: a policy rule or a provider's reason. Localized by the engine. */
export type RefusalReason = PaymentRefusal["reason"] | Refusal["kind"];

export interface PaymentRefused {
  readonly ok: false;
  readonly reason: RefusalReason;
  /** English, for logs and developers. Users get the localized text for `reason`. */
  readonly message: string;
}

export type OfferResult = { ok: true; offer: Offer } | PaymentRefused;

export interface PaymentController {
  readonly payeeName: string;
  offer(phone: string, spec: { amount: string; currency: string; reason: string }): Promise<OfferResult>;
  /** Re-checks the policy, records the payment as CREATED and returns it. */
  begin(
    phone: string,
    offer: Offer,
    where: { stepId: string; locale: string },
  ): Promise<{ ok: true; payment: PaymentRecord } | PaymentRefused>;
  /** Initiates with the provider, then polls until the payment is final. Long-running. */
  run(id: string): Promise<void>;
  /** Asks the provider for the status and applies it. Safe to call from a callback route. */
  settle(id: string): Promise<PaymentRecord | null>;
  /**
   * Sweeps every non-final payment: checks the provider, finishes what a
   * restart interrupted, and gives up on the old ones. Call it from a cron
   * job or scheduler (every 5 minutes is reasonable). Safe to run alongside
   * the in-process polling and to run twice.
   */
  reconcile(options?: ReconcileOptions): Promise<ReconcileReport>;
}

export function createPaymentController(
  config: PaymentsConfig,
  deps: {
    clock: Clock;
    logger: Logger;
    mask: (phone: string) => string;
    /** Called once per payment when it reaches a final status. */
    onFinal: (payment: PaymentRecord) => Promise<void>;
  },
): PaymentController {
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
  const settling = new Map<string, Promise<PaymentRecord | null>>();

  const sleep = (ms: number) => new Promise<void>((resolve) => clock.setTimeout(resolve, ms));

  async function checkPolicy(phone: string, amount: string, currency: string): Promise<PaymentRefused | null> {
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

  async function finalize(payment: PaymentRecord): Promise<void> {
    // Only a final payment has an outcome to announce. A record that moved on to another
    // non-final status while a caller held an older view must never be announced as done.
    if (!isFinalPaymentStatus(payment.status)) return;
    if (payment.notifiedAt !== undefined) return;
    // Claim first, atomically: of any number of racing callers, one wins.
    const claimed = await store.claimNotification(payment.id, clock.now());
    if (!claimed) return;
    try {
      await deps.onFinal(claimed);
    } catch (err) {
      // Give the claim back, so the next reconcile sweep tries again instead of
      // the user never hearing the outcome.
      await store.releaseNotification(payment.id);
      const attempts = (claimed.notifyAttempts ?? 0) + 1;
      logger.error(
        attempts >= MAX_NOTIFY_ATTEMPTS
          ? "Payment outcome could not be delivered; giving up, it stays in the store"
          : "Payment outcome could not be delivered; reconcile will retry",
        { payment: payment.id, phone: mask(payment.phone), attempts, error: describe(err) },
      );
    }
  }

  /**
   * Records a status. `from` is what the caller's decision was based on; it defaults to any
   * non-final status, which keeps a final status final. A conclusion drawn from one observation
   * (the provider has never seen it) passes that observation's status, so it cannot overwrite
   * newer state another process recorded in the meantime.
   */
  async function apply(
    id: string,
    status: PaymentStatus,
    failureCode?: string,
    from: readonly PaymentStatus[] = NON_FINAL,
  ): Promise<PaymentRecord> {
    const final = isFinalPaymentStatus(status);
    const next = await store.transition(
      id,
      {
        status,
        ...(failureCode !== undefined ? { failureCode } : {}),
        ...(final ? { finalizedAt: clock.now() } : {}),
      },
      from,
    );
    if (!next) {
      // Already final: someone else got there first. Their outcome stands.
      const current = await store.get(id);
      if (!current) throw new Error(`Payment ${id} not found`);
      await finalize(current);
      return current;
    }
    if (final) await finalize(next);
    return next;
  }

  async function settleOnce(id: string): Promise<PaymentRecord | null> {
    const current = await store.get(id);
    if (!current) return null;
    if (isFinalPaymentStatus(current.status)) {
      await finalize(current); // Delivers an outcome missed by a crash; no-op otherwise.
      return current;
    }
    const result = await provider.status(id);
    if (!result.found) {
      // The provider has never seen it. Only safe to fail if initiation was unconfirmed.
      if (current.status === "UNKNOWN") return apply(id, "FAILED", "NOT_FOUND", ["UNKNOWN"]);
      return current;
    }
    if (!result.status || result.status === current.status) return current;
    return apply(id, result.status);
  }

  /** Initiates with the provider and records what it said. Never fails a payment on a guess. */
  async function initiate(payment: PaymentRecord): Promise<PaymentRecord> {
    let outcome: PaymentStatus = "UNKNOWN";
    let failureCode: string | undefined;
    try {
      const result = await provider.initiate(payment);
      failureCode = result.failureCode;
      if (result.status === "ACCEPTED" || result.status === "DUPLICATE_IGNORED") outcome = "ACCEPTED";
      else if (result.status === "REJECTED") outcome = "REJECTED";
    } catch (err) {
      // Network or provider failure: the money may or may not have moved.
      logger.error("Payment initiation outcome unknown", { payment: payment.id, error: describe(err) });
    }
    return apply(payment.id, outcome, failureCode);
  }

  async function giveUp(payment: PaymentRecord): Promise<PaymentRecord> {
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
      if (refused) return refused;
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
        if (refused) return refused;
        const now = clock.now();
        const payment: PaymentRecord = {
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
        return { ok: true as const, payment };
      });
    },

    async run(id) {
      const payment = await store.get(id);
      if (!payment) return;
      const updated = await initiate(payment);
      if (isFinalPaymentStatus(updated.status)) return;

      for (let i = 0; ; i++) {
        const wait = schedule[i] ?? pollRepeatMs;
        await sleep(wait);
        let current: PaymentRecord | null = null;
        try {
          current = await this.settle(id);
        } catch (err) {
          logger.error("Payment status check failed", { payment: id, error: describe(err) });
        }
        if (current && isFinalPaymentStatus(current.status)) return;
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
          if (!current) continue;
          if (current.status === "COMPLETED") completed++;
          else if (current.status === "UNRESOLVED") unresolved++;
          else if (isFinalPaymentStatus(current.status)) failed++;
          else stillPending++;
        } catch (err) {
          errors++;
          logger.error("Reconciliation failed for a payment", { payment: payment.id, error: describe(err) });
          // A provider that keeps failing must not keep a payment pending forever.
          if (clock.now() - payment.createdAt >= giveUpAfterMs) {
            try {
              await giveUp(payment);
              unresolved++;
            } catch (giveUpErr) {
              logger.error("Could not mark a payment unresolved", { payment: payment.id, error: describe(giveUpErr) });
            }
          }
        }
      }

      // Final payments whose outcome never reached the user (the SMS failed, or the
      // process died between recording the status and sending it).
      for (const payment of await store.unnotified()) {
        if ((payment.notifyAttempts ?? 0) >= MAX_NOTIFY_ATTEMPTS) continue;
        if (clock.now() - (payment.finalizedAt ?? payment.updatedAt) < minAgeMs) continue;
        try {
          await finalize(payment);
          if ((await store.get(payment.id))?.notifiedAt !== undefined) redelivered++;
        } catch (err) {
          errors++;
          logger.error("Redelivering a payment outcome failed", { payment: payment.id, error: describe(err) });
        }
      }

      logger.info("Payments reconciled", { checked: pending.length, completed, failed, unresolved, stillPending, redelivered, errors });
      return { checked: pending.length, completed, failed, unresolved, stillPending, redelivered, errors };
    },

    settle(id) {
      const running = settling.get(id);
      if (running) return running;
      const task = settleOnce(id).finally(() => settling.delete(id));
      settling.set(id, task);
      return task;
    },
  };
}

/** Turns the decimal-string config into checked limits. Throws on anything unbounded. */
function describe(err: unknown): string {
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}

function buildPolicy(config: PaymentPolicyConfig | undefined): PolicyCheck {
  if (!config) throw new TypeError("payments needs a policy: unbounded payments cannot be configured");
  if (config.currencies.length === 0) throw new TypeError("payments.policy.currencies must list at least one currency");
  const minor = (record: Readonly<Record<string, string>> | undefined, what: string) => {
    const out = new Map<string, number>();
    for (const [currency, amount] of Object.entries(record ?? {})) {
      try {
        out.set(currency, toMinorUnits(amount, currency));
      } catch {
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
