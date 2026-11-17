/**
 * Sessions (docs/design.md §4.5), keyed by phone number rather than the
 * gateway's session id, so a dropped USSD session resumes on redial.
 */

import type { Turn } from "./turns.js";

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export interface PayIntent {
  amount: string;
  currency: string;
  reason: string;
  /** Provider code and MSISDN chosen when the offer was made. */
  provider: string;
  providerPhone: string;
}

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
  /**
   * The payment the user was last offered on a pay step: exactly what the
   * confirm screen showed, so "Yes" pays that and nothing else. Optional so
   * sessions stored before 0.2 still load.
   */
  payIntent?: PayIntent | null;
  /** Set while a deferred answer is still being produced. */
  deferred: { since: number } | null;
  updatedAt: number;
  /**
   * An opaque, random token for the turn on screen: a positive integer, new
   * every time a new turn is shown and kept when the same turn is shown again
   * (a typed mistake, a page change). A channel with tappable history puts it
   * in its button ids so a tap on an old message can be recognised and refused.
   * It is random, not a counter, so a fresh or cleared session cannot reuse an
   * old session's value, and two requests that render different turns at the
   * same moment cannot share one. Absent on sessions stored before 0.4, read
   * as 0, which no turn ever has.
   */
  turnId?: number;
  /**
   * Bumped by the store on every save. Lets `save` refuse a write based on a
   * stale read (`ifVersion`). Absent on sessions stored before 0.2, read as 0.
   */
  version?: number;
  /** Kept for correlating logs with the gateway; never used as the key. */
  gatewaySessionId: string | null;
}

/** A versioned save found a newer record than the one it was based on. */
export class SessionConflictError extends Error {
  override readonly name = "SessionConflictError";
}

export interface SessionSaveOptions {
  /**
   * Save only if the stored record's version is still this (a missing record
   * counts as 0), atomically; otherwise throw `SessionConflictError` and
   * change nothing. Without it, the last write wins.
   */
  readonly ifVersion?: number;
}

export interface SessionStore {
  load(phone: string): Promise<SessionRecord | null>;
  /**
   * Stores the record and bumps `record.version`. Must honour `ifVersion`
   * atomically if `atomic` is true.
   */
  save(record: SessionRecord, options?: SessionSaveOptions): Promise<void>;
  /**
   * True when `save` honours `ifVersion` atomically across every process
   * that shares the store (a conditional UPDATE, a Redis WATCH/MULTI).
   * Required when the agent takes payments: a double-tapped "Yes" is stopped
   * by it.
   */
  readonly atomic?: boolean;
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
