# Kalangu — 0.2 payments design

Status: **draft for review. No payment code exists, and none should be
written until this document is reviewed** (CONTRIBUTING: money code should
not be rushed).
Date: 2026-11-16. Scope: version 0.2 only: collecting money from the user
(a mobile-money deposit) through pawaPay. Payouts and refunds are out of
scope (§11).

---

## 1. What 0.2 is

An agent can ask the user to pay, safely:

> On a keypad phone, the user picks "Pay for consultation", sees
> "Pay 500 KES to CLINIC for Consultation? 1. Yes 2. No", presses 1, gets
> their mobile-money PIN prompt from their own operator, enters the PIN
> there, and receives an SMS receipt. The agent continues from "paid" or
> "not paid", and never sees the PIN.

Three properties matter more than features:

1. **No double charge.** Every payment has one id, stored before the
   provider is called, and every retry reuses it.
2. **No lost outcome.** A payment's final status is always reached, by
   callback or by polling, even when callbacks never arrive.
3. **Refused before asked.** Limits are checked before the user sees a
   confirm screen, so the user is never asked to approve a payment the
   agent would then refuse.

---

## 2. pawaPay facts (read 16 Nov 2026)

Sources: pawaPay v2 documentation, `docs.pawapay.io/v2/docs/deposits`,
`docs.pawapay.io/v2/docs/what_to_know`, `docs.pawapay.io/v2/docs/signatures`
and the v2 API reference. **pawaPay's terms of service have not been read
yet**; that item stays open on the TODO. Everything below needs
confirming in the sandbox before code relies on it (§12).

### 2.1 Deposits

- **Initiate**: `POST /v2/deposits` (sandbox host
  `api.sandbox.pawapay.io`; bearer-token auth, and sandbox tokens only
  work against the sandbox).
- **Fields**: `depositId` (a UUIDv4 the merchant generates), `amount` as a
  **string** (`"100"`), `currency`, and `payer: { type: "MMO",
  accountDetails: { phoneNumber, provider } }`. The phone number is an
  MSISDN with country code and **no `+`** (`250783456789`); the provider is
  a code such as `MTN_MOMO_RWA`.
- **The docs say to store `depositId` before initiating.** Sending the same
  id again is safe and returns `DUPLICATE_IGNORED`.
- **Initiation response**: `ACCEPTED`, `REJECTED` (with `failureReason:
  { failureCode, failureMessage }`) or `DUPLICATE_IGNORED`. An HTTP 500
  with `UNKNOWN_ERROR` carries no status at all: the outcome is unknown
  and must be checked.
- **Statuses** seen in the docs: `ACCEPTED`, `PROCESSING`, `COMPLETED`,
  `FAILED`, `IN_RECONCILIATION`. Check-status lookups return `FOUND` or
  `NOT_FOUND`.
- **Failure codes** named in the docs include `INVALID_AMOUNT`,
  `AMOUNT_OUT_OF_BOUNDS`, `INVALID_CURRENCY`,
  `PROVIDER_TEMPORARILY_UNAVAILABLE`, `UNSPECIFIED_FAILURE`. The full list
  is on pawaPay's failure-codes page and is not reproduced here.
- **"Accepted" is not "paid".** A user's real wallet limits depend on their
  history, so an accepted deposit can still fail.

### 2.2 Before initiating

- **Predict provider**: `POST /v2/predict-provider` with a phone number
  returns the country, the provider, and a sanitised phone number.
- **Active configuration**: `GET /v2/active-conf?country=…&operationType=DEPOSIT`
  returns, per provider: `minAmount`, `maxAmount`, `decimalsInAmount`
  (`NONE` or `TWO_PLACES`), `status` (`OPERATIONAL` or `CLOSED`),
  `pinPrompt` (`AUTOMATIC` or `MANUAL`), `pinPromptRevivable`, and
  instructions. A provider with `decimalsInAmount: NONE` rejects
  `"100.50"`. (One example in the docs contradicts itself on a provider's
  decimals; trust the live configuration, not examples.)
- pawaPay stops accepting payments to an operator whose success rate drops,
  so a provider can be `CLOSED` at any moment.

### 2.3 Callbacks

- Sent once a deposit reaches a final status, to a URL set in the pawaPay
  dashboard. The handler must answer `200` quickly (10 s to connect, 30 s
  to respond), must be **idempotent**, and must not sit behind normal auth.
- **Retries**: up to 8 attempts over about 25 minutes (0, 1, 2, 5, 10, 15,
  20, 25 min). Slow answers or `429` can make attempts be skipped.
- **Callbacks can be missed** (pawaPay's own words: network issues,
  downtime, misconfiguration). Resend is possible for 90 days; after that,
  only check-status.
- **Signed callbacks** can be switched on in the dashboard: RFC 9421 HTTP
  message signatures (`Signature`, `Signature-Input`, `Signature-Date`,
  `Content-Digest` headers), verified with pawaPay's public key from a
  public-keys endpoint. Unlike Africa's Talking, this gives us something
  real to verify.
- **Source IPs** are published (one for sandbox, six for production), so
  an allowlist is possible as a second layer.
- During operator trouble, final statuses can be delayed while pawaPay
  reconciles; `IN_RECONCILIATION` covers this.

---

## 3. The USSD problem this design is built around

A phone runs **one USSD session at a time**. The operator's PIN prompt for
a mobile-money payment is usually itself a network-initiated USSD (or
SIM-toolkit) prompt. If our USSD session is still open when the deposit is
initiated, the PIN prompt may be blocked, delayed or dropped, depending on
the operator.

**Decision: on USSD, a payment always ends our session first.** The
confirm screen's "Yes" answers `END` with "You will receive a prompt to
enter your PIN", and only then is the deposit initiated, in the
background. This has a useful side effect: the 10-second USSD response
bound never applies to the provider call.

This behaviour is **not verified** on any operator (§12, item 1). It is
the single most important thing to test, since the design depends on it.

---

## 4. Turns and steps

### 4.1 The `pay` turn

v0.1 reserved `{ kind: "pay"; amount: number; currency: string; reason?:
string }`. **Proposed change before 0.2 ships: `amount` becomes a decimal
string** (`"500"`, `"2500.50"`). pawaPay takes strings, and binary floats
cannot represent most decimal amounts exactly. `parseTurn` would accept
`/^\d+(\.\d{1,2})?$/` and reject anything else. No channel renders `pay`
yet, so nothing breaks.

### 4.2 The `pay` step

```ts
pay(
  // The amount may depend on the session (e.g. the visit type chosen).
  (ctx) => ({ amount: "500", currency: "KES", reason: { en: "Consultation", fr: "Consultation" } }),
  {
    onPaid: say({ en: "Paid. See you on Monday.", fr: "Payé. À lundi." }),
    onFailed: (payment, ctx) => `Payment not completed: ${payment.reason}`,
    onDeclined: menu("No problem", { … }),   // user said No on the confirm
  },
)
```

- The step renders as a **confirm**: "Pay 500 KES to CLINIC for
  Consultation?" with localized Yes/No. The payee name comes from agent
  config (`payments.payeeName`), never from the model.
- **Model output never sets the amount.** The amount function receives the
  context, so a developer *can* compute it from model output, but the
  documentation says not to, and the policy layer caps it either way.
- `onPaid` / `onFailed` run when the final status arrives, which is after
  the USSD session has ended, so their output goes out **by SMS**, the same
  path as a deferred answer (v0.1 §4.6). `onFailed` receives a reason the
  user can read (§7.3), never a raw provider code.

### 4.3 Flow

```
pay step reached
  → policy check (§5)            refused → onFailed with a policy reason, no confirm shown
  → resolve provider (§6.2)      unknown/closed → onFailed, no confirm shown
  → confirm screen (CON)
user presses 2 → onDeclined
user presses 1
  → record payment as CREATED, with a new UUIDv4 (durable store, §6.1)
  → END "You will receive a prompt to enter your PIN" (localized)
  → background: initiate deposit (§6.3)
  → PIN prompt on the user's phone (operator, not us)
  → final status via callback or polling (§6.4, §6.5)
  → onPaid / onFailed rendered for SMS and sent; receipt included (§7.2)
```

On SMS the same flow applies, except the confirm is "Reply YES or NO" and
there is no live session to end.

---

## 5. Policy layer

Checked **before** the confirm screen, and again (cheaply) just before
initiating, in case the limits changed in between.

```ts
createAgent({
  payments: {
    provider: pawapay({ token: process.env.PAWAPAY_TOKEN, sandbox: true }),
    store: myDurablePaymentStore,
    payeeName: "CLINIC",
    policy: {
      currencies: ["KES"],              // anything else is refused
      maxPerPayment: { KES: "5000" },
      maxPerDayPerPhone: { KES: "10000" },
      maxPendingPerPhone: 1,            // one payment in flight per user
    },
  },
});
```

- **Daily limits count pending payments too**, not only completed ones;
  otherwise a user could start several payments at once. "Day" is a
  rolling 24 hours, which avoids time-zone questions.
- **Amounts are compared as decimals**, using integer minor units
  internally; never as floats.
- Provider limits (`minAmount`/`maxAmount` from active configuration) are
  checked as well; the stricter of ours and theirs wins.
- **No policy, no payments.** `payments` without a `policy` is a startup
  error. Unbounded payments should be impossible to configure by accident.
- A refusal is logged (masked phone, amount, rule) and reaches `onFailed`
  with a localized reason. The user is never shown the confirm screen.

---

## 6. Provider integration

### 6.1 The payment store

Payments get their own durable store, separate from sessions:

```ts
interface PaymentStore {
  create(payment: PaymentRecord): Promise<void>;          // fails if the id exists
  update(id: string, change: Partial<PaymentRecord>): Promise<PaymentRecord>;
  get(id: string): Promise<PaymentRecord | null>;
  pending(olderThanMs: number): Promise<PaymentRecord[]>; // for reconciliation
  totals(phone: string, currency: string, sinceMs: number): Promise<{ pending: string; completed: string }>;
}

interface PaymentRecord {
  id: string;              // our UUIDv4, also pawaPay's depositId
  phone: string;           // personal data: masked in logs
  provider: string;        // e.g. "MTN_MOMO_KEN"
  amount: string;
  currency: string;
  reason: string;
  stepId: string;          // which pay step, to resume onPaid/onFailed
  locale: string;
  status: "CREATED" | "ACCEPTED" | "PROCESSING" | "IN_RECONCILIATION"
        | "COMPLETED" | "FAILED" | "REJECTED" | "UNKNOWN";
  failureCode?: string;    // the provider's, verbatim, for the developer
  createdAt: number;
  updatedAt: number;
  finalizedAt?: number;
  notifiedAt?: number;     // when onPaid/onFailed was sent; makes it once-only
}
```

- An in-memory store ships **for tests and the simulator only**. Using it
  with a real provider logs an error at startup: a restart would forget
  pending payments.
- `notifiedAt` makes the user-facing outcome **exactly once**: whichever of
  callback or poll reaches a final status first sets it (a conditional
  update), and the other sees it set and does nothing.

### 6.2 Resolving the provider

Predict the provider from the phone number, then check active
configuration: provider `OPERATIONAL`, amount within its bounds, decimals
allowed. Cache active configuration briefly (proposed 5 minutes) to keep
the confirm screen fast; re-check just before initiating. If prediction
fails, v0.2 refuses with a localized message rather than asking the user
to pick an operator (open question 4).

### 6.3 Initiating

1. Write the record as `CREATED` (this is the idempotency anchor).
2. Call `POST /v2/deposits` with `depositId = record.id`.
3. `ACCEPTED` or `DUPLICATE_IGNORED` → `ACCEPTED`. `REJECTED` → final
   `REJECTED`, keep `failureCode`. Network error, timeout or HTTP 500
   `UNKNOWN_ERROR` → `UNKNOWN`: **never re-initiate blindly with a new
   id**; check status for the same id, and re-send the same id only if the
   provider says `NOT_FOUND`.

### 6.4 Callbacks

- A route in the adapter, like the gateway routes in v0.1. It answers
  `200` immediately and processes in the background.
- **Signature verification is on by default** (RFC 9421, pawaPay's public
  key, fetched and cached). An unsigned or badly signed callback is logged
  and ignored, and `200` is still returned so pawaPay stops retrying a
  request we will never trust. Turning verification off is an explicit,
  logged opt-out for local testing.
- **The callback body is a hint, not the truth.** On a valid callback the
  adapter calls check-status for that id and acts on that answer. One
  extra request per payment is worth not trusting a body alone with money.
- Unknown ids are logged and ignored.

### 6.5 Polling and reconciliation

Callbacks can be missed, and MTN MoMo callbacks are known not to always
arrive (TODO), so every accepted payment is also polled:

- After initiating, check status at about 30 s, 1, 2, 5, 10 and 30 minutes,
  then hourly until final or 72 hours old.
- These timers run in-process via `BackgroundWork` for convenience, but a
  restart loses them. So there is also a **`reconcilePayments()`** function
  that a cron job or scheduler calls (proposed every 5 minutes); it checks
  every non-final payment from `PaymentStore.pending()`. On serverless
  platforms this is the only reliable path, and the README says so.
- After 72 hours still non-final: mark `UNKNOWN`, log an error for a human,
  and tell the user "we could not confirm your payment; contact …"
  (configurable). Never guess "paid".

---

## 7. What the user sees

### 7.1 Screens and messages (localized, `en`/`fr` first)

- Confirm: "Pay {amount} {currency} to {payee} for {reason}?"
- After Yes on USSD (`END`): "You will receive a prompt to enter your PIN.
  We will send an SMS when the payment is done."
- If `pinPromptRevivable` and no final status after about 15 s: an SMS with
  the operator's own instructions for bringing the prompt back (from
  active configuration). Proposed; see open question 5.
- Policy refusal: "This payment is above the allowed limit."
- Provider closed: "Payments with your operator are unavailable right now.
  Please try later."

### 7.2 Receipts

Every completed payment sends an SMS receipt: amount, currency, payee,
reason, date, and a short reference (the first 8 characters of the id).
`onPaid`'s message follows in the same SMS if it fits the segment budget,
otherwise as a second one. Receipts are fixed strings in the locale files.

### 7.3 Failure reasons

Provider codes are mapped to a few user-facing reasons: "not enough
balance", "payment cancelled or timed out", "limit reached", "operator
unavailable", "something went wrong". The raw code goes to the developer
log and `payment.failureCode`, never to the user.

---

## 8. Never the PIN

- Kalangu never asks for, receives, stores or logs a PIN. The PIN goes
  from the user to their operator.
- **Guard**: `createAgent` warns when an `ask` step's text, in any locale,
  mentions "PIN", "code secret", "mot de passe" or "password". A warning,
  not an error: legitimate uses exist ("Do not share your PIN").
- The docs say plainly: an agent that asks for a PIN is a phishing
  pattern, and operators and users are right to treat it as one.

---

## 9. What Kalangu does not guarantee

Stated in the README and the package docs, not only here:

- That money arrives. Kalangu reports what pawaPay reports.
- That a payment within your limits succeeds. Operators apply their own
  wallet limits, which depend on the user's history.
- Fast outcomes. During operator trouble, final statuses can take a long
  time (`IN_RECONCILIATION`).
- Anything about fees. pawaPay deducts fees from the collected amount.
- Regulatory compliance. Licensing, KYC, consumer protection and tax are
  the deployer's responsibility, per country.
- Reliability with an in-memory payment store, or without
  `reconcilePayments()` running somewhere.

---

## 10. Packages

```
packages/core    pay turn + step, policy layer, PaymentStore interface,
                 PaymentProvider interface, memory store, reconcilePayments
packages/pawapay @kalangu/pawapay: the PaymentProvider for pawaPay v2 (HTTP,
                 signatures, callbacks, active configuration)
packages/sim     a fake provider: prints "PIN prompt: pay 500 KES to CLINIC?
                 (y/n)" and settles the payment after a delay
```

Core keeps zero runtime dependencies. Signature verification uses Web
Crypto (`crypto.subtle`), available in Node 20, Deno, Bun and Workers.

```ts
interface PaymentProvider {
  readonly id: string;
  resolve(phone: string, amount: string, currency: string): Promise<ProviderChoice | Refusal>;
  initiate(payment: PaymentRecord): Promise<InitiateResult>;
  status(id: string): Promise<StatusResult>;      // FOUND with status, or NOT_FOUND
  readonly routes?: readonly Route[];             // callbacks
}
```

---

## 11. Out of scope for 0.2

Payouts (sending money to users), refunds, partial payments, payment
links, card payments, currency conversion, subscriptions and recurring
payments, more than one payment provider in the same agent, and any
provider other than pawaPay.

---

## 12. Verify first (needs a sandbox account or a real phone)

1. **A USSD session ending just before the PIN prompt**: does the prompt
   arrive reliably on each operator we target? How soon after `END` is it
   safe to initiate? (§3; the design depends on this.)
2. pawaPay's **terms of service**, fees, settlement, and which countries
   and operators are live (the 24-country figure is the company's own).
3. Exact **check-status** path and response shape, and the full
   **failure-code** list.
4. **Signed callbacks** in the sandbox: header set, algorithm, and the
   public-key endpoint, end to end.
5. Real **callback reliability** per operator, especially MTN MoMo, to tune
   the polling schedule.
6. What the user sees when they ignore or cancel the PIN prompt, and how
   long until pawaPay reports `FAILED`.

---

## 13. Testing plan (priority order)

1. **Idempotency**: retries after network errors, timeouts and HTTP 500
   reuse the same id; `DUPLICATE_IGNORED` is handled; no path creates a
   second id for one confirm.
2. **Exactly-once outcome**: callback and poll racing; duplicate callbacks;
   callback before the initiate response returns; process restart with
   pending payments, then `reconcilePayments()`.
3. **Policy**: per-payment, daily (including pending), pending-count and
   currency limits; decimal edge cases; refusal before any confirm screen.
4. **Signatures**: valid, tampered body, wrong key, missing headers,
   verification turned off.
5. **Provider configuration**: `CLOSED` operator, amount outside bounds,
   decimals not allowed, unknown phone prefix.
6. **Flow on both channels**: USSD ends before initiating; SMS confirm;
   receipts within the SMS budget in `en` and `fr`.
7. A recorded sandbox run as fixtures, once an account exists.

---

## 14. Open questions

1. **`amount` as a decimal string** in the `pay` turn (§4.1)? Recommended.
2. **Re-check the callback with check-status** (one extra request per
   payment) or trust a verified signature alone? Recommended: re-check.
3. **Polling schedule and 72-hour give-up** (§6.5): too long, too short?
4. **Unknown operator**: refuse (proposed), or show an operator menu?
5. **PIN-prompt revival SMS** (§7.1): helpful, or noise when the prompt
   simply took a few seconds?
6. **One pending payment per user** (`maxPendingPerPhone: 1`) as the
   default?
7. **Where receipts go when SMS sending fails**: retry policy, and whether
   to surface it in `onPaid`.
