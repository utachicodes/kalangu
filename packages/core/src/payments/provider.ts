/**
 * Payment provider port (docs/payments-design.md §10, §6).
 *
 * Core defines the interface and result types. A concrete provider
 * (pawaPay, a fake for tests and the simulator) implements it. Core never
 * calls a provider directly except through this port, so swapping providers
 * or testing without one requires no change to the engine.
 */

import type { PaymentRecord } from "./store.js";

/** A provider that can handle this phone number and currency. */
export interface ProviderChoice {
  /** Provider code, e.g. "MTN_MOMO_KEN". */
  readonly provider: string;
  /** The phone number in the provider's format (MSISDN, no leading "+"). */
  readonly phone: string;
  readonly country?: string;
}

/** The provider cannot serve this payment, with a user-safe reason. */
export interface Refusal {
  readonly kind:
    | "unknown-operator"
    | "provider-closed"
    | "amount-bounds"
    | "decimals"
    | "currency";
  /** Localized, safe to show the user. Never a raw provider code. */
  readonly message: string;
}

/** Result of initiating a payment. */
export interface InitiateResult {
  readonly status: "ACCEPTED" | "REJECTED" | "UNKNOWN" | "DUPLICATE_IGNORED";
  /** Verbose provider failure code; logged for the developer, never shown. */
  readonly failureCode?: string;
}

/** Result of checking a payment's status. */
export interface StatusResult {
  readonly found: boolean;
  readonly status?:
    | "ACCEPTED"
    | "PROCESSING"
    | "COMPLETED"
    | "FAILED"
    | "REJECTED"
    | "IN_RECONCILIATION";
}

/** A callback route a provider exposes, mounted like a gateway route. */
export interface PaymentRoute {
  readonly path: string;
  readonly handler: (req: Request) => Promise<Response>;
}

/** A payment provider: resolves the operator, initiates, checks status. */
export interface PaymentProvider {
  readonly id: string;
  readonly routes?: readonly PaymentRoute[];
  resolve(
    phone: string,
    amount: string,
    currency: string,
  ): Promise<ProviderChoice | Refusal>;
  initiate(payment: PaymentRecord): Promise<InitiateResult>;
  status(id: string): Promise<StatusResult>;
}

export type ProviderOutcome = ProviderChoice | Refusal;
