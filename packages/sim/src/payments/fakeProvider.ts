/**
 * Fake payment provider for the simulator and tests (docs/payments-design.md
 * §10, packages/sim).
 *
 * It settles a payment after a delay. No network, no real money, no pawaPay. Intended for local
 * development only — never configured with a real provider token.
 */

import type {
  InitiateResult,
  PaymentProvider,
  ProviderChoice,
  Refusal,
  StatusResult,
} from "@kalangu/core";

export interface FakeProviderOptions {
  /** Provider code reported to the agent. Default "FAKE_MOMO". */
  readonly provider?: string;
  /** Country reported by resolve. Default "XA". */
  readonly country?: string;
  /** Milliseconds before an initiated payment auto-settles. Default 3000. */
  readonly settleAfterMs?: number;
  /** If true, a payment settles as FAILED instead of COMPLETED. */
  readonly alwaysFail?: boolean;
  /** If true, resolve returns a refusal instead of a provider choice. */
  readonly alwaysRefuse?: boolean;
}

/**
 * Creates a fake provider. Outcomes are driven by `status()`. Use
 * `settleAfterMs` to simulate a slow provider; `alwaysFail` / `alwaysRefuse`
 * to simulate failure paths. No network, no real money.
 */
export function createFakeProvider(
  options: FakeProviderOptions = {},
): PaymentProvider {
  const provider = options.provider ?? "FAKE_MOMO";
  const country = options.country ?? "XA";
  const settleAfterMs = options.settleAfterMs ?? 3000;
  const alwaysFail = options.alwaysFail ?? false;
  const alwaysRefuse = options.alwaysRefuse ?? false;

  const initiatedAt = new Map<string, number>();

  return {
    id: "fake",
    async resolve(_phone: string, _amount: string, _currency: string) {
      if (alwaysRefuse) {
        const refusal: Refusal = {
          kind: "provider-closed",
          message: "Payments with your operator are unavailable right now.",
        };
        return refusal;
      }
      const choice: ProviderChoice = {
        provider,
        phone: _phone.replace(/^\+/, ""),
        country,
      };
      return choice;
    },
    async initiate(payment): Promise<InitiateResult> {
      // Accepted now; the outcome shows up in status() once the delay has passed.
      if (!initiatedAt.has(payment.id)) initiatedAt.set(payment.id, Date.now());
      return { status: "ACCEPTED" };
    },
    async status(id: string): Promise<StatusResult> {
      const started = initiatedAt.get(id);
      // Like the real thing, a payment that was never initiated is not found.
      if (started === undefined) return { found: false };
      if (Date.now() - started < settleAfterMs) return { found: true, status: "PROCESSING" };
      return { found: true, status: alwaysFail ? "FAILED" : "COMPLETED" };
    },
  };
}
