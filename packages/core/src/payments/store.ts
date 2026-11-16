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
  | "UNKNOWN";

export interface PaymentRecord {
  /** Our UUIDv4, also sent to the provider as the idempotency key. */
  readonly id: string;
  /** Personal data: masked in logs, never displayed unmasked by tooling. */
  readonly phone: string;
  readonly provider: string;
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
}

export interface PaymentStore {
  /** Creates the record. Fails if the id already exists (idempotency anchor). */
  create(payment: PaymentRecord): Promise<void>;
  /** Atomically applies a partial change and returns the updated record. */
  update(id: string, change: Partial<PaymentRecord>): Promise<PaymentRecord>;
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
  ): Promise<{ pending: string; completed: string }>;
}

/**
 * In-process store. Ships for tests and the simulator only. Lost on restart,
 * so using it with a real provider logs an error at startup.
 */
export function memoryPaymentStore(): PaymentStore & { readonly size: number } {
  const records = new Map<string, PaymentRecord>();
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
      const next: PaymentRecord = structuredClone({ ...current, ...change, updatedAt: Date.now() });
      records.set(id, next);
      return next;
    },
    async get(id) {
      const record = records.get(id);
      return record ? structuredClone(record) : null;
    },
    async pending(olderThanMs) {
      const cutoff = Date.now() - olderThanMs;
      const out: PaymentRecord[] = [];
      for (const record of records.values()) {
        if (
          record.status !== "COMPLETED" &&
          record.status !== "FAILED" &&
          record.status !== "REJECTED" &&
          record.status !== "UNKNOWN" &&
          record.createdAt < cutoff
        ) {
          out.push(structuredClone(record));
        }
      }
      return out;
    },
    async totals(phone, currency, sinceMs) {
      let pending = "0";
      let completed = "0";
      for (const record of records.values()) {
        if (record.phone !== phone || record.currency !== currency) continue;
        if (record.createdAt < sinceMs) continue;
        if (
          record.status === "COMPLETED" ||
          record.status === "REJECTED" ||
          record.status === "FAILED"
        ) {
          completed = addDecimal(completed, record.amount);
        } else {
          pending = addDecimal(pending, record.amount);
        }
      }
      return { pending, completed };
    },
    get size() {
      return records.size;
    },
  };
}

function addDecimal(a: string, b: string): string {
  const toCents = (s: string) => {
    const [whole, frac = ""] = s.split(".");
    return Number(`${whole}${(frac + "00").slice(0, 2)}`);
  };
  return fromMinorUnits(toCents(a) + toCents(b));
}

function fromMinorUnits(minorUnits: number): string {
  const abs = Math.abs(minorUnits);
  const whole = Math.floor(abs / 100);
  const cents = abs % 100;
  const sign = minorUnits < 0 ? "-" : "";
  return `${sign}${whole}.${cents.toString().padStart(2, "0")}`;
}
