/**
 * Sessions (docs/design.md §4.5), keyed by phone number rather than the
 * gateway's session id, so a dropped USSD session resumes on redial.
 */

import type { Turn } from "./turns.js";

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export interface SessionRecord {
  phone: string;
  locale: string;
  /** The step waiting for input, if any. */
  stepId: string | null;
  /** What the user is looking at and may answer or page through. */
  turn: Turn | null;
  page: number;
  /** The agent's own state (`ctx.session`). Must stay JSON-safe. */
  data: { [key: string]: Json };
  /** The channel id of the last exchange. */
  channel: string | null;
  /** Set while a deferred answer is still being produced. */
  deferred: { since: number } | null;
  updatedAt: number;
  /** Kept for correlating logs with the gateway; never used as the key. */
  gatewaySessionId: string | null;
}

export interface SessionStore {
  load(phone: string): Promise<SessionRecord | null>;
  save(record: SessionRecord): Promise<void>;
  clear(phone: string): Promise<void>;
}

/**
 * In-process store. Records are copied in and out so callers can't mutate
 * stored state by accident. Lost on restart; use a durable store in
 * production.
 */
export function memoryStore(): SessionStore & { readonly size: number } {
  const records = new Map<string, SessionRecord>();
  return {
    async load(phone) {
      const record = records.get(phone);
      return record ? structuredClone(record) : null;
    },
    async save(record) {
      records.set(record.phone, structuredClone(record));
    },
    async clear(phone) {
      records.delete(phone);
    },
    get size() {
      return records.size;
    },
  };
}

export function freshRecord(phone: string, locale: string, now: number): SessionRecord {
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
