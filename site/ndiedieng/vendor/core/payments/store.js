/**
 * Payment store (docs/payments-design.md §6.1).
 *
 * Payments get their own durable store, separate from sessions, because a
 * payment outlives the USSD session that created it: the session ends before
 * the PIN prompt, and the outcome arrives later by callback or polling.
 */
/** Statuses after which nothing more is expected from the provider. */
export function isFinalPaymentStatus(status) {
    return status === "COMPLETED" || status === "FAILED" || status === "REJECTED" || status === "UNRESOLVED";
}
/**
 * In-process store. Ships for tests and the simulator only. Lost on restart,
 * so using it with a real provider logs an error at startup.
 */
export function memoryPaymentStore() {
    const records = new Map();
    const locks = new Map();
    return {
        async create(payment) {
            if (records.has(payment.id)) {
                throw new Error(`Payment ${payment.id} already exists`);
            }
            records.set(payment.id, structuredClone(payment));
        },
        async update(id, change) {
            const current = records.get(id);
            if (!current)
                throw new Error(`Payment ${id} not found`);
            assertSameId(id, change);
            const next = structuredClone({ ...current, ...change, updatedAt: Date.now() });
            records.set(id, next);
            return structuredClone(next);
        },
        async transition(id, change, from) {
            const current = records.get(id);
            if (!current || !from.includes(current.status))
                return null;
            assertSameId(id, change);
            const next = structuredClone({ ...current, ...change, updatedAt: Date.now() });
            records.set(id, next);
            return structuredClone(next);
        },
        async claimNotification(id, at) {
            const current = records.get(id);
            if (!current || current.notifiedAt !== undefined)
                return null;
            const next = { ...current, notifiedAt: at, updatedAt: Date.now() };
            records.set(id, next);
            return structuredClone(next);
        },
        async releaseNotification(id) {
            const current = records.get(id);
            if (!current || current.notifiedAt === undefined)
                return;
            const next = {
                ...current,
                notifyAttempts: (current.notifyAttempts ?? 0) + 1,
                updatedAt: Date.now(),
            };
            delete next.notifiedAt;
            records.set(id, next);
        },
        async unnotified() {
            const out = [];
            for (const record of records.values()) {
                if (isFinalPaymentStatus(record.status) && record.notifiedAt === undefined)
                    out.push(structuredClone(record));
            }
            return out;
        },
        withPhoneLock(phone, work) {
            const previous = locks.get(phone) ?? Promise.resolve();
            const run = previous.then(work, work);
            const tail = run.catch(() => { });
            locks.set(phone, tail);
            void tail.then(() => {
                if (locks.get(phone) === tail)
                    locks.delete(phone);
            });
            return run;
        },
        async get(id) {
            const record = records.get(id);
            return record ? structuredClone(record) : null;
        },
        async pending(olderThanMs) {
            const cutoff = Date.now() - olderThanMs;
            const out = [];
            for (const record of records.values()) {
                if (!isFinalPaymentStatus(record.status) && record.createdAt <= cutoff) {
                    out.push(structuredClone(record));
                }
            }
            return out;
        },
        async totals(phone, currency, sinceMs) {
            let pending = "0";
            let completed = "0";
            let pendingCount = 0;
            for (const record of records.values()) {
                if (record.phone !== phone)
                    continue;
                const inFlight = !isFinalPaymentStatus(record.status);
                // The window limits what counts as done today. A payment still in flight
                // counts however old it is: its money may yet move and it still blocks a new one.
                if (!inFlight && record.createdAt < sinceMs)
                    continue;
                // A payment still in flight blocks a new one whatever its currency.
                if (inFlight)
                    pendingCount += 1;
                if (record.currency !== currency)
                    continue;
                if (record.status === "COMPLETED") {
                    completed = addDecimal(completed, record.amount);
                }
                else if (inFlight || record.status === "UNRESOLVED") {
                    pending = addDecimal(pending, record.amount);
                }
            }
            return { pending, completed, pendingCount };
        },
        get size() {
            return records.size;
        },
    };
}
/** The record's id is its identity; no update may change it. */
function assertSameId(id, change) {
    if (change.id !== undefined && change.id !== id) {
        throw new Error(`A payment's id cannot change (${id} to ${change.id})`);
    }
}
/** Adds two decimal strings exactly, in integers, however large. */
function addDecimal(a, b) {
    const toCents = (s) => {
        const [whole = "0", frac = ""] = s.split(".");
        return BigInt(`${whole}${(frac + "00").slice(0, 2)}`);
    };
    const total = toCents(a) + toCents(b);
    const whole = total / 100n;
    const cents = (total % 100n).toString().padStart(2, "0");
    return `${whole}.${cents}`;
}