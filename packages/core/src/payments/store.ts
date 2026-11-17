/**
 * Payment store (docs/payments-design.md §6.1).
 *
 * Payments get their own durable store, separate from sessions, because a
 * payment outlives the USSD session that created it: the session ends before
 * the PIN prompt, and the outcome arrives later by callback or polling.
 */

export type PaymentStatus =
  | "CREATED"
  | "ACCEPTED"
  | "PROCESSING"
  | "IN_RECONCILIATION"
  | "COMPLETED"
  | "FAILED"
  | "REJECTED"
  | "UNKNOWN"
  /** No final status after the give-up window; money may have moved. */
  | "UNRESOLVED";

/** Statuses after which nothing more is expected from the provider. */
export function isFinalPaymentStatus(status: PaymentStatus): boolean {
  return status === "COMPLETED" || status === "FAILED" || status === "REJECTED" || status === "UNRESOLVED";
}

export interface PaymentRecord {
  /** Our UUIDv4, also sent to the provider as the idempotency key. */
  readonly id: string;
  /** Personal data: masked in logs, never displayed unmasked by tooling. */
  readonly phone: string;
  readonly provider: string;
  /** The payer's number in the provider's own format (MSISDN, no "+"), as resolved when offered. */
  readonly providerPhone: string;
  /** Decimal string, e.g. "500.00". Never a float. */
  readonly amount: string;
  readonly currency: string;
  readonly reason: string;
  /** Which pay step, so onPaid/onFailed can resume the right place. */
  readonly stepId: string;
  readonly locale: string;
  readonly status: PaymentStatus;
  /** The provider's code, verbatim. Developer log only, never shown to user. */
  readonly failureCode?: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly finalizedAt?: number;
  /** Set when onPaid/onFailed has been sent; makes the outcome exactly once. */
  readonly notifiedAt?: number;
  /** How many times delivering the outcome failed and was released for retry. */
  readonly notifyAttempts?: number;
}

export interface PaymentTotals {
  /** Amount of payments still in flight or of unknown outcome (money may move). */
  readonly pending: string;
  /** Amount of completed payments. Failed and rejected ones never count. */
  readonly completed: string;
  /** Payments still awaiting a provider outcome, for `maxPendingPerPhone`. */
  readonly pendingCount: number;
}

export interface PaymentStore {
  /** Creates the record. Fails if the id already exists (idempotency anchor). */
  create(payment: PaymentRecord): Promise<void>;
  /** Applies a partial change and returns the updated record. */
  update(id: string, change: Partial<PaymentRecord>): Promise<PaymentRecord>;
  /**
   * Compare-and-set on the status: applies `change` only if the record's
   * current status is one of `from`, atomically, and returns the updated
   * record. Returns null (changing nothing) when the record is missing or in
   * another status. This is what keeps a final status final when two
   * processes, or a late callback, disagree.
   */
  transition(
    id: string,
    change: Partial<PaymentRecord>,
    from: readonly PaymentStatus[],
  ): Promise<PaymentRecord | null>;
  /**
   * Compare-and-set on `notifiedAt`: sets it to `at` only if it is unset,
   * atomically. Returns the updated record to exactly one caller and null to
   * every other, so the user hears each outcome once however many processes
   * race to deliver it.
   */
  claimNotification(id: string, at: number): Promise<PaymentRecord | null>;
  /**
   * Undoes a claim after delivery failed, so a later sweep can try again, and
   * counts the failure in `notifyAttempts`. Only the process that holds the
   * claim calls it.
   */
  releaseNotification(id: string): Promise<void>;
  /** Final payments whose outcome has not been delivered, for the reconcile sweep. */
  unnotified(): Promise<PaymentRecord[]>;
  /**
   * Runs `work` while holding a lock for this phone number, across every
   * process that shares the store (a Postgres advisory lock, a Redis lock).
   * The engine checks the payment limits and records the payment inside it,
   * so two simultaneous "Yes" answers cannot both pass a limit of one.
   */
  withPhoneLock<T>(phone: string, work: () => Promise<T>): Promise<T>;
  get(id: string): Promise<PaymentRecord | null>;
  /**
   * Payments older than the threshold that are not yet final, for
   * reconciliation by a cron job or scheduler.
   */
  pending(olderThanMs: number): Promise<PaymentRecord[]>;
  /**
   * Pending and completed totals for a phone/currency in the last window,
   * used by the policy layer's per-day check.
   */
  totals(
    phone: string,
    currency: string,
    sinceMs: number,
  ): Promise<PaymentTotals>;
}

/**
 * In-process store. Ships for tests and the simulator only. Lost on restart,
 * so using it with a real provider logs an error at startup.
 */
export function memoryPaymentStore(): PaymentStore & { readonly size: number } {
  const records = new Map<string, PaymentRecord>();
  const locks = new Map<string, Promise<unknown>>();
  return {
    async create(payment) {
      if (records.has(payment.id)) {
        throw new Error(`Payment ${payment.id} already exists`);
      }
      records.set(payment.id, structuredClone(payment));
    },
    async update(id, change) {
      const current = records.get(id);
      if (!current) throw new Error(`Payment ${id} not found`);
      assertSameId(id, change);
      const next: PaymentRecord = structuredClone({ ...current, ...change, updatedAt: Date.now() });
      records.set(id, next);
      return structuredClone(next);
    },
    async transition(id, change, from) {
      const current = records.get(id);
      if (!current || !from.includes(current.status)) return null;
      assertSameId(id, change);
      const next: PaymentRecord = structuredClone({ ...current, ...change, updatedAt: Date.now() });
      records.set(id, next);
      return structuredClone(next);
    },
    async claimNotification(id, at) {
      const current = records.get(id);
      if (!current || current.notifiedAt !== undefined) return null;
      const next: PaymentRecord = { ...current, notifiedAt: at, updatedAt: Date.now() };
      records.set(id, next);
      return structuredClone(next);
    },
    async releaseNotification(id) {
      const current = records.get(id);
      if (!current || current.notifiedAt === undefined) return;
      const next: { -readonly [K in keyof PaymentRecord]: PaymentRecord[K] } = {
        ...current,
        notifyAttempts: (current.notifyAttempts ?? 0) + 1,
        updatedAt: Date.now(),
      };
      delete next.notifiedAt;
      records.set(id, next);
    },
    async unnotified() {
      const out: PaymentRecord[] = [];
      for (const record of records.values()) {
        if (isFinalPaymentStatus(record.status) && record.notifiedAt === undefined) out.push(structuredClone(record));
      }
      return out;
    },
    withPhoneLock(phone, work) {
      const previous = locks.get(phone) ?? Promise.resolve();
      const run = previous.then(work, work);
      const tail = run.catch(() => {});
      locks.set(phone, tail);
      void tail.then(() => {
        if (locks.get(phone) === tail) locks.delete(phone);
      });
      return run;
    },
    async get(id) {
      const record = records.get(id);
      return record ? structuredClone(record) : null;
    },
    async pending(olderThanMs) {
      const cutoff = Date.now() - olderThanMs;
      const out: PaymentRecord[] = [];
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
        if (record.phone !== phone) continue;
        const inFlight = !isFinalPaymentStatus(record.status);
        // The window limits what counts as done today. A payment still in flight
        // counts however old it is: its money may yet move and it still blocks a new one.
        if (!inFlight && record.createdAt < sinceMs) continue;
        // A payment still in flight blocks a new one whatever its currency.
        if (inFlight) pendingCount += 1;
        if (record.currency !== currency) continue;
        if (record.status === "COMPLETED") {
          completed = addDecimal(completed, record.amount);
        } else if (inFlight || record.status === "UNRESOLVED") {
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
function assertSameId(id: string, change: Partial<PaymentRecord>): void {
  if (change.id !== undefined && change.id !== id) {
    throw new Error(`A payment's id cannot change (${id} to ${change.id})`);
  }
}

/** Adds two decimal strings exactly, in integers, however large. */
function addDecimal(a: string, b: string): string {
  const toCents = (s: string) => {
    const [whole = "0", frac = ""] = s.split(".");
    return BigInt(`${whole}${(frac + "00").slice(0, 2)}`);
  };
  const total = toCents(a) + toCents(b);
  const whole = total / 100n;
  const cents = (total % 100n).toString().padStart(2, "0");
  return `${whole}.${cents}`;
}
