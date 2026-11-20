/**
 * Contract checks for a session store you write yourself (a database, Redis,
 * a key-value service): what the engine relies on, run against your store.
 * Framework-free, so it fits any test runner:
 *
 *   const problems = await checkSessionStore(() => myStore());
 *   expect(problems).toEqual([]);
 *
 * `makeStore` must return a fresh, empty store each time it is called (a new
 * table, a new key prefix, a cleared database).
 */
import { freshRecord, SessionConflictError } from "./session.js";
const PHONE = "+254700000001";
const OTHER = "+254700000002";
function record(phone = PHONE) {
    return freshRecord(phone, "en", 1_000);
}
/**
 * Runs every check and returns the problems found; an empty list means the
 * store keeps the contract. A check that throws unexpectedly is reported as
 * a problem, not thrown.
 */
export async function checkSessionStore(makeStore, options = {}) {
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
    await check("load returns null for a phone it has never seen", async (store) => {
        const loaded = await store.load(PHONE);
        return loaded === null ? null : `returned ${JSON.stringify(loaded)}`;
    });
    await check("a saved record loads back unchanged", async (store) => {
        const r = record();
        r.locale = "wo";
        r.stepId = "start.2";
        r.page = 1;
        r.data = {
            answer: "Ñu ngi topp sa laaj, dina nga jot SMS su gën yàgg.",
            nested: { list: [1, "two", null, { deep: true }] },
            nothing: null,
        };
        r.turn = { kind: "say", text: "8 to 18" };
        await store.save(r);
        const loaded = await store.load(PHONE);
        if (!loaded)
            return "load returned null after a save";
        for (const key of ["phone", "locale", "stepId", "page", "data", "turn", "deferred", "gatewaySessionId"]) {
            if (JSON.stringify(loaded[key]) !== JSON.stringify(r[key])) {
                return `${key} came back as ${JSON.stringify(loaded[key])}, saved ${JSON.stringify(r[key])}`;
            }
        }
        return null;
    });
    await check("save bumps record.version, starting at 1", async (store) => {
        const r = record();
        // Read through a function: save changes r.version, which TypeScript cannot see.
        const version = () => r.version;
        await store.save(r);
        if (version() !== 1)
            return `after the first save record.version is ${version()}, expected 1`;
        await store.save(r);
        if (version() !== 2)
            return `after the second save record.version is ${version()}, expected 2`;
        const loaded = await store.load(PHONE);
        return loaded?.version === 2 ? null : `the stored version is ${loaded?.version}, expected 2`;
    });
    await check("a loaded record is a copy, not the stored object", async (store) => {
        await store.save(record());
        const first = await store.load(PHONE);
        if (!first)
            return "load returned null after a save";
        first.data["changed"] = "by the caller";
        const second = await store.load(PHONE);
        return second && "changed" in second.data ? "changing a loaded record changed what is stored, without a save" : null;
    });
    await check("ifVersion that matches saves", async (store) => {
        const r = record();
        await store.save(r);
        r.data["x"] = 1;
        await store.save(r, { ifVersion: 1 });
        const loaded = await store.load(PHONE);
        return loaded?.data["x"] === 1 && loaded.version === 2 ? null : `stored ${JSON.stringify(loaded)}`;
    });
    await check("ifVersion that is stale throws SessionConflictError and changes nothing", async (store) => {
        const r = record();
        await store.save(r);
        await store.save(r); // version 2
        const stale = record();
        stale.data["x"] = "stale";
        try {
            await store.save(stale, { ifVersion: 1 });
            return "a save with ifVersion 1 succeeded over version 2";
        }
        catch (err) {
            if (!(err instanceof SessionConflictError))
                return `threw ${describe(err)}, not a SessionConflictError`;
        }
        const loaded = await store.load(PHONE);
        return loaded && !("x" in loaded.data) && loaded.version === 2 ? null : `the stored record changed: ${JSON.stringify(loaded)}`;
    });
    await check("ifVersion 0 means the record must not exist yet", async (store) => {
        await store.save(record(), { ifVersion: 0 });
        try {
            await store.save(record(), { ifVersion: 0 });
            return "a second save with ifVersion 0 succeeded over an existing record";
        }
        catch (err) {
            return err instanceof SessionConflictError ? null : `threw ${describe(err)}, not a SessionConflictError`;
        }
    });
    await check("phone numbers do not share sessions", async (store) => {
        const a = record(PHONE);
        a.data["who"] = "a";
        const b = record(OTHER);
        b.data["who"] = "b";
        await store.save(a);
        await store.save(b);
        const [la, lb] = [await store.load(PHONE), await store.load(OTHER)];
        return la?.data["who"] === "a" && lb?.data["who"] === "b" ? null : `got ${la?.data["who"]} and ${lb?.data["who"]}`;
    });
    await check("clear removes the session, and clearing an unknown phone is harmless", async (store) => {
        await store.save(record());
        await store.clear(PHONE);
        await store.clear(OTHER);
        const loaded = await store.load(PHONE);
        return loaded === null ? null : "load after clear did not return null";
    });
    await check("a store that says it is atomic lets exactly one of simultaneous versioned saves win", async (store) => {
        if (!store.atomic)
            return null; // Only atomic stores promise this; payments require them.
        await store.save(record());
        const racers = options.racers ?? 10;
        const results = await Promise.allSettled(Array.from({ length: racers }, (_, i) => {
            const r = record();
            r.data["racer"] = i;
            return store.save(r, { ifVersion: 1 });
        }));
        const won = results.filter((r) => r.status === "fulfilled").length;
        const lost = results.filter((r) => r.status === "rejected" && r.reason instanceof SessionConflictError).length;
        if (won !== 1)
            return `${won} of ${racers} saves based on version 1 succeeded, expected exactly 1`;
        if (lost !== racers - 1)
            return `${racers - 1 - lost} losing saves did not throw SessionConflictError`;
        const loaded = await store.load(PHONE);
        return loaded?.version === 2 ? null : `the stored version is ${loaded?.version}, expected 2`;
    });
    return problems;
}
function describe(err) {
    return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}