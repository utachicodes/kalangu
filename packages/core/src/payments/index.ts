/**
 * Payments (docs/payments-design.md §10, §5, §6).
 *
 * The policy layer, the payment store and the provider port live in core so
 * they can be tested and used without any provider package. A concrete
 * provider (pawaPay) and a fake provider (simulator, tests) implement the
 * port elsewhere.
 */

export type { PaymentRecord, PaymentStatus, PaymentTotals } from "./store.js";
export { isFinalPaymentStatus } from "./store.js";
export type { PaymentStore } from "./store.js";
export { memoryPaymentStore } from "./store.js";
export { checkPaymentStore } from "./storeChecks.js";
export type { CheckPaymentStoreOptions } from "./storeChecks.js";

export type {
  PaymentLimits,
  PaymentRefusal,
  ProviderBounds,
  PolicyCheck,
} from "./policy.js";
export { createPolicyCheck, isCurrency, maskPhoneForPolicy, refusalMessage, toMinorUnits, fromMinorUnits } from "./policy.js";

export type {
  PaymentProvider,
  ProviderChoice,
  ProviderOutcome,
  Refusal,
  InitiateResult,
  StatusResult,
  PaymentRoute,
} from "./provider.js";

export type { Offer, OfferResult, PaymentController, PaymentRefused, RefusalReason, ReconcileOptions, ReconcileReport, PaymentPolicyConfig, PaymentsConfig } from "./controller.js";
export {
  DEFAULT_GIVE_UP_AFTER_MS,
  DEFAULT_POLL_REPEAT_MS,
  DEFAULT_POLL_SCHEDULE_MS,
  MAX_NOTIFY_ATTEMPTS,
  createPaymentController,
} from "./controller.js";
