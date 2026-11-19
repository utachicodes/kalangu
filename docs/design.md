# Kalangu: v0.1 design

Status: **draft for review**. v0.1 is implemented in this repository;
§14 lists where the code differs from this document.
Date: 2026-11-16. Scope: version 0.1 only (core, ussd, sms, sim, one example).
Payments, WhatsApp, voice and language detection are explicitly out of scope.

---

## 1. What v0.1 is

A TypeScript toolkit for AI agents that work on any phone. A developer writes an
agent once; it runs over USSD and SMS. The one deliverable that matters:

> Someone clones the repo, runs `pnpm install && pnpm demo`, and within ten
> minutes has dialed a code on a simulated keypad phone, asked a question, seen
> the "we'll text you" screen, and received the answer as a simulated SMS.

The demo proves the three ideas that make Kalangu more than a menu builder:
typed turns rendered per channel, an encoding-aware budgeter, and deferral.

---

## 2. Verified gateway facts (checked 16 Nov 2026)

Sources: official docs `developers.africastalking.com/docs/*` (fetched full
text), official help centre `help.africastalking.com` (articles 1284071 and
1284096), and the official Node SDK source
`github.com/AfricasTalkingLtd/africastalking-node.js` (`lib/ussd.js`,
`lib/sms.js`, `lib/common.js`), which cites the legacy USSD spec.

### 2.1 USSD inbound callback

- **HTTP POST**, `Content-Type: application/x-www-form-urlencoded`, to the
  callback URL registered for the service code. Fired on dial and on every
  menu response.
- **Form fields**: `sessionId`, `phoneNumber`, `networkCode`, `serviceCode`,
  `text`.
- **`text` semantics**: empty string on the first request of a session;
  afterwards, all user input so far concatenated with `*` (e.g. `1*1*abc`).
  So the *new* input each turn is the last `*`-separated segment.
- **Response**: plain text (`Content-Type: text/plain`), HTTP 200, starting
  with `CON` to continue or `END` to terminate. The official SDK emits
  `"CON "` / `"END "`, **with a trailing space** before the body.
- A malformed response (no `CON`/`END` prefix) or HTTP 4xx makes the gateway
  terminate the session gracefully. The adapter must therefore always answer
  200 with a valid `CON`/`END` body, even on internal errors.
- **Menus must not contain special characters**: telcos cannot render them.
  The USSD renderer enforces a safe character set.
- Optional response header `at-ussd-hop-metadata` (≤ 99 chars, no `|`) labels
  the current step for journey tracking; it is echoed back on the next request
  and shown in the dashboard. We expose it, default off (no PII in it).

### 2.2 USSD timing and screen limits (Kenya, official help centre)

| Telco | Total session | Customer response timeout | App response timeout |
|---|---|---|---|
| Safaricom | 180 s | 30 s | not published |
| Airtel | 180 s | 60 s | 15 s (connection-to-app 10 s) |
| Equitel | 180 s | 30 s | not published |

- **The official USSD overview states: "the expected response time from your
  application is at most 10 seconds."** That is the binding constraint for the
  model deadline. Our default 4 s sits inside it; we warn at config time above
  8 s and hard-refuse above 10 s.
- Screen limits per menu: **Safaricom KE 160 characters, Airtel KE 184**;
  Nigeria is documented at 160. Third-party sources commonly quote "182"; we
  take **160 as the conservative default**, configurable per deployment.
- **Telco auto-pagination**: when a menu is too long, Safaricom and Airtel
  break it up themselves and add **`98:More` and `00:Back`** reserved codes.
  Consequence for the budgeter: keep screens under the limit so auto-pagination
  never triggers, and treat 98/00 as reserved when numbering our own options.
- User input limits (what the customer may type): Safaricom KE 80 chars,
  Airtel KE 90 chars.

### 2.3 USSD session-end notifications

A second callback URL (per service code) receives, at session end, a
form-urlencoded POST with: `sessionId`, `phoneNumber`, `networkCode`,
`serviceCode`, `date`, `status` (`Incomplete` | `Success` | `Failed`),
`cost`, `durationInMillis`, `hopsCount`, `hopsMetadata` (pipe-delimited),
`input` (full `*`-joined input), `lastAppResponse`, and `errorMessage` on
failure. v0.1 exposes a handler for it but uses it only for logging/cleanup.

### 2.4 SMS API

- **Auth**: `apiKey` request header. `Accept: application/json` optional.
  Classic API requests are `application/x-www-form-urlencoded`.
- **Two send endpoints exist.**
  1. Legacy (what the official SDK uses, and what the sandbox supports):
     `POST https://api.africastalking.com/version1/messaging`,
     form-urlencoded, fields `username`, `to` (comma-joined string),
     `message`, optional `from` (sender ID), `bulkSMSMode` (1 = bulk
     billing mode), `enqueue`. **Success is HTTP 201** with
     `SMSMessageData.Recipients[]` (`statusCode`, `number`, `cost`,
     `status`, `messageId`).
  2. New bulk: `POST /version1/messaging/bulk`, JSON, fields `username`,
     `phoneNumbers[]`, `message`, `senderId`, `enqueue` (default 1).
     Sandbox: "coming soon" as of the docs. → **v0.1 uses the legacy
     endpoint**, with a transport seam to switch later.
- A recipient `status` of `Success` in the send response means *sent*, **not
  delivered**; delivery confirmation only arrives via delivery reports.
- **Delivery report callback** (form-urlencoded POST): `id` (matches
  `messageId`), `phoneNumber`, `networkCode`, `status` (`Sent`/`Submitted`/
  `Buffered` are intermediate; `Success`/`Failed`/`Rejected` are final;
  `AbsentSubscriber`/`Expired` also occur), optional `failureReason`.
- **Incoming message callback** (form-urlencoded POST): `date`, `from`, `id`,
  optional `linkId`, `text`, `to`, `cost`, `networkCode`.
- Nigeria DND: promotional sender IDs outside the allowed window return
  HTTP 409 / `statusCode 409` (`DoNotDisturbRejection`).
- Sandbox base domain: `api.sandbox.africastalking.com`; sandbox
  `networkCode` is `99999`.

### 2.5 What differed from the brief

1. The brief said "a model that thinks for 15 seconds loses the user". The
   official bound is stricter: **10 s app response expectation** (Airtel's own
   app-response timeout is 15 s). Design bound adopted: 10 s.
2. Screen size: the brief said "~182 characters". Official Kenya figures are
   **160 (Safaricom) and 184 (Airtel)**, Nigeria 160. Default: 160.
3. The brief's USSD field list omitted **`networkCode`**; it is in the payload.
4. The brief didn't mention: telco auto-pagination with reserved `98`/`00`
   codes; the "no special characters" rule; session-end notifications; the
   `at-ussd-hop-metadata` header; the `CON `/`END ` trailing space; user input
   length limits; the legacy-vs-new SMS endpoint split and the HTTP 201 quirk.
5. Not yet verified (needs a real account or hardware, per the checklist):
   real production truncation behaviour on other operators, whether USSD and
   SMS to the same number coexist on every operator (deferral depends on it),
   live session timings outside Kenya, and callback authenticity guarantees:
   **no request signing is documented** for callbacks; treat callbacks as
   unauthenticated input and document path-secret/IP-allowlist mitigations.

---

## 3. Package layout

pnpm workspace, Node ≥ 20, TypeScript strict, ESM, vitest, MIT.

```
kalangu/
  package.json            private root, scripts: test, demo, build
  pnpm-workspace.yaml
  tsconfig.base.json
  docs/design.md
  LICENSE                 MIT
  packages/
    core/                 @kalangu/core   (depends on nothing)
    ussd/                 @kalangu/ussd   (→ core)
    sms/                  @kalangu/sms    (→ core)
    sim/                  @kalangu/sim    (→ core)
  examples/
    clinic/               example agent, wired to `pnpm demo`
```

Dependency rules:

- `@kalangu/core` has **zero runtime dependencies** and never imports a model
  SDK, a gateway SDK, or an adapter.
- Adapters and the simulator depend only on core.
- The example depends on everything above.

---

## 4. Core concepts and types

### 4.1 Turns

The agent never writes text to a phone. Steps return a typed turn; a
per-channel renderer converts it into channel output.

```ts
export type Turn =
  | { kind: "say";     text: string }
  | { kind: "choose";  question?: string; options: readonly Option[] }
  | { kind: "ask";     question: string; input: "text" | "number" }
  | { kind: "confirm"; question: string; yes?: string; no?: string }
  // Reserved for 0.2. Parsed and type-checked now, rendered later:
  | { kind: "pay";     amount: number; currency: string; reason?: string };

export interface Option { label: string; value?: string }
```

The union is deliberately closed-but-extensible: adding `pay` later is a
single variant plus renderer cases, guarded by exhaustive `switch`.

### 4.2 Steps and handlers

Steps are declared with builder functions and form a tree:

```ts
menu(title, { [label]: stepOrHandler })   // nested fixed menu
ask(question, handler)                     // free text/number → handler
say(text)                                  // terminal screen/message
choose(question, { [label]: stepOrHandler })
confirm(question, { onYes, onNo })
```

A handler is `(input: string, ctx: TurnContext) => Promise<Turn | void>`.
`void` means "stay here / continue default flow". `TurnContext` carries:

```ts
interface TurnContext {
  input: string;                 // this turn's new input (last * segment on USSD)
  session: SessionData;          // get/set arbitrary JSON-safe state
  locale: Locale;                // writable; changing it persists
  t: Translate;                  // locale lookup for fixed strings
  model: ModelPort;              // the developer's injected model handle
  logger: Logger;                // phone numbers masked by default
  channel: ChannelId;            // "ussd" | "sms" | "sim"
}
```

`ModelPort` is the developer's own async function(s); core only awaits it.

### 4.3 Engine and channels

```ts
export interface Channel {
  id: ChannelId;
  render(turn: Turn, ctx: RenderContext): RenderedTurn;   // pure
  send?(out: RenderedOutbound): Promise<void>;            // outbound transport
}

export interface RenderedOutbound {
  to: string;          // phone number
  text: string;        // already budgeted
  meta?: Record<string, string>;
}
```

`createAgent()` wires: channels, locales, start step, model port, session
store, background worker, clock. It exposes:

```ts
agent.requestHandler(req: Request): Promise<Response>
```

which dispatches by URL pathname to the adapter registered with that `path`.
Each adapter also exposes its own `.handler` for frameworks that prefer
explicit mounting. Handlers are built on **standard `Request`/`Response`**, so
the same code runs on Hono, Bun, Deno, and behind small wrappers on Next.js
and Express. Parsing the form body uses `await req.formData()`, which the
Fetch spec defines for `application/x-www-form-urlencoded`.

### 4.4 Background work (pluggable)

```ts
export interface BackgroundWork {
  run(task: () => Promise<void>): void;
}
```

Default: in-process fire-and-forget with a logged `catch` and a process-level
`unhandledRejection` guard. Serverless users supply e.g. a `waitUntil`-based
implementation (Cloudflare Workers) or a queue hand-off; the README documents
what breaks without one (deferred answers never get sent).

### 4.5 Sessions

```ts
interface SessionStore {
  load(key: string): Promise<SessionRecord | null>;
  save(record: SessionRecord, options?: { ifVersion?: number }): Promise<void>;
  clear(key: string): Promise<void>;
  readonly atomic?: boolean;   // save honours ifVersion atomically (0.2, payments)
}
```

`save` bumps `record.version`. With `ifVersion` it is a compare-and-set: it
throws `SessionConflictError` if the stored version has moved on (a missing
record counts as 0). Without it the last write wins, as before. A store that
sets `atomic: true` promises the compare-and-set holds across every process
sharing it (a conditional `UPDATE … WHERE version = $n`, or Redis
`WATCH`/`MULTI`). Agents that take payments require it; see payments design
§6.1.

The engine saves with `ifVersion` wherever a save could otherwise undo
another one: a payment's "Yes", the answer to a language suggestion, a
payment outcome, and a **deferred answer**. A deferred answer applies only
what its handler changed after the deadline (the data keys it set or
removed, and the language) to the session as it is now, so changes saved in
the meantime, by a payment outcome for example, are kept; and if the user
has moved on to a new question, they keep their place while the answer is
still sent. Since 19 Nov 2026 a turn's own final save is versioned too: if a
payment outcome or a deferred answer saved the session while the turn ran,
the turn's changes are merged into it rather than written over it. In the
merge a field only one side changed keeps that side's value, data keys the
writer changed are kept, and where both changed something the user's turn
wins over a background delivery; the screen position is decided as a whole,
and a background delivery takes it only if the user is not waiting on a
newer question.

- **Keyed by phone number**, not gateway `sessionId`, so a dropped session
  resumes on redial. The gateway `sessionId` is stored for correlation only.
- `SessionRecord`: `{ phone, locale, stepId, data, pendingAsk?, page?,
  deferred?: DeferredRef, updatedAt, gatewaySessionId? }`.
- In-memory `Map` implementation ships in core; a durable one is a drop-in.
- Policy notes:
  - USSD resumption: on a fresh dial (empty `text`) with an existing record,
    re-render the current step; a pending deferral re-replies with the
    deferred notice (`END`) rather than blocking.
  - Inbound SMS while a USSD session is live continues the same conversation
    if a question is pending; otherwise it starts the menu flow over SMS
    (numbered list, reply with a number).
  - New USSD session for a number with a live record supersedes it
    (last-write-wins). Documented limitation.

### 4.6 Deferral

- Steps whose handler calls `ctx.model` run under a **deadline**: default
  **4000 ms**, configurable per agent. Hard ceiling 10 s (gateway
  expectation); config above 8 s logs a warning, above 10 s is refused.
- In time → the returned turn is rendered to the current channel.
- Too late → respond **`END`** with the localized deferred notice
  ("We are working on your question. You will receive an SMS shortly."),
  keep the model promise running via `BackgroundWork.run`, and when it
  settles, render the result as a `say` turn for the **SMS** channel, budget
  it, and send through the SMS channel's `send()`.
- Fixed-menu steps never call the model and always take the fast path
  (no deadline, millisecond answers).
- Deadline timing uses an injectable clock (`Timer` interface with
  `setTimeout`-compatible methods); tests use a fake clock.

### 4.7 Locales

- Fixed strings live in JSON locale files shipped in core: `en`, `fr`.
  Keys include: `common.more`, `common.back`, `common.yes`, `common.no`,
  `common.deferredNotice`, `common.invalidChoice`, `common.typeAnswer`.
- The user's locale is chosen from a menu option or inferred later (0.3);
  it persists in the session record.
- Confirm on SMS matches localized yes/no words, case-insensitively.

### 4.8 Logging and privacy

Phone numbers are personal data. The default logger masks to the last 4
digits (`+254••••••1001`). Raw numbers never appear in logs, errors, or the
optional hop-metadata header. Disabling masking is an explicit opt-in flag.

---

## 5. The budgeter

Every outgoing screen or message passes through the budgeter. It never emits
something a channel would truncate or render wrongly.

### 5.1 Channel profiles

```ts
interface ChannelProfile {
  id: ChannelId;
  // USSD: per-operator screen limit, reserved nav numbers, safe charset
  // SMS: encoding-aware segment math
}

interface ScreenBudget {
  maxChars: number;               // USSD default: 160
  nav: { more: string; back: string | null };  // defaults "98", null (no Back in v0.1)
  reservedNumbers: readonly string[];          // ["98", "00"]
}
```

### 5.2 USSD rules

- Count characters after joining pages; never exceed `maxChars`.
- Long `say`/`choose` content paginates: page N ends with
  `\n98. More` (localized label, configurable number); the user's `98`
  advances; pagination state (`page`) lives in the session.
- Option numbering skips reserved `98` and `00`.
- The renderer restricts output to a **safe charset** (printable ASCII plus
  `\n`; accented characters are transliterated or stripped with a warning).
  This follows the official "no special characters" rule.

### 5.3 SMS rules (encoding-aware)

- Classify every character: GSM-7 basic alphabet, GSM-7 extension table
  (counts as **two** chars: `^ { } \ [ ] ~ | €`), or outside GSM-7 entirely.
- If any char is outside GSM-7 → the whole message is UCS-2:
  **70 chars per segment** (67 when concatenated).
- GSM-7: **160 per segment** (153 when concatenated).
- `smsLength(text)` returns `{ encoding, segments, charsPerSegment }`.
- Policy: never silently truncate. Default behaviour is **split** into
  separate messages, capped at 4 segments total (configurable); exceeding the
  cap is an error surfaced to the developer, not silent loss.

### 5.4 Why this belongs in core

The simulator, the SMS adapter, and future channels all share the segment
math, and the demo's French content must not blow past 70 chars unnoticed.

---

## 6. Renderers

### 6.1 USSD

| Turn | Output |
|---|---|
| `say` | final screen (`END`), paginated with `98. More` if over budget |
| `choose` | numbered menu (`CON`), `1. …\n2. …`, overflow pages via More |
| `ask` | `CON` question screen; next request's last segment is the answer |
| `confirm` | `CON` "1. Yes\n2. No" (localized labels) |
| `pay` | reserved; throws `NotSupportedError` in v0.1 |

### 6.2 SMS

| Turn | Output |
|---|---|
| `say` | one or more budgeted messages |
| `choose` | numbered list; user replies with a number |
| `ask` | the question; the reply is the answer |
| `confirm` | question + "Reply YES or NO" (localized) |
| `pay` | reserved |

---

## 7. Adapters

### 7.1 `@kalangu/ussd`: Africa's Talking

```ts
africasTalkingUssd({
  code: "*384*1#",
  path: "/ussd",            // for agent.requestHandler dispatch
  maxScreenChars: 160,      // per-operator override
  sandbox: false,           // switches base domain
  hopMetadata: false,       // optional journey header
})
```

- Handler: parse form fields (`sessionId`, `phoneNumber`, `networkCode`,
  `serviceCode`, `text`) → `InboundEvent` → engine.
- Input parsing: new input = last `*`-separated segment (empty string on
  first request). Known limitation: a literal `*` typed inside free text
  splits the segment; documented, numeric input unaffected.
- Always answers `200 text/plain` with `CON `/`END ` prefix. Internal
  errors produce a localized `END apology` screen, never a malformed body.
- Exposes an optional second handler for **session-end notifications**
  (`path` configurable, default `/ussd/end`) used for logging/cleanup.
- Adapter tests run against recorded request fixtures (form-encoded bodies
  captured from the docs' examples and the official SDK's middleware shape).

### 7.2 `@kalangu/sms`: Africa's Talking

```ts
africasTalkingSms({
  senderId: "CLINIC",       // registered sender ID or short code
  path: "/sms",             // inbound messages callback
  deliveryPath: "/sms/delivery",  // delivery reports callback
  sandbox: false,
  bulkSmsMode: 1,           // matches official SDK default
  enqueue: undefined,       // pass through only when set
})
```

- **Send** (legacy endpoint): `POST {api}/version1/messaging`,
  form-urlencoded: `username`, `to` (comma-joined), `message`, `from`
  (senderId), `bulkSMSMode`, `apiKey` header, `Accept: application/json`.
  Accepts HTTP **201** as success; surfaces `statusCode` errors verbatim
  (including Nigeria's `409` DND case) and sandbox flag switches to
  `api.sandbox.africastalking.com`.
- **Inbound** handler maps `from` → phone, `text` → message, into the engine.
- **Delivery report** handler is exposed and logged in v0.1; receipts that
  act on delivery confirmations arrive with payments (0.2).
- A transport seam (`SmsTransport` interface) isolates the HTTP call so the
  new JSON bulk endpoint can replace the legacy one without touching core.

---

## 8. Simulator (`@kalangu/sim`)

Terminal keypad phone. No account, no gateway, no network:

```
$ pnpm demo
│ Simulated phone: +254 700 000 001 (Safaricom KE)
Dial> *384*1#
┌────────────────────────────────────┐
│ Clinic line                        │
│ 1. Opening hours                   │
│ 2. Ask a nurse                     │
│ 3. Language                        │
└────────────────────────────────────┘
Choice> 2
┌────────────────────────────────────┐
│ Type your question:                │
└────────────────────────────────────┘
Input> Is the clinic open on Sunday?
┌────────────────────────────────────┐
│ END We are working on your         │
│ question. You will get an SMS      │
│ shortly.                           │
└────────────────────────────────────┘
… (≈6 s later)
✉ SMS from CLINIC: The clinic is closed on Sundays…
```

- Calls the engine directly (no HTTP); uses the USSD renderer for screens and
  the SMS renderer/sender for the deferred answer.
- Commands: dial a code, `x` = hang up mid-session (demonstrates resume on
  redial), `q` = quit.
- The example's model is a **fake that sleeps 6 s** against the 4 s deadline,
  so the demo shows deferral deterministically with no API key.

---

## 9. Example agent (`examples/clinic`)

```ts
import { createAgent, menu, say, ask, choose } from "@kalangu/core";
import { africasTalkingUssd } from "@kalangu/ussd";
import { africasTalkingSms } from "@kalangu/sms";

export const clinic = createAgent({
  locales: ["fr", "en"],
  defaultLocale: "en",
  model: fakeNurseModel,          // (input, ctx) => Promise<string>, sleeps 6 s
  sessionStore: memoryStore(),    // default; shown for clarity
  channels: [
    africasTalkingUssd({ code: "*384*1#", path: "/ussd" }),
    africasTalkingSms({ senderId: "CLINIC", path: "/sms" }),
  ],
  start: menu("Clinic line", {
    "Opening hours": say("Open Monday to Saturday, 8:00 to 18:00."),
    "Ask a nurse": ask("Type your question", (q, ctx) => ctx.model.answer(q)),
    "Language": choose("Language", {
      "English": (ctx) => { ctx.session.locale = "en"; },
      "Français": (ctx) => { ctx.session.locale = "fr"; },
    }),
  }),
});

export default clinic.requestHandler;   // standard Request → Response
```

A French option is in the menu on purpose: it shows locale switching and
exercises the budgeter's UCS-2 path. Only some French letters are in the
GSM-7 basic set (é, è, à, ù, É, Ç); others (ç, â, ê, î, ô, û, ë, ï, œ) are
not, so many French answers are sent as UCS-2 at 70 characters per SMS.
(An earlier draft said most French accents were GSM-7; that was wrong.)

---

## 10. Testing plan (priority order)

1. **Budgeter**: GSM-7 vs UCS-2 classification (French é/à ok; œ, Wolof
   ɲ/ŋ, Hausa ɓ/ɗ, Arabic/Devanagari force UCS-2), extension-table double
   counting, segment math (160/153, 70/67), never exceeding a limit, USSD
   pagination with reserved numbers, unsafe-character policy.
2. **Engine deadline behaviour**: fake clock; fast path never calls the
   model; deadline hit → deferred notice `END`, background completion sends
   exactly one SMS; late model error → logged, user already notified.
3. **Adapters against recorded fixtures**: USSD inbound (first request,
   `1*1` cumulative input, resumption), always-valid responses (error path
   still `END …`), SMS inbound and delivery-report parsing, HTTP 201 send
   success, DND 409 mapping.
4. **Sessions**: resume after drop keyed by phone; locale persistence;
   last-write-wins policy.
5. **Renderer/consumer contract**: every turn kind renders on every channel;
   exhaustive switch guards future `pay`.

---

## 11. Out of scope for v0.1

Payments (0.2), language detection/model routing (0.3), WhatsApp (0.4),
voice, durable session stores, callback signature verification (none exists
to implement), npm publishing, and remote repositories.

---

## 12. Open questions

1. **Navigation numbers.** Telcos reserve `98` (More) / `00` (Back) for their
   own auto-pagination. Proposed default: our More item is `98`, configurable,
   and we keep screens ≤ 160 so auto-pagination should never trigger. Do any
   operators you care about use a different convention?
2. **Unsafe-character policy on USSD.** Proposed: strip + warn by default;
   optional strict mode that throws in development. Silently altering user
   text is the trade-off; is stripping acceptable?
3. **Legacy vs new SMS endpoint.** Proposed: legacy `/version1/messaging`
   (form-urlencoded, sandbox-supported, HTTP 201) with a transport seam.
   Switch when the new JSON endpoint's sandbox ships.
4. **SMS split cap.** Proposed: max 4 segments/messages per outbound turn;
   exceed → developer-visible error, never silent truncation.
5. **Callback authenticity.** No signing is documented. Proposed: document
   path-secret and IP-allowlisting mitigations; no crypto verification.
6. **Deferral re-notice.** If the user dials again while a deferral is still
   pending, they get the deferred notice again. Acceptable, or should the
   second dial block-freeze on a "please wait" `CON` (risky against the
   10 s bound)? Proposed: re-notice.
7. **`enqueue` default on send.** Proposed: omit unless configured (legacy
   endpoint default), matching the official SDK.

### Decisions (17 Nov 2026)

Settled for v0.1. Each matches what is already built and tested, so nothing
here changes code. Items marked *unverified* depend on how real operators
behave and are covered by the verify-first list in `TODO.md`.

1. **Navigation numbers: our own `98` (More), configurable**, with
   `00` also reserved so no option is ever numbered `98` or `00`. Screens
   stay within the limit, so operator auto-pagination should not trigger.
   *Unverified:* whether any operator intercepts `98` before it reaches us.
   The number is configurable (`budget.more`) for exactly that case.
2. **Unsafe characters: strip and warn by default, strict mode opt-in.**
   Accents are transliterated first (`é` → `e`), so ordinary French text
   survives; only what has no mapping (an emoji) is removed, with a logged
   warning. `unsafeChars: "throw"` raises a `BudgetError` instead, for
   development.
3. **Legacy `/version1/messaging` endpoint behind a transport seam.** It is
   form-encoded, works in the sandbox and returns 201. The JSON bulk
   endpoint replaces it by passing a different `transport`, with no change to
   the adapter. Switch once that endpoint's sandbox ships.
4. **SMS split cap of 4 segments, never silent truncation.** Over the cap
   throws a `BudgetError` the developer sees; `maxSegments` raises or lowers
   it.
5. **Callback authenticity: document mitigations, no crypto.** The gateway
   signs nothing, so there is nothing to verify. The README tells developers
   to use hard-to-guess callback paths and to allow only the gateway's IP
   addresses where they can.
6. **Deferral re-notice, not a block screen.** A redial while an answer is
   pending repeats the "SMS shortly" notice. A "please wait" `CON` screen
   would risk the 10-second bound. Listed under Known limits in the README.
7. **`enqueue` omitted unless configured**, matching the official SDK and
   the legacy endpoint's default. `bulkSmsMode` defaults to 1, also as the
   SDK does.

---

## 13. Build order (each piece independently testable)

turn types → budgeter → engine + in-memory sessions → USSD adapter →
terminal simulator → SMS adapter → deferral → clinic example → README.

`pnpm demo` target: `examples/clinic` runs the simulator against the
clinic agent. Nothing needs a gateway account or an API key.

---

## 14. Where v0.1 differs from this document

Decided while building; each is open to review like the rest.

1. **Every handler on a live channel runs under the deadline**, not only
   handlers that call `ctx.model`. Any slow handler (a database, an API)
   threatens the 10 s bound the same way. Menus with no handler still never
   wait.
2. **A late failure sends one apology SMS** (`common.error`) besides being
   logged. The user was told to expect an SMS; silence would leave them
   waiting.
3. **No process-level `unhandledRejection` handler.** A library changing
   process-wide behaviour surprises its host; every background task has its
   own logged `catch` instead.
4. **Resume window.** A dropped session resumes on redial within 5 minutes
   (`resumeWindowMs`); after that the user starts at the top, keeping their
   data and locale. A pending deferral is forgotten after 15 minutes.
5. **Dial strings are replayed.** A new gateway session id counts as a
   fresh dial, and `*384*1*2#` (whose first request already has `text=1*2`)
   is replayed from the start menu.
6. **Handler signature** is `(input, ctx)` everywhere, including menu
   entries; the §9 sketch's `(ctx) => …` entries become `(_input, ctx) => …`.
   Locale changes go through `ctx.locale`, not `ctx.session.locale`.
   A handler that returns nothing goes back to the menu above.
7. **Localized step text.** Titles, labels and messages accept
   `{ en: "...", fr: "..." }` as well as plain strings.
8. **An SMS turn is one message** that the network concatenates, capped at
   4 segments, rather than separate messages: concatenated parts arrive in
   order.
9. **Locale strings are TypeScript modules**, not JSON files, so they ship
   with the compiled package without a copy step.
10. **The simulator** dials, prints boxed screens, and also has
    `sms <text>` to text the agent; `SimPhone` is exported for tests.
