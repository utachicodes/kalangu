import { describe, expect, it } from "vitest";
import {
  memoryPaymentStore,
  type PaymentRecord,
} from "../src/index.js";

const now = Date.now();

function record(overrides = {}): PaymentRecord {
  return {
    id: "pay-1",
    phone: "+254700000001",
    provider: "FAKE_MOMO",
    amount: "1000.00",
    currency: "KES",
    reason: "Consultation",
    stepId: "start.2.yes",
    locale: "en",
    status: "CREATED",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("memoryPaymentStore", () => {
  it("stores and retrieves a payment", async () => {
    const store = memoryPaymentStore();
    await store.create(record());
    const got = await store.get("pay-1");
    expect(got).toMatchObject({ id: "pay-1", status: "CREATED", amount: "1000.00" });
  });

  it("returns null for a missing payment", async () => {
    const store = memoryPaymentStore();
    expect(await store.get("nope")).toBeNull();
  });

  it("fails on a duplicate id", async () => {
    const store = memoryPaymentStore();
    await store.create(record());
    await expect(store.create(record())).rejects.toThrow(/already exists/);
  });

  it("updates fields and returns the record", async () => {
    const store = memoryPaymentStore();
    await store.create(record());
    const updated = await store.update("pay-1", { status: "COMPLETED", failureCode: "INSUFFICIENT_FUNDS" });
    expect(updated.status).toBe("COMPLETED");
    expect(updated.failureCode).toBe("INSUFFICIENT_FUNDS");
    expect(updated.updatedAt).toBeGreaterThanOrEqual(now);
    const got = await store.get("pay-1");
    expect(got?.status).toBe("COMPLETED");
  });

  it("update fails on a missing id", async () => {
    const store = memoryPaymentStore();
    await expect(store.update("nope", { status: "COMPLETED" })).rejects.toThrow(/not found/);
  });

  it("pending returns non-final records older than the threshold", async () => {
    const store = memoryPaymentStore();
    await store.create(record({ id: "pay-1", createdAt: now - 1000 }));
    await store.create(record({ id: "pay-2", status: "COMPLETED", createdAt: now - 1000 }));
    const pending = await store.pending(500);
    expect(pending.map((p) => p.id)).toEqual(["pay-1"]);
  });

  it("pending excludes final records regardless of age", async () => {
    const store = memoryPaymentStore();
    await store.create(record({ id: "pay-1", status: "FAILED", createdAt: now - 100000 }));
    const pending = await store.pending(1000);
    expect(pending).toEqual([]);
  });

  it("totals sums pending and completed separately per phone and currency", async () => {
    const store = memoryPaymentStore();
    const since = now - 1000;
    await store.create(record({ id: "pay-1", amount: "1000", currency: "KES", status: "CREATED", createdAt: since }));
    await store.create(record({ id: "pay-2", amount: "500", currency: "KES", status: "COMPLETED", createdAt: since }));
    await store.create(record({ id: "pay-3", amount: "9999", currency: "XOF", status: "COMPLETED", createdAt: since }));
    await store.create(record({ id: "pay-4", amount: "100", currency: "KES", status: "COMPLETED", createdAt: since - 2000 }));
    const totals = await store.totals("+254700000001", "KES", since);
    expect(totals.pending).toBe("1000.00");
    expect(totals.completed).toBe("500.00");
  });

  it("copies records in and out so callers cannot mutate stored state", async () => {
    const store = memoryPaymentStore();
    await store.create(record());
    const got = await store.get("pay-1");
    const mutated = { ...got, status: "COMPLETED" as const };
    expect(mutated.status).toBe("COMPLETED");
    const again = await store.get("pay-1");
    expect(again?.status).toBe("CREATED");
  });

  it("tracks size", async () => {
    const store = memoryPaymentStore();
    expect(store.size).toBe(0);
    await store.create(record({ id: "pay-1" }));
    await store.create(record({ id: "pay-2", phone: "+254700000002" }));
    expect(store.size).toBe(2);
  });
});
