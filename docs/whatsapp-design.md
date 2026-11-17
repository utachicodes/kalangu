# Kalangu — 0.4 WhatsApp adapter design

Status: **draft for review. No WhatsApp code exists.**
Date: 2026-11-17. Scope: a `@kalangu/whatsapp` channel for the WhatsApp
Cloud API (Meta's own hosted API), so the same agent that answers on USSD and
SMS answers on WhatsApp. Business solution providers' wrappers, templates,
marketing, calling and Flows are out of scope (§11). Payments over WhatsApp
are out of scope for 0.4 (§9).

---

## 1. What this is

> A user messages the clinic's WhatsApp number. The agent answers with the
> same menus, as tappable buttons or a list instead of numbers to type. A
> slow model answer needs no "we'll text you" screen: there is no live
> session to keep alive, so the reply simply arrives when it is ready.

WhatsApp is the easiest channel for the engine in one way and the hardest in
three:

- **Easier:** no 10-second deadline, no 160-character screen, no character
  restrictions (accents and emoji are fine), and a real interactive UI.
- **Harder:** the user's identity may not be a phone number (§3), replies
  outside a 24-hour window need a pre-approved template and every reply costs
  money (§4), and old buttons stay tappable forever (§6).

---

## 2. Meta facts (read 17 Nov 2026)

Sources, all on `developers.facebook.com`: the WhatsApp Cloud API *Get
started*, *Business-scoped user IDs*, *Service messages*, *Text messages*,
*Interactive list messages*, *Interactive reply buttons messages* and
*Upcoming pricing updates for Meta Business Agent, service and utility
messages* pages, plus *Webhooks from Meta: Getting started* from the Graph
API docs. Several of these pages carry no date. **Treat every number as
"as read on 17 Nov 2026" and check Meta's changelog before building;**
§12 lists what only a real test number can confirm.

### 2.1 Sending

- `POST https://graph.facebook.com/v23.0/<PHONE_NUMBER_ID>/messages` with
  `Authorization: Bearer <system user token>` and a JSON body:
  `messaging_product: "whatsapp"`, `recipient_type: "individual"`, `to`,
  `type`, and the type's object. `v23.0` is what the page showed; the
  version must be configurable.
- A long-lived token comes from a **system user** with the
  `whatsapp_business_messaging` and `whatsapp_business_management`
  permissions (and `business_management`). The temporary token from the
  dashboard expires quickly.
- The API response only confirms the request was **accepted**, not that the
  message was delivered. Delivery arrives later as a status webhook
  (`sent`, `delivered`, `read`, or `failed`).
- **Ordering is not guaranteed**: delivery order may differ from request
  order. Meta's advice is to wait for `delivered` before sending the next
  message when order matters.
- Text body: **4096 characters** maximum. The page does not say what
  happens beyond that.
- `preview_url: true` asks the client to render a link preview for the first
  URL. URLs are hyperlinked either way.

### 2.2 Interactive messages

| | Reply buttons | List |
|---|---|---|
| Choices | up to **3** | up to **10** rows, in 1–10 sections |
| Choice label | 20 chars (`reply.title`, unique) | row title 24 chars, optional description 72 |
| Choice id | 256 chars | 200 chars |
| Body | 1024 chars | 4096 chars (see note) |
| Other | optional header (text, image, video, document), footer 60 | button label 20, header 60 (text only), footer 60, section title 24 |

Note: the list page says 4096 for the body; a search summary of Meta's
messages reference said 1024. The fetched list page is what the table shows;
this stays on the verify list (§12) and the renderer assumes the stricter
**1024** until then.

The user's tap arrives as a `messages` webhook whose message has
`interactive.type` of `button_reply` (`id`, `title`) or `list_reply` (`id`,
`title`, `description`). Neither page says whether these can be sent outside
the 24-hour window; the design only sends them as replies (§4).

### 2.3 The 24-hour window and cost

- A **customer service window** opens when the user messages the business
  and resets with each user message. Non-template messages can only be sent
  while it is open. After that only a pre-approved **template** goes out.
- Meta's pricing page says service messages inside the window "have not been
  charged since November 1, 2024" and that **from 1 October 2026 Meta
  charges per message for all service messages**, at the same per-market
  rate as utility messages, with no volume tiers. It also says businesses
  without a payment method on file by 30 September 2026 have service message
  delivery stopped from 1 October.
- The only per-country rate on that page is Brazil (0.68 US cents per
  utility or authentication message, 1 July 2026). **Rates for Kenya,
  Senegal, Nigeria and other target markets were not on the pages I read.**
  Every reply the agent sends is, in principle, billable (§12, item 4).

### 2.4 Identity: business-scoped user IDs (BSUIDs)

- WhatsApp is rolling out **usernames** gradually from 2026. A user with a
  username may hide their phone number. Per Meta's page, BSUIDs began
  appearing in webhooks in April 2026, and sending to a BSUID is supported from
  July 2026.
- A BSUID looks like `US.13491208655302741918`: a two-letter country code, a
  dot, up to 128 alphanumeric characters. It is specific to one business
  portfolio and **regenerates when the user changes their phone number**.
  A parent BSUID (`US.ENT.…`) exists too, when enabled.
- For a user **with** a username, the phone number is left out of webhooks
  unless one of these holds: the business messaged or called that number in
  the last 30 days, received a message or call from it in the last 30 days,
  or the user is in the business's contact book. The conditions are
  evaluated per business phone number.
- In an incoming message webhook: `wa_id` is always present for a user
  **without** a username and only present with a username when a phone is
  available. `user_id` / `from_user_id` (the BSUID) are always present.
  `username` appears when set.
- Sending: set `to` (phone) **or** `recipient` (BSUID); if both are set,
  `to` wins. BSUIDs cannot be used for some authentication templates.
- Two system messages announce a change: `user_changed_number` (new phone
  shareable; carries the new and previous BSUID) and `user_changed_user_id`
  (no phone shareable; carries both BSUIDs, usually no `wa_id`).
- A business can ask the user for their number with a `REQUEST_CONTACT_INFO`
  button; tapping it delivers a contacts webhook with the number. A user can
  also share a contact card.
- Meta says supporting BSUIDs "is required for all partners and
  directly-integrated businesses" but gave no deadline on the pages read.

### 2.5 Webhooks

- **Setup:** Meta sends `GET` with `hub.mode=subscribe`, `hub.challenge` and
  `hub.verify_token`; the endpoint checks the token and answers with the
  challenge. The endpoint must serve valid HTTPS (no self-signed
  certificates) before fields can be subscribed.
- **Signing:** every event `POST` carries `X-Hub-Signature-256:
  sha256=<hex>`, an HMAC-SHA256 of the payload keyed with the **app
  secret**. Meta calls validation "recommended but not required". The Graph
  page does not say whether the HMAC covers the raw bytes; a community
  thread reports WhatsApp-specific mismatches with code that works for
  Facebook and Instagram, with no confirmed cause (§12, item 1). During a
  secret reset, signatures from the old and new secrets are both accepted
  for a period.
- **Delivery:** answer `200`. On failure Meta retries immediately and then
  with decreasing frequency for **36 hours**, then drops the update.
  **Duplicates are possible**; Meta tells you to deduplicate. A request can
  batch up to **1000** updates, and nothing is said about ordering. History
  cannot be queried afterwards.
- Payload shape: `object: "whatsapp_business_account"`, an `entry` array,
  and `metadata.phone_number_id` (which of your numbers received it).
  Incoming messages and outgoing status updates both arrive as `messages`
  webhooks.

---

## 3. The identity problem

Every layer of Kalangu keys on a phone number: sessions are keyed by it,
deferral and payment outcomes are texted to it, the payment policy limits
count per phone, and pawaPay needs it as the payer's MSISDN. Africa's
Talking always supplies one. WhatsApp may not (§2.4).

**Proposal:**

- The adapter builds the engine's user key as: the phone in E.164 form with
  a leading `+` when `wa_id` is present (the same key USSD and SMS use, so a
  person who appears on both channels is one person); otherwise the BSUID
  as given. A key that does not start with `+` is, by definition, "no phone
  known".
- **Logging masks BSUIDs like phone numbers.** They identify a person.
- **No cross-linking in the first slice.** A user who has both a username and
  a phone-less BSUID is a separate session from their USSD self. An alias
  store (BSUID to phone, filled whenever a webhook carries both, and updated
  on `user_changed_number`) can come later; it needs a durable store and
  decisions about merging sessions (§14, decision 1).
- **`user_changed_number` and `user_changed_user_id`** must be handled, or a
  user's session and history silently orphan when they change phone. First
  slice: log it, move the stored session to the new key when both keys are
  known, otherwise start fresh.
- **Anything that needs a phone refuses cleanly without one.** SMS fallback
  (§8) is skipped, and a `pay` step refuses cleanly (§9).

Engine change: none beyond treating the key as an opaque string. `phone` in
`InboundEvent` keeps its name for compatibility and is documented as "the
user key".

---

## 4. The window and what a reply costs

- The adapter only ever sends **replies inside an open window**: a turn's
  output is sent in response to a user message, so the window is open by
  construction.
- **Cost model for developers.** Each outbound message is billable from
  1 October 2026 (§2.3), so the adapter sends **exactly one message per
  turn**, as SMS already does. It never sends "typing…" text, never splits a
  long answer when it fits in 4096 characters, and never sends a separate
  receipt unless the agent says to. The README must say replies cost money
  and link Meta's rate card, not promise a number.
- **Late messages** (a deferred answer, a payment outcome hours later) may
  arrive after the window closed. See §8.

---

## 5. Rendering turns

A new channel kind, `whatsapp`, with a renderer beside `renderUssd` and
`renderSms`. No transliteration and no character budget beyond the limits
below: `toUssdSafe` does not apply.

| Turn | WhatsApp output |
|---|---|
| `say` | text body, 4096 max; the conversation continues at the start step on the next message (like SMS) |
| `ask` | text body (the question); the user types the answer |
| `confirm` | **reply buttons**, two: yes and no (labels ≤ 20) |
| `choose` | ≤ 3 options with every label ≤ 20: **reply buttons**. ≤ 10 options with every label ≤ 24: **list**. Otherwise a **numbered text list**, answered by typing the number, as on SMS |
| `pay` | not rendered in 0.4 (§9) |

Rules:

- **Never truncate a label.** If a label is too long for a button or row,
  the whole turn falls back to the next form, ending at numbered text. A
  silently shortened "Pay consultation fee" is how a user taps the wrong
  thing.
- A `choose` question becomes the body. If there is none, the body is a
  localized "Choose an option" (the API requires a body; verify, §12).
- A body over **1024** characters on a buttons or list message falls back to
  numbered text (which allows 4096). A `say` over 4096 is a developer-visible
  `BudgetError`, never a silent cut, matching the SMS policy (§5.3 of
  `design.md`). It is not split, because Meta does not guarantee delivery
  order.
- A user can always **type** instead of tapping: `2`, or the label's text.
  The existing `interpret` already reads both.
- **Messages the adapter cannot answer** (voice notes, images, locations,
  stickers, contacts without a prompt) get one localized "please send text"
  reply and do not reach the agent.

---

## 6. Stale taps

On USSD the user can only answer what is on screen. On WhatsApp a button
from an hour-old message is still tappable, so a tap can arrive for a turn
that is no longer current. Mapped naively to "option 1 of the current turn",
an old **Yes** could confirm a different question, and for a `pay` step that
means money.

**Proposal:** a per-session `turnSeq`, bumped each time a turn is displayed.
Button and row ids carry it: `<seq>.<n>` (for example `14.2`). The adapter
passes it on the `InboundEvent`; the engine compares it to the stored
`turnSeq`.

- Equal: the tap is `n`, as if typed.
- Different: the engine answers with a localized "That choice has expired"
  and shows the current turn again. Nothing runs.

This is a small engine change (a counter on `SessionRecord`, one optional
field on `InboundEvent`, one message key) and it also protects any future
adapter with tappable history. Typed answers are unaffected: a user typing
"1" means whatever is on screen now, as on SMS.

---

## 7. Webhook handling

`@kalangu/whatsapp` exposes a route like the other adapters
(`agent.requestHandler` dispatches by path). All of this uses only Web
Crypto and `fetch`, so core keeps zero runtime dependencies.

- **`GET` (verification):** compare `hub.verify_token` and answer
  `hub.challenge` as text/plain; otherwise `403`.
- **`POST` signature:** `appSecret` is **required by default**. The adapter
  computes the HMAC-SHA256 over the **raw request bytes** (read before any
  JSON parsing) and verifies it against the header after `sha256=` with
  Web Crypto's HMAC `verify`, not a hand-written string compare. `appSecret` accepts
  an array so a secret rotation does not drop traffic. A missing or wrong
  signature gets `401` and is logged with no payload. Opting out needs an
  explicit `unsafeSkipSignatureCheck: true` that logs a warning at startup;
  Meta's "recommended" is not good enough for an endpoint that can start a
  payment. Unlike Africa's Talking, WhatsApp has a signature, so unlike
  `design.md` §12 question 5 there is something to verify.
- **Acknowledge fast, process after.** Verify and parse, answer `200`, and do
  the work through `agent.background`, because a slow model call must not
  trigger Meta's retries. Meta's acknowledgement timeout is not stated on the
  pages read (§12, item 2). The cost is that a crash after the `200` loses
  that message; the user's next message recovers, and the failure is logged.
  Acknowledging only after a durable enqueue is possible for deployments with
  a queue (the `background` seam already allows it).
- **Deduplicate** on the inbound message `id` with a `DedupeStore`
  (`seen(id): Promise<boolean>` with a TTL of at least 36 hours, since
  that is how long Meta retries). The in-memory default is for development;
  serverless needs a durable one, and the README says so, as it does for
  sessions. A duplicate gets `200` and nothing else.
- **Batches:** process every `entry` and `change`. Updates for **one user are
  handled one at a time** in arrival order, and different users may run in
  parallel. Meta promises no ordering inside or across requests, so the
  adapter sorts one user's messages in a batch by their `timestamp` and
  documents that two messages sent within the same second can swap.
- **Status webhooks** (`sent`, `delivered`, `read`, `failed`) never reach the
  agent. `failed` is logged with Meta's error and exposed to an optional
  `onDeliveryFailed` callback (§8). The others are debug logs.
- **Which number:** `metadata.phone_number_id` must match the configured one;
  anything else is ignored and logged, since one app can serve several
  numbers.
- Always `200` for a verified, well-formed request, even if the engine later
  fails; an internal error becomes the localized apology to the user, as on
  the other channels.

---

## 8. Sending, and replies that miss the window

```ts
whatsapp({
  phoneNumberId: "…",
  accessToken: process.env.WHATSAPP_TOKEN,
  appSecret: process.env.WHATSAPP_APP_SECRET,   // or [current, previous]
  verifyToken: process.env.WHATSAPP_VERIFY_TOKEN,
  path: "/whatsapp",
  graphVersion: "v23.0",                        // configurable
})
```

- A transport seam like the SMS adapter's: the default uses `fetch`; tests and
  alternative hosts replace it.
- **Outbound failures:** HTTP errors are surfaced with Meta's error code and
  message, never retried blindly on a `4xx`; a `5xx` or network failure is
  retried a few times with backoff. A message can still fail later (status
  `failed`), so "accepted" is never logged as "delivered".
- **One message per turn**, so message order is never at risk (§2.1).
- **A deferred answer or payment outcome has no deadline to miss on
  WhatsApp**, but it can arrive after the window closed, for example a
  payment that settles the next day. The engine currently sends those through
  the SMS channel only. **Proposal:** a `deliveryChannel(record)` choice: the
  channel the user last wrote on, if it is WhatsApp and its window is still
  open (the session records the time of the last inbound WhatsApp message);
  otherwise SMS, when a phone number is known; otherwise nothing is sent,
  an error is logged, and the outcome stays in the payment store for the
  developer. Sending a template instead is out of scope for 0.4 (§11).
- `onDeliveryFailed(event)` lets a developer fall back to SMS themselves
  when WhatsApp reports `failed`.

---

## 9. Payments over WhatsApp

**Not in 0.4.** A `pay` step on a WhatsApp conversation refuses with a
localized "payments are not available here" until these are settled:

1. pawaPay needs the payer's phone number (MSISDN), and a BSUID-only user
   has none (§3). The user must supply it through `REQUEST_CONTACT_INFO` or
   a typed number, and the agent must show it back for confirmation.
2. The stale-tap protection (§6) must exist and be tested for the confirm
   buttons, since money depends on it.
3. The PIN prompt is on the user's phone either way, so §3 of
   `payments-design.md` (end the session first) does not apply, but "never
   the PIN" (§8 there) applies unchanged.

Revisit after the payments package has run against a sandbox.

---

## 10. Packages and engine changes

```
packages/whatsapp   @kalangu/whatsapp: the channel, the webhook route,
                    signature check, deduplication, the Graph transport
packages/core       ChannelKind gains "whatsapp"; renderWhatsapp + interpret
                    for it; turnSeq and InboundEvent.turnSeq; the expired-choice
                    message; deliveryChannel
packages/sim        a WhatsApp-style simulator view is optional
```

Core's engine changes, all small and all testable without Meta:

- `ChannelKind` and `TurnContext.channelKind` include `"whatsapp"`.
- A renderer that returns a structured message (text, buttons, or list)
  rather than a string, since a string cannot carry button ids. `Rendered`
  gains an optional `interactive` field; channels that do not support it
  ignore it. The text form is always present as the fallback, so a renderer
  bug degrades to numbered text rather than silence.
- `turnSeq` (§6, settled in §14, decision 9).
- The user key is opaque (§3).

---

## 11. Out of scope for 0.4

Template messages (so no way to start a conversation, and no messages after
the window closes), marketing, WhatsApp Flows, catalogues, calling, groups,
media in either direction beyond the "please send text" reply, read receipts
and typing indicators (nice to have, §14, question 8), embedded signup,
multiple numbers per agent, and other providers' APIs (Twilio, 360dialog and
similar wrap or differ from the Cloud API; a community adapter can use the
same renderer).

---

## 12. Verify first (needs a Meta test number or a real WABA)

1. **Signature on raw bytes.** Does the HMAC match when computed over the
   exact request bytes? A community report says WhatsApp differs from
   Facebook here. Capture real requests, including ones with non-ASCII text
   and emoji, and check; the adapter's tests must use those fixtures.
2. **Acknowledgement timeout and the retry schedule** when we answer slowly.
3. **Whether `wa_id` is present for real users in the target markets** (Kenya,
   Senegal and so on) today, and how often a BSUID arrives alone.
4. **What a service message costs in each target market** since 1 October
   2026, and whether a payment method on file is enforced for the sandbox and
   test numbers.
5. **Interactive message rules:** whether a body is required, whether the
   list body limit is 1024 or 4096, and whether either type can be sent
   outside the window.
6. **Delivery order** for two messages sent quickly, to confirm one message
   per turn is enough.
7. **Error code and body for sending outside the window**, so the failure can
   be logged precisely.
8. **Typing indicator and mark-as-read** request shapes (the *Service
   messages* page only described them in passing).
9. **Throughput and messaging limits** per number and the quality rating's
   effect; none of the pages read stated them.
10. **That the pages above are current.** Several are undated. Read Meta's
    WhatsApp changelog and the *Business-scoped user IDs* section for any
    entry after 5 November 2026 before building.

---

## 13. Testing plan (priority order)

1. **Renderer unit tests:** every turn kind to its output, the label and body
   limit fallbacks, the 1024 and 4096 boundaries, emoji and accents passing
   through untouched, never a truncated label.
2. **Signature and webhook tests:** valid, wrong, missing and re-encoded
   bodies; secret rotation with two secrets; verification handshake; wrong
   `phone_number_id`; batches with several users; duplicates; status
   webhooks ignored.
3. **Identity tests:** `wa_id` present, BSUID only, both, `user_changed_number`
   and `user_changed_user_id`.
4. **Stale-tap tests (core):** current tap, expired tap, a typed answer, and
   an old Yes after the step changed.
5. **Fixture tests** against recorded requests, as for USSD and SMS.
6. **Delivery tests:** window open, closed with a phone, closed without.
7. A manual run against a Meta test number once §12 is done.

---

## 14. Decisions and open questions

### Decisions (17 Nov 2026)

**1. Identity key: the phone when present, otherwise the BSUID. No alias
store in the first slice.**

- The key is `+<wa_id>` when `wa_id` is present, else the BSUID as given. A
  key that does not start with `+` means "no phone known" everywhere
  (§3): SMS fallback is skipped, and `pay` refuses.
- When a webhook carries both `wa_id` and a BSUID, nothing is stored about
  the pairing. The session lives under the phone key.
- `user_changed_number` and `user_changed_user_id` move the stored session to
  the new key when both the old and new keys are known to the adapter from
  that one webhook, and otherwise start the user fresh, logging that they
  did.
- **Why not the alias store now:** it needs a durable store of its own and
  rules for merging two sessions that both have state, and we do not yet know
  how common a phone-less BSUID is in the target markets (§12, item 3). The
  first slice is correct without it, only less continuous for users who hide
  their number.
- **Revisit when** the test-number work shows phone-less BSUIDs are common for
  your users, or the first user reports a lost session after changing phone.
  The key stays an opaque string, so adding an alias lookup later changes the
  adapter and nothing in core.

**9. Stale-tap protection goes into core now, not only into the WhatsApp
package.**

- It is a property of the engine, not of one channel: any adapter with
  tappable history needs it, and the check has to compare against the stored
  session, which only the engine can read. An adapter-only version would
  need its own session lookup and could disagree with the engine.
- **What changes in core:** an optional `turnSeq` on `SessionRecord` (a
  session stored before it exists reads as 0), an optional `turnSeq` on
  `InboundEvent`, the comparison in the engine, a `common.expiredChoice`
  message in `en` and `fr`, and tests. USSD and SMS never set the field and
  are unaffected.
- **When the counter bumps:** when a **new** turn is shown, that is, whenever
  the engine moves to a different step or message. It does **not** bump when
  the same turn is shown again (an invalid answer re-shown with a notice, a
  page change). Otherwise tapping a button on the message the user is looking
  at, just after a typed mistake re-sent it, would be refused as expired.
  Buttons from the earlier, identical message stay valid for the same reason.
- **A tap with no `turnSeq`** (an adapter that does not send one) is treated
  as a typed answer, as today.
- **An expired tap** shows the current turn again with the localized
  "That choice has expired", runs no handler, and starts no payment. This is
  required before payments are ever offered over a tappable channel (§9).

### Still open

2. **Over-long `say`.** Error for the developer (recommended, consistent with
   SMS), or paginate with a "More" button?
3. **Buttons, then list, then numbered text** for `choose`, never shortening
   labels (recommended). Agree?
4. **Signature required by default** with an explicit opt-out
   (recommended). Agree, given that Meta calls it optional?
5. **Acknowledge first, process in the background** (recommended), accepting
   a lost message if the process dies right after the `200`?
6. **No payments on WhatsApp in 0.4** (recommended).
7. **Late messages:** SMS fallback when a phone is known, otherwise log and
   drop (recommended). Or send an approved template, which needs template
   management that is out of scope?
8. **Typing indicator and read receipts:** later (recommended). They need no
   extra billable message but their request shapes are unverified.
10. **Package name and pinning:** `@kalangu/whatsapp`, with `graphVersion`
    configurable and a default that is bumped deliberately (recommended).
