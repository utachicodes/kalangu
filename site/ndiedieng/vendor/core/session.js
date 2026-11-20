/**
 * Sessions (docs/design.md §4.5), keyed by phone number rather than the
 * gateway's session id, so a dropped USSD session resumes on redial.
 */
/** A versioned save found a newer record than the one it was based on. */
export class SessionConflictError extends Error {
    name = "SessionConflictError";
}
/**
 * In-process store. Records are copied in and out so callers can't mutate
 * stored state by accident. Lost on restart; use a durable store in
 * production.
 */
export function memoryStore() {
    const records = new Map();
    return {
        async load(phone) {
            const record = records.get(phone);
            return record ? structuredClone(record) : null;
        },
        async save(record, options) {
            const current = records.get(record.phone)?.version ?? 0;
            if (options?.ifVersion !== undefined && options.ifVersion !== current) {
                throw new SessionConflictError(`Session for ${record.phone} changed since it was read`);
            }
            record.version = current + 1;
            records.set(record.phone, structuredClone(record));
        },
        atomic: true,
        async clear(phone) {
            records.delete(phone);
        },
        get size() {
            return records.size;
        },
    };
}
export function freshRecord(phone, locale, now) {
    return {
        phone,
        locale,
        stepId: null,
        turn: null,
        page: 0,
        data: {},
        channel: null,
        deferred: null,
        updatedAt: now,
        gatewaySessionId: null,
    };
}