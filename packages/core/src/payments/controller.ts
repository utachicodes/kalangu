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
import { createPolicyCheck, fromMinorUnits, toMinorUnits, type PolicyCheck } from "./policy.js";
import type { PaymentProvider } from "./provider.js";
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
  /** Mark a payment UNRESOLVED after this long without a final status. Default 72 h. */
  readonly giveUpAfterMs?: number;
  /** Id source, for tests. Default `crypto.randomUUID`. */
  readonly newId?: () => string;
}

export const DEFAULT_POLL_SCHEDULE_MS: readonly number[] = [60_000, 120_000, 300_000, 900_000, 3_600_000];
export const DEFAULT_GIVE_UP_AFTER_MS = 72 * 3_600_000;
const DAY_MS = 24 * 3_600_000;

/** What the user is shown and, on "Yes", exactly what is paid. */
export interface Offer {
  readonly amount: string;
  readonly currency: string;
  readonly reason: string;
  readonly provider: string;
  readonly providerPhone: string;
}

export type OfferResult = { ok: true; offer: Offer } | { ok: false; message: string };

export interface PaymentController {
  readonly payeeName: string;
  offer(phone: string, spec: { amount: string; currency: string; reason: string }): Promise<OfferResult>;
  /** Re-checks the policy, records the payment as CREATED and returns it. */
  begin(
    phone: string,
    offer: Offer,
    where: { stepId: string; locale: string },
  ): Promise<{ ok: true; payment: PaymentRecord } | { ok: false; message: string }>;
  /** Initiates with the provider, then polls until the payment is final. Long-running. */
  run(id: string): Promise<void>;
  /** Asks the provider for the status and applies it. Safe to call from a callback route. */
  settle(id: string): Promise<PaymentRecord | null>;
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
  const newId = config.newId ?? (() => globalThis.crypto.randomUUID());
  // Serialises settling per payment within this process. A durable store
  // shared by several processes must make `update` atomic itself.
  const settling = new Map<string, Promise<PaymentRecord | null>>();

  const sleep = (ms: number) => new Promise<void>((resolve) => clock.setTimeout(resolve, ms));

  async function checkPolicy(phone: string, amount: string, currency: string): Promise<string | null> {
    const totals = await store.totals(phone, currency, clock.now() - DAY_MS);
    const refusal = policy.check({
      amount,
      currency,
      pendingCount: totals.pendingCount,
      completedTodayMinorUnits: toMinorUnits(totals.pending, currency) + toMinorUnits(totals.completed, currency),
    });
    if (refusal) {
      logger.info("Payment refused by policy", { phone: mask(phone), amount, currency, rule: refusal.reason });
      return refusal.message;
    }
    return null;
  }

  async function finalize(payment: PaymentRecord): Promise<void> {
    if (payment.notifiedAt !== undefined) return;
    // Claim first, so a duplicate callback cannot notify the user twice.
    const claimed = await store.update(payment.id, { notifiedAt: clock.now() });
    if (claimed.notifiedAt === undefined) return;
    try {
      await deps.onFinal(claimed);
    } catch (err) {
      logger.error("Payment outcome could not be delivered", {
        payment: payment.id,
        phone: mask(payment.phone),
        error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
      });
    }
  }

  async function apply(id: string, status: PaymentStatus, failureCode?: string): Promise<PaymentRecord> {
    const final = isFinalPaymentStatus(status);
    const next = await store.update(id, {
      status,
      ...(failureCode !== undefined ? { failureCode } : {}),
      ...(final ? { finalizedAt: clock.now() } : {}),
    });
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
      if (current.status === "UNKNOWN") return apply(id, "FAILED", "NOT_FOUND");
      return current;
    }
    if (!result.status || result.status === current.status) return current;
    return apply(id, result.status);
  }

  return {
    payeeName: config.payeeName,

    async offer(phone, spec) {
      const message = await checkPolicy(phone, spec.amount, spec.currency);
      if (message) return { ok: false, message };
      const choice = await provider.resolve(phone, spec.amount, spec.currency);
      if ("kind" in choice) {
        logger.info("Payment refused by provider", { phone: mask(phone), rule: choice.kind });
        return { ok: false, message: choice.message };
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

    async begin(phone, offer, where) {
      const message = await checkPolicy(phone, offer.amount, offer.currency);
      if (message) return { ok: false, message };
      const now = clock.now();
      const payment: PaymentRecord = {
        id: newId(),
        phone,
        provider: offer.provider,
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
    },

    async run(id) {
      const payment = await store.get(id);
      if (!payment) return;
      let outcome: PaymentStatus = "UNKNOWN";
      let failureCode: string | undefined;
      try {
        const result = await provider.initiate(payment);
        failureCode = result.failureCode;
        if (result.status === "ACCEPTED" || result.status === "DUPLICATE_IGNORED") outcome = "ACCEPTED";
        else if (result.status === "REJECTED") outcome = "REJECTED";
      } catch (err) {
        // Network or provider failure: the money may or may not have moved.
        logger.error("Payment initiation outcome unknown", {
          payment: id,
          error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
        });
      }
      const updated = await apply(id, outcome, failureCode);
      if (isFinalPaymentStatus(updated.status)) return;

      for (let i = 0; ; i++) {
        const wait = schedule[Math.min(i, schedule.length - 1)] ?? 3_600_000;
        await sleep(wait);
        let current: PaymentRecord | null = null;
        try {
          current = await this.settle(id);
        } catch (err) {
          logger.error("Payment status check failed", {
            payment: id,
            error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
          });
        }
        if (current && isFinalPaymentStatus(current.status)) return;
        if (clock.now() - payment.createdAt >= giveUpAfterMs) {
          logger.error("Payment unresolved: no final status within the give-up window", {
            payment: id,
            phone: mask(payment.phone),
          });
          await apply(id, "UNRESOLVED");
          return;
        }
      }
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
