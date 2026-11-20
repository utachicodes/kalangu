/**
 * Contract checks for a payment store you write yourself (payments design
 * §6.1): what the engine relies on, run against your store, framework-free.
 *
 *   const problems = await checkPaymentStore(() => myPaymentStore());
 *   expect(problems).toEqual([]);
 *
 * `makeStore` must return a fresh, empty store each time it is called.
 * Three operations must hold across every process sharing the store:
 * `transition`, `claimNotification` and `withPhoneLock`. The checks race them
 * from one process, which catches a store that checks and then writes in two
 * steps; they cannot prove cross-process atomicity, which needs the database's
 * own guarantee (a conditional UPDATE, an advisory lock).
 */
const PHONE = "+254700000001";
function payment(id, change = {}) {
    const now = Date.now();
    return {
        id,
        phone: PHONE,
        provider: "TEST_MOMO",
        providerPhone: "254700000001",
        amount: "500.00",
        currency: "KES",
        reason: "Consultation",
        stepId: "start.1",
        locale: "en",
        status: "CREATED",
        createdAt: now,
        updatedAt: now,
        ...change,
    };
}
/** Exact comparison of decimal strings ("500" and "500.00" are equal). */
function cents(amount) {
    const [whole = "0", frac = ""] = amount.split(".");
    return BigInt(`${whole}${(frac + "00").slice(0, 2)}`);
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export async function checkPaymentStore(makeStore, options = {}) {
    const racers = options.racers ?? 10;
    const problems = [];
    const check = async (name, body) => {
        try {
            const problem = await body(await makeStore());
            if (problem)
                problems.push({ check: name, problem });
        }
        catch (err) {
            problems.push({ check: name, problem: `threw ${describe(err)}` });
        }
    };
    await check("a created payment reads back unchanged, and an unknown id is null", async (store) => {
        if ((await store.get("missing")) !== null)
            return "get of an unknown id was not null";
        const p = payment("p1", { reason: "Consultation: Ñu ngi fi" });
        await store.create(p);
        const got = await store.get("p1");
        if (!got)
            return "get returned null after create";
        for (const key of ["id", "phone", "providerPhone", "amount", "currency", "reason", "stepId", "locale", "status", "createdAt"]) {
            if (got[key] !== p[key])
                return `${key} came back as ${JSON.stringify(got[key])}, created as ${JSON.stringify(p[key])}`;
        }
        return null;
    });
    await check("create refuses an id that exists, the idempotency anchor", async (store) => {
        await store.create(payment("p1"));
        try {
            await store.create(payment("p1", { amount: "999.00" }));
            return "a second create with the same id succeeded";
        }
        catch {
            const got = await store.get("p1");
            return got?.amount === "500.00" ? null : `the first payment changed: amount ${got?.amount}`;
        }
    });
    await check("a read is a copy, not the stored object", async (store) => {
        await store.create(payment("p1"));
        const got = (await store.get("p1"));
        if (!got)
            return "get returned null after create";
        got.status = "COMPLETED";
        return (await store.get("p1"))?.status === "CREATED" ? null : "changing a read record changed the store";
    });
    await check("update merges a change and returns the updated record", async (store) => {
        await store.create(payment("p1"));
        const updated = await store.update("p1", { status: "ACCEPTED" });
        if (updated.status !== "ACCEPTED" || updated.amount !== "500.00")
            return `update returned ${JSON.stringify(updated)}`;
        return (await store.get("p1"))?.status === "ACCEPTED" ? null : "the change was not stored";
    });
    await check("transition applies only from an expected status, and keeps a final status final", async (store) => {
        await store.create(payment("p1", { status: "PROCESSING" }));
        const done = await store.transition("p1", { status: "COMPLETED" }, ["PROCESSING"]);
        if (done?.status !== "COMPLETED")
            return `the expected transition returned ${JSON.stringify(done)}`;
        // A late, stale observation must not overwrite the final status.
        const stale = await store.transition("p1", { status: "FAILED" }, ["PROCESSING"]);
        if (stale !== null)
            return "a transition from PROCESSING succeeded on a COMPLETED payment";
        if ((await store.get("p1"))?.status !== "COMPLETED")
            return "the final status changed";
        return (await store.transition("missing", { status: "FAILED" }, ["CREATED"])) === null
            ? null
            : "a transition on an unknown id did not return null";
    });
    await check("of simultaneous transitions from the same status, exactly one applies", async (store) => {
        await store.create(payment("p1", { status: "PROCESSING" }));
        const results = await Promise.all(Array.from({ length: racers }, (_, i) => store.transition("p1", { status: i % 2 ? "COMPLETED" : "FAILED", failureCode: `racer-${i}` }, ["PROCESSING"])));
        const won = results.filter((r) => r !== null).length;
        return won === 1 ? null : `${won} of ${racers} transitions from PROCESSING applied, expected exactly 1`;
    });
    await check("of simultaneous notification claims, exactly one wins", async (store) => {
        await store.create(payment("p1", { status: "COMPLETED" }));
        const results = await Promise.all(Array.from({ length: racers }, (_, i) => store.claimNotification("p1", 1_000 + i)));
        const won = results.filter((r) => r !== null);
        if (won.length !== 1)
            return `${won.length} of ${racers} claims won, expected exactly 1: the user would hear the outcome ${won.length} times`;
        return (await store.get("p1"))?.notifiedAt === won[0].notifiedAt ? null : "the stored notifiedAt is not the winner's";
    });
    await check("releasing a claim makes it claimable again and counts the attempt", async (store) => {
        await store.create(payment("p1", { status: "COMPLETED" }));
        if (!(await store.claimNotification("p1", 1)))
            return "the first claim did not win";
        await store.releaseNotification("p1");
        const after = await store.get("p1");
        if (after?.notifiedAt !== undefined)
            return "notifiedAt is still set after release";
        if (after?.notifyAttempts !== 1)
            return `notifyAttempts is ${after?.notifyAttempts}, expected 1`;
        return (await store.claimNotification("p1", 2)) ? null : "a claim after release did not win";
    });
    await check("unnotified lists final payments whose outcome was not delivered, only", async (store) => {
        await store.create(payment("final-waiting", { status: "COMPLETED" }));
        await store.create(payment("final-failed", { status: "FAILED" }));
        await store.create(payment("final-delivered", { status: "COMPLETED", notifiedAt: 1 }));
        await store.create(payment("in-flight", { status: "PROCESSING" }));
        const ids = (await store.unnotified()).map((p) => p.id).sort();
        const want = ["final-failed", "final-waiting"];
        return JSON.stringify(ids) === JSON.stringify(want) ? null : `listed ${JSON.stringify(ids)}, expected ${JSON.stringify(want)}`;
    });
    await check("pending lists payments not yet final and older than the threshold, only", async (store) => {
        const now = Date.now();
        await store.create(payment("old-in-flight", { status: "PROCESSING", createdAt: now - 60_000 }));
        await store.create(payment("old-final", { status: "COMPLETED", createdAt: now - 60_000 }));
        await store.create(payment("new-in-flight", { status: "ACCEPTED", createdAt: now }));
        const ids = (await store.pending(30_000)).map((p) => p.id);
        return JSON.stringify(ids) === JSON.stringify(["old-in-flight"]) ? null : `listed ${JSON.stringify(ids)}, expected ["old-in-flight"]`;
    });
    await check("totals count what the policy limits rely on", async (store) => {
        const now = Date.now();
        const day = 24 * 60 * 60 * 1000;
        await store.create(payment("done", { status: "COMPLETED", amount: "500.00", createdAt: now }));
        await store.create(payment("flying", { status: "PROCESSING", amount: "200.00", createdAt: now }));
        await store.create(payment("unknown", { status: "UNRESOLVED", amount: "50.00", createdAt: now }));
        await store.create(payment("failed", { status: "FAILED", amount: "999.00", createdAt: now }));
        await store.create(payment("yesterday", { status: "COMPLETED", amount: "700.00", createdAt: now - 2 * day }));
        await store.create(payment("old-flying", { status: "PROCESSING", amount: "30.00", createdAt: now - 2 * day }));
        await store.create(payment("other-currency", { status: "PROCESSING", currency: "UGX", amount: "1000", createdAt: now }));
        await store.create(payment("other-phone", { status: "COMPLETED", phone: "+254700000002", createdAt: now }));
        const t = await store.totals(PHONE, "KES", now - day);
        // Completed today: 500. Pending: in flight 200 + old in flight 30 + unresolved 50 = 280.
        // In-flight count, any currency, any age: flying, old-flying, other-currency = 3.
        const got = { completed: String(cents(t.completed)), pending: String(cents(t.pending)), pendingCount: t.pendingCount };
        const want = { completed: "50000", pending: "28000", pendingCount: 3 };
        return JSON.stringify(got) === JSON.stringify(want)
            ? null
            : `got completed ${t.completed}, pending ${t.pending}, pendingCount ${t.pendingCount}; expected 500.00, 280.00, 3 (failed payments never count; in-flight ones count at any age)`;
    });
    await check("withPhoneLock never runs two pieces of work for one phone at once", async (store) => {
        let inside = 0;
        let most = 0;
        await Promise.all(Array.from({ length: racers }, () => store.withPhoneLock(PHONE, async () => {
            inside++;
            most = Math.max(most, inside);
            await sleep(2);
            inside--;
        })));
        return most === 1 ? null : `${most} pieces of work for one phone ran at the same time`;
    });
    await check("withPhoneLock is released when the work fails, and passes its result back", async (store) => {
        const failed = await store
            .withPhoneLock(PHONE, async () => {
            throw new Error("boom");
        })
            .then(() => "the failing work's error was swallowed", () => null);
        if (failed)
            return failed;
        const value = await Promise.race([store.withPhoneLock(PHONE, async () => 42), sleep(1000).then(() => "stuck")]);
        return value === 42 ? null : value === "stuck" ? "the lock was not released after the work failed" : `returned ${String(value)}, expected 42`;
    });
    return problems;
}
function describe(err) {
    return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}