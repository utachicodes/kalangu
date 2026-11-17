/**
 * Payment policy layer (docs/payments-design.md §5).
 *
 * Checked before the user sees a confirm screen, so a payment the agent
 * would refuse is never offered. Amounts are compared as decimals using
 * integer minor units internally; never as floats.
 */

import type { PaymentRecord } from "./store.js";

export interface PaymentLimits {
  /** ISO 4217 codes the agent accepts, e.g. ["KES"]. Empty means none. */
  readonly currencies: readonly string[];
  /** Max amount per single payment, per currency, in minor units. */
  readonly maxPerPayment: ReadonlyMap<string, number>;
  /** Max total (pending + completed) per phone per rolling 24h, minor units. */
  readonly maxPerDayPerPhone: ReadonlyMap<string, number>;
  /** Max payments in flight per phone. */
  readonly maxPendingPerPhone: number;
}

export interface PaymentRefusal {
  readonly reason:
    | "currency"
    | "per-payment"
    | "per-day"
    | "pending-limit"
    | "provider-closed"
    | "amount-bounds"
    | "decimals";
  /** Localized, safe to show the user. */
  readonly message: string;
}

/** Limits plus provider-derived bounds, resolved just before a check. */
export interface ProviderBounds {
  readonly provider?: string;
  readonly minAmount?: number;   // minor units
  readonly maxAmount?: number;   // minor units
  readonly decimals?: "NONE" | "TWO_PLACES";
  readonly closed?: boolean;
}

export interface PolicyCheck {
  readonly limits: PaymentLimits;
  /**
   * Returns null when the payment is allowed, or a `PaymentRefusal` when it
   * is not. `pendingCount` is the number of this phone's payments not yet
   * final. `completedTodayMinorUnits` is the amount already committed in the
   * last 24h: completed payments plus those still pending or unresolved, since
   * money may yet move. (The name predates that; callers pass the sum.)
   */
  check({
    amount,
    currency,
    pendingCount,
    completedTodayMinorUnits,
    providerBounds,
  }: {
    amount: string;
    currency: string;
    pendingCount: number;
    completedTodayMinorUnits: number;
    providerBounds?: ProviderBounds;
  }): PaymentRefusal | null;
}

/** Parse a decimal amount string into minor units (cents). */
export function toMinorUnits(amount: string, currency: string): number {
  if (!/^\d+(\.\d{1,2})?$/.test(amount)) {
    throw new Error(`Invalid decimal amount ${JSON.stringify(amount)}`);
  }
  const [whole, frac = ""] = amount.split(".");
  const cents = Number(`${whole}${frac.padEnd(2, "0").slice(0, 2)}`);
  // Past 2^53 a float can no longer hold every cent, and money must stay exact.
  if (!Number.isSafeInteger(cents)) throw new Error(`Amount ${JSON.stringify(amount)} is too large to handle exactly`);
  return cents;
}

/** Format minor units back to a decimal string. */
export function fromMinorUnits(minorUnits: number): string {
  const abs = Math.abs(minorUnits);
  const whole = Math.floor(abs / 100);
  const cents = abs % 100;
  const sign = minorUnits < 0 ? "-" : "";
  return `${sign}${whole}.${cents.toString().padStart(2, "0")}`;
}

/** Validate an ISO 4217 currency code. */
export function isCurrency(code: unknown): code is string {
  return typeof code === "string" && /^[A-Z]{3}$/.test(code);
}

/**
 * Builds a policy check from configured limits. Throws on invalid config so
 * unbounded payments cannot be configured by accident.
 */
export function createPolicyCheck(limits: PaymentLimits): PolicyCheck {
  if (limits.maxPendingPerPhone < 1) {
    throw new Error("maxPendingPerPhone must be at least 1");
  }
  for (const currency of limits.currencies) {
    if (!limits.maxPerPayment.has(currency)) {
      throw new Error(`maxPerPayment needs a limit for ${currency}: unbounded payments cannot be configured`);
    }
  }
  for (const [currency, max] of limits.maxPerPayment) {
    if (!isCurrency(currency)) {
      throw new Error(`Invalid currency code ${JSON.stringify(currency)}`);
    }
    if (!Number.isFinite(max) || max < 0) {
      throw new Error(`Invalid maxPerPayment for ${currency}`);
    }
  }
  for (const [currency, max] of limits.maxPerDayPerPhone) {
    if (!isCurrency(currency)) {
      throw new Error(`Invalid currency code ${JSON.stringify(currency)}`);
    }
    if (!Number.isFinite(max) || max < 0) {
      throw new Error(`Invalid maxPerDayPerPhone for ${currency}`);
    }
  }

  return {
    limits,
    check({ amount, currency, pendingCount, completedTodayMinorUnits, providerBounds }) {
      // Currency must be allowed.
      if (!limits.currencies.includes(currency)) {
        return {
          reason: "currency",
          message: `Payments in ${currency} are not accepted.`,
        };
      }

      const amountMinor = toMinorUnits(amount, currency);

      // Zero or negative amounts are never allowed.
      if (amountMinor <= 0) {
        return {
          reason: "per-payment",
          message: "The amount must be greater than zero.",
        };
      }

      // Provider-level bounds: stricter of ours and theirs wins.
      if (providerBounds?.minAmount !== undefined && amountMinor < providerBounds.minAmount) {
        return {
          reason: "amount-bounds",
          message: "This amount is not supported by your operator.",
        };
      }
      const providerMax = providerBounds?.maxAmount;
      const maxPerPayment = limits.maxPerPayment.get(currency);
      const effectiveMax =
        providerMax !== undefined && maxPerPayment !== undefined
          ? Math.min(providerMax, maxPerPayment)
          : providerMax ?? maxPerPayment ?? Infinity;
      if (amountMinor > effectiveMax) {
        return {
          reason: providerBounds?.closed ? "provider-closed" : "per-payment",
          message: "This payment is above the allowed limit.",
        };
      }

      // Provider decimals: a NONE provider rejects fractional amounts.
      if (providerBounds?.decimals === "NONE" && amountMinor % 100 !== 0) {
        return {
          reason: "decimals",
          message: "This amount is not supported with your operator.",
        };
      }

      // Per-day total (pending counts too), rolling 24h.
      const maxPerDay = limits.maxPerDayPerPhone.get(currency);
      if (maxPerDay !== undefined) {
        const already = completedTodayMinorUnits + amountMinor;
        if (already > maxPerDay) {
          return {
            reason: "per-day",
            message: "You have reached the daily payment limit.",
          };
        }
      }

      // One payment in flight per user by default.
      if (pendingCount >= limits.maxPendingPerPhone) {
        return {
          reason: "pending-limit",
          message: "You already have a payment in progress. Finish it first.",
        };
      }

      // Provider closed: refuse regardless of amount.
      if (providerBounds?.closed) {
        return {
          reason: "provider-closed",
          message: "Payments with your operator are unavailable right now. Please try later.",
        };
      }

      return null;
    },
  };
}

/**
 * User-facing messages keyed by refusal reason. Developers override these
 * per locale when creating the agent.
 */
export const DEFAULT_REFUSAL_MESSAGES: Readonly<Record<PaymentRefusal["reason"], string>> = {
  currency: "This currency is not accepted.",
  "per-payment": "This payment is above the allowed limit.",
  "per-day": "You have reached the daily payment limit.",
  "pending-limit": "You already have a payment in progress. Finish it first.",
  "provider-closed": "Payments with your operator are unavailable right now. Please try later.",
  "amount-bounds": "This amount is not supported by your operator.",
  decimals: "This amount is not supported with your operator.",
};

/** Mask a phone number for logs (last 4 digits only). */
export function maskPhoneForPolicy(phone: string): string {
  if (!phone) return "";
  const visible = phone.slice(-4);
  return "•".repeat(Math.max(0, phone.length - visible.length)) + visible;
}

/**
 * Build a localized refusal message from a refusal reason and an optional
 * per-locale override map.
 */
export function refusalMessage(
  reason: PaymentRefusal["reason"],
  overrides: Readonly<Partial<Record<PaymentRefusal["reason"], string>>> = {},
): string {
  return overrides[reason] ?? DEFAULT_REFUSAL_MESSAGES[reason];
}
