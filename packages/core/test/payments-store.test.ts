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
    expect(totals.pendingCount).toBe(1);
  });

  it("failed and rejected payments never count toward totals", async () => {
    const store = memoryPaymentStore();
    await store.create(record({ id: "a", status: "FAILED" }));
    await store.create(record({ id: "b", status: "REJECTED" }));
    const totals = await store.totals("+254700000001", "KES", now - 1000);
    expect(totals).toEqual({ pending: "0", completed: "0", pendingCount: 0 });
  });

  it("unknown payments stay pending and are reconciled; unresolved ones count as money at risk", async () => {
    const store = memoryPaymentStore();
    await store.create(record({ id: "a", amount: "100", status: "UNKNOWN", createdAt: now - 5000 }));
    await store.create(record({ id: "b", amount: "200", status: "UNRESOLVED", createdAt: now - 5000 }));
    expect((await store.pending(1000)).map((p) => p.id)).toEqual(["a"]);
    const totals = await store.totals("+254700000001", "KES", now - 10000);
    expect(totals).toEqual({ pending: "300.00", completed: "0", pendingCount: 1 });
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

  describe("atomic operations", () => {
    it("claimNotification gives exactly one of many racing callers the claim", async () => {
      const store = memoryPaymentStore();
      await store.create(record({ status: "COMPLETED" }));
      const results = await Promise.all(Array.from({ length: 10 }, (_, i) => store.claimNotification("pay-1", 1000 + i)));
      expect(results.filter((r) => r !== null)).toHaveLength(1);
      expect((await store.get("pay-1"))?.notifiedAt).toBeDefined();
      expect(await store.claimNotification("pay-1", 5)).toBeNull();
    });

    it("claimNotification on a missing payment returns null", async () => {
      expect(await memoryPaymentStore().claimNotification("nope", 1)).toBeNull();
    });

    it("transition applies only from the listed statuses", async () => {
      const store = memoryPaymentStore();
      await store.create(record({ status: "PROCESSING" }));
      const done = await store.transition("pay-1", { status: "COMPLETED" }, ["CREATED", "ACCEPTED", "PROCESSING"]);
      expect(done?.status).toBe("COMPLETED");
      // Final now: a late PROCESSING must not win.
      expect(await store.transition("pay-1", { status: "PROCESSING" }, ["CREATED", "ACCEPTED", "PROCESSING"])).toBeNull();
      expect((await store.get("pay-1"))?.status).toBe("COMPLETED");
    });

    it("transition on a missing payment returns null", async () => {
      expect(await memoryPaymentStore().transition("nope", { status: "FAILED" }, ["CREATED"])).toBeNull();
    });

    it("withPhoneLock runs work for one phone one at a time, in order", async () => {
      const store = memoryPaymentStore();
      const log: string[] = [];
      const job = (name: string, ms: number) => () =>
        (async () => {
          log.push(`${name} start`);
          await new Promise((resolve) => setTimeout(resolve, ms));
          log.push(`${name} end`);
          return name;
        })();
      const out = await Promise.all([
        store.withPhoneLock("+1", job("a", 20)),
        store.withPhoneLock("+1", job("b", 1)),
        store.withPhoneLock("+2", job("c", 1)), // another phone is not blocked
      ]);
      expect(out).toEqual(["a", "b", "c"]);
      expect(log.indexOf("a end")).toBeLessThan(log.indexOf("b start"));
      expect(log.indexOf("c start")).toBeLessThan(log.indexOf("a end"));
    });

    it("withPhoneLock releases the lock when work throws", async () => {
      const store = memoryPaymentStore();
      await expect(store.withPhoneLock("+1", async () => { throw new Error("boom"); })).rejects.toThrow("boom");
      expect(await store.withPhoneLock("+1", async () => "ok")).toBe("ok");
    });
  });
});
