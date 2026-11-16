import { describe, expect, it } from "vitest";
import {
  createPolicyCheck,
  fromMinorUnits,
  isCurrency,
  maskPhoneForPolicy,
  refusalMessage,
  toMinorUnits,
  type PaymentRefusal,
} from "../src/index.js";

function limits(overrides = {}) {
  return {
    currencies: ["KES", "XOF"],
    maxPerPayment: new Map<string, number>([
      ["KES", 500000],
      ["XOF", 300000],
    ]),
    maxPerDayPerPhone: new Map<string, number>([
      ["KES", 1000000],
      ["XOF", 600000],
    ]),
    maxPendingPerPhone: 1,
    ...overrides,
  };
}

describe("toMinorUnits / fromMinorUnits", () => {
  it("converts decimal strings to minor units", () => {
    expect(toMinorUnits("500", "KES")).toBe(50000);
    expect(toMinorUnits("500.50", "KES")).toBe(50050);
    expect(toMinorUnits("0.99", "KES")).toBe(99);
    expect(toMinorUnits("10", "XOF")).toBe(1000);
  });

  it("round-trips", () => {
    expect(fromMinorUnits(toMinorUnits("2500.50", "KES"))).toBe("2500.50");
  });

  it("rejects invalid amounts", () => {
    expect(() => toMinorUnits("abc", "KES")).toThrow();
    expect(() => toMinorUnits("500.555", "KES")).toThrow();
    expect(() => toMinorUnits("-5", "KES")).toThrow();
  });
});

describe("isCurrency", () => {
  it("accepts ISO 4217 codes and rejects others", () => {
    expect(isCurrency("KES")).toBe(true);
    expect(isCurrency("kes")).toBe(false);
    expect(isCurrency("US")).toBe(false);
    expect(isCurrency(123)).toBe(false);
  });
});

describe("maskPhoneForPolicy", () => {
  it("shows only the last four digits", () => {
    expect(maskPhoneForPolicy("+254700000001")).toBe("•••••••••0001");
    expect(maskPhoneForPolicy("0700000001")).toBe("••••••0001");
    expect(maskPhoneForPolicy("")).toBe("");
  });
});

describe("createPolicyCheck", () => {
  it("allows a payment within all limits", () => {
    const check = createPolicyCheck(limits());
    const out = check.check({
      amount: "1000",
      currency: "KES",
      pendingCount: 0,
      completedTodayMinorUnits: 0,
    });
    expect(out).toBeNull();
  });

  it("refuses a disallowed currency", () => {
    const check = createPolicyCheck(limits());
    const out = check.check({
      amount: "1000",
      currency: "USD",
      pendingCount: 0,
      completedTodayMinorUnits: 0,
    });
    expect(out).toMatchObject({ reason: "currency" });
    expect(typeof out?.message).toBe("string");
  });

  it("refuses above per-payment max", () => {
    const check = createPolicyCheck(limits());
    const out = check.check({
      amount: "6000",
      currency: "KES",
      pendingCount: 0,
      completedTodayMinorUnits: 0,
    });
    expect(out).toMatchObject({ reason: "per-payment" });
  });

  it("counts pending toward the daily total", () => {
    const check = createPolicyCheck(limits());
    // 900000 already spent today; 200000 more would exceed 1000000.
    const out = check.check({
      amount: "2000",
      currency: "KES",
      pendingCount: 0,
      completedTodayMinorUnits: 900000,
    });
    expect(out).toMatchObject({ reason: "per-day" });
  });

  it("refuses when a payment is already pending", () => {
    const check = createPolicyCheck(limits({ maxPendingPerPhone: 1 }));
    const out = check.check({
      amount: "1000",
      currency: "KES",
      pendingCount: 1,
      completedTodayMinorUnits: 0,
    });
    expect(out).toMatchObject({ reason: "pending-limit" });
  });

  it("allows multiple pending when the limit is higher", () => {
    const check = createPolicyCheck(limits({ maxPendingPerPhone: 3 }));
    const out = check.check({
      amount: "1000",
      currency: "KES",
      pendingCount: 2,
      completedTodayMinorUnits: 0,
    });
    expect(out).toBeNull();
  });

  it("applies provider max when it is stricter", () => {
    const check = createPolicyCheck(limits());
    const out = check.check({
      amount: "4000",
      currency: "KES",
      pendingCount: 0,
      completedTodayMinorUnits: 0,
      providerBounds: { maxAmount: 300000 },
    });
    expect(out).toMatchObject({ reason: "per-payment" });
  });

  it("refuses fractional amounts when the provider uses NONE decimals", () => {
    const check = createPolicyCheck(limits());
    const out = check.check({
      amount: "100.50",
      currency: "KES",
      pendingCount: 0,
      completedTodayMinorUnits: 0,
      providerBounds: { decimals: "NONE" },
    });
    expect(out).toMatchObject({ reason: "decimals" });
  });

  it("allows fractional amounts when the provider uses TWO_PLACES", () => {
    const check = createPolicyCheck(limits());
    const out = check.check({
      amount: "100.50",
      currency: "KES",
      pendingCount: 0,
      completedTodayMinorUnits: 0,
      providerBounds: { decimals: "TWO_PLACES" },
    });
    expect(out).toBeNull();
  });

  it("refuses when the provider is closed", () => {
    const check = createPolicyCheck(limits());
    const out = check.check({
      amount: "1000",
      currency: "KES",
      pendingCount: 0,
      completedTodayMinorUnits: 0,
      providerBounds: { closed: true },
    });
    expect(out).toMatchObject({ reason: "provider-closed" });
  });

  it("throws on invalid config", () => {
    expect(() => createPolicyCheck({ ...limits(), maxPendingPerPhone: 0 })).toThrow();
    expect(() =>
      createPolicyCheck({ ...limits(), maxPerPayment: { USD: 100 } as any }),
    ).toThrow();
  });
});

describe("refusalMessage", () => {
  it("returns defaults and honors overrides", () => {
    expect(refusalMessage("currency")).toBe("This currency is not accepted.");
    expect(refusalMessage("currency", { currency: "Monnaie refusée." })).toBe(
      "Monnaie refusée.",
    );
  });

  it("covers every reason", () => {
    const reasons: PaymentRefusal["reason"][] = [
      "currency",
      "per-payment",
      "per-day",
      "pending-limit",
      "provider-closed",
      "amount-bounds",
      "decimals",
    ];
    for (const reason of reasons) {
      expect(typeof refusalMessage(reason)).toBe("string");
      expect(refusalMessage(reason).length).toBeGreaterThan(0);
    }
  });
});
