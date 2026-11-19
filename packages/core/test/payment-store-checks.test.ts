import { describe, expect, it } from "vitest";
import { checkPaymentStore, memoryPaymentStore, type PaymentRecord, type PaymentStore } from "../src/index.js";

type Fault = "racy-claim" | "racy-transition" | "no-lock" | "lock-leaks" | "counts-failed" | "dup-create";

/** The memory store with one part of the contract broken, to show each check catches its fault. */
function faulty(fault: Fault): PaymentStore {
  const base = memoryPaymentStore();
  const tick = () => new Promise((r) => setTimeout(r, 1));
  const store: PaymentStore = { ...base };
  if (fault === "racy-claim") {
    store.claimNotification = async (id, at) => {
      const current = await base.get(id); // check...
      if (!current || current.notifiedAt !== undefined) return null;
      await tick(); // ...then write later: two callers both pass the check
      return base.update(id, { notifiedAt: at });
    };
  }
  if (fault === "racy-transition") {
    store.transition = async (id, change, from) => {
      const current = await base.get(id);
      if (!current || !from.includes(current.status)) return null;
      await tick();
      return base.update(id, change);
    };
  }
  if (fault === "no-lock") store.withPhoneLock = (_phone, work) => work();
  if (fault === "lock-leaks") {
    let held = Promise.resolve();
    store.withPhoneLock = (_phone, work) => {
      const run = held.then(work);
      held = run.then(() => undefined); // a failure leaves the chain rejected: every later caller fails
      held.catch(() => {}); // the fault is what later callers see, not an unhandled rejection
      return run;
    };
  }
  if (fault === "counts-failed") {
    store.totals = async (phone, currency, since) => {
      const t = await base.totals(phone, currency, since);
      return { ...t, completed: (Number(t.completed) + 999).toFixed(2) };
    };
  }
  if (fault === "dup-create") {
    store.create = async (p: PaymentRecord) => {
      if (await base.get(p.id)) await base.update(p.id, p);
      else await base.create(p);
    };
  }
  return store;
}

const failing = async (fault: Fault) => (await checkPaymentStore(() => faulty(fault))).map((p) => p.check);

describe("checkPaymentStore", () => {
  it("finds no problem in the built-in memory store", async () => {
    expect(await checkPaymentStore(() => memoryPaymentStore())).toEqual([]);
  });

  it("catches a claim that checks and then writes: the outcome would be sent twice", async () => {
    const found = await checkPaymentStore(() => faulty("racy-claim"));
    expect(found.find((p) => p.check === "of simultaneous notification claims, exactly one wins")?.problem).toMatch(
      /of 10 claims won, expected exactly 1/,
    );
  });

  it("catches a transition that checks and then writes", async () => {
    expect(await failing("racy-transition")).toContain("of simultaneous transitions from the same status, exactly one applies");
  });

  it("catches a phone lock that does not lock", async () => {
    expect(await failing("no-lock")).toContain("withPhoneLock never runs two pieces of work for one phone at once");
  });

  it("catches a phone lock that stays broken after a failure", async () => {
    expect(await failing("lock-leaks")).toContain("withPhoneLock is released when the work fails, and passes its result back");
  });

  it("catches totals the policy limits would get wrong", async () => {
    expect(await failing("counts-failed")).toContain("totals count what the policy limits rely on");
  });

  it("catches a create that overwrites an existing payment", async () => {
    expect(await failing("dup-create")).toContain("create refuses an id that exists, the idempotency anchor");
  });
});
