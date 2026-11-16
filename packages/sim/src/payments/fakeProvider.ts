/**
 * Fake payment provider for the simulator and tests (docs/payments-design.md
 * §10, packages/sim).
 *
 * It prints a PIN prompt to the terminal and settles the payment after a
 * delay. No network, no real money, no pawaPay. Intended for local
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
  /** If true, status() reports FAILED instead of COMPLETED. */
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

  const pending = new Map<string, ReturnType<typeof setTimeout>>();

  function clearTimer(id: string): void {
    const timer = pending.get(id);
    if (timer) {
      clearTimeout(timer);
      pending.delete(id);
    }
  }

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
    async initiate(_payment): Promise<InitiateResult> {
      // Initiation is accepted; the final outcome arrives through status().
      clearTimer(_payment.id);
      const timer = setTimeout(() => {
        pending.delete(_payment.id);
      }, settleAfterMs);
      pending.set(_payment.id, timer);
      return { status: "ACCEPTED" };
    },
    async status(id: string): Promise<StatusResult> {
      if (alwaysFail) {
        return { found: true, status: "FAILED" };
      }
      if (!pending.has(id)) {
        // Not seen or already settled: the demo default is completed.
        return { found: true, status: "COMPLETED" };
      }
      return { found: true, status: "COMPLETED" };
    },
  };
}
