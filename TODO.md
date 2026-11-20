# TODO

State as of 20 Nov 2026. Design reference: [docs/design.md](docs/design.md).

## Verify-first checklist (before announcing anything)

- [x] Read the official Africa's Talking USSD and SMS docs: done; findings in
  design doc §2, corrections in §2.5
- [x] Claim the `@kalangu` npm scope: claimed; `0.1.0-alpha.0` to
  `0.1.0-alpha.3` published on 17 Nov 2026, `0.1.0-alpha.4` and
  `0.1.0-alpha.5` on 18 Nov 2026, and `0.1.0-alpha.6` to `0.1.0-alpha.9`
  on 19 Nov 2026 (see [RELEASING.md](RELEASING.md))
- [ ] Claim the GitHub organisation / repo name
- [ ] Domain
- [ ] Trademark search (a Hausa word: check local usage in target markets)
- [ ] Run the clinic example on the Africa's Talking sandbox end to end
  ([docs/sandbox-guide.md](docs/sandbox-guide.md)): proves the gateway
  integration and the deferral to SMS, not operator behaviour. Needs a free
  account; correct the guide from what the first run shows
- [ ] Test the real session timeout and screen length on the operators you can
  reach; published figures vary and Kenya-only numbers are verified so far
- [ ] Check that no operator you can reach intercepts `98` (our "More")
  before it reaches the gateway; if one does, change `budget.more`
- [ ] Confirm that a USSD session and an SMS to the same number work together
  on your operators: deferral depends on it
- [ ] Check what a USSD short code and an SMS sender ID cost and require, per
  country (sandbox is free; production is not)
- [x] Search npm and the Chat SDK adapter directory for a USSD adapter
  published since 16 Nov 2026: none, refreshed 17 Nov 2026
  ([docs/prior-art.md](docs/prior-art.md) §6, which also records
  `@omoyolab/ussdkit`, the closest prior art). Repeat right before announcing
- [ ] Ask two or three teams who run USSD services today whether deferral to
  SMS would suit their users (design doc §12, question 6, depends on this)

## Example: Ndiédieng (live at /ndiedieng)

A full use case for the commune of Ndiédieng (Kaolack, Senegal), and the
website's live demo: [kalangu.utachi.website/ndiedieng](https://kalangu.utachi.website/ndiedieng/).
Code and French README in [examples/ndiedieng](examples/ndiedieng).

- [x] Prototype: USSD `*123#` menus (breakdowns, births, deaths, follow-up,
  free message), free SMS and voice messages sorted by category and urgency,
  the town hall's reports, SMS back to the chief, the territorial assistant
  with the data behind each answer (rules, or Gemini on the server)
- [x] Online at `/ndiedieng`, running entirely in the browser (sql.js);
  CI checks the published page is built from source (`check:web`)
- [x] Three phones true to their systems: keypad phone, Android (Material 3),
  iPhone (iOS)
- [x] Reports: open, edit, create and delete from the dashboard; the
  dashboard fits the screen without scrolling
- [x] The assistant on its own page (`/ndiedieng/assistant/`), with an orb to
  tap and speak; answers read aloud or written
- [x] Voice: a clear message instead of a hang where a browser offers
  dictation without running it; live waveform and glow
- [x] The in-browser demo kept in IndexedDB, shared by both pages; "start
  over" in Help
- [x] Undo after deleting a report, CSV export of the list, and a quick search
  (Ctrl/Cmd + K) over reports, villages and actions
- [x] Linked from the README, the docs overview and the landing page
- [x] Gemini on the website: a serverless function (`/api/ndiedieng/gemini`,
  built from `src/geminiFunction.ts`) holds `GEMINI_API_KEY`; fixed tasks
  only, limited per visitor, the rules whenever it fails
- [x] Confirm the function answers on the live site: it did on 20 Nov 2026
  (questions, greetings and the spoken answers)
- [ ] Set a quota on the Gemini key in Google AI Studio
- [ ] The free tier's speech quota runs out after a few spoken answers
  (Gemini answers 429): then French falls back to the browser's voice and
  Wolof is only written. Enable billing on the key for the demo days, or
  accept the fallback
- [ ] Run Ndiédieng on the Africa's Talking sandbox with their phone
  simulator (needs an account and a public URL for the callbacks)
- [ ] Wolof in the example (Gemini already sorts Wolof SMS; everything else
  is French). Step 1, buildable now, with drafts clearly marked unreviewed:
  - [ ] Language choice at `*123#` (1. Français / 2. Wolof), remembered per
    number, with Kalangu's language menu
  - [ ] The Ndiédieng menus and SMS replies in Wolof (about 40 strings),
    drafted with Gemini
  - [x] The assistant answers in Wolof when asked in Wolof, written and
    spoken: Gemini reports the question's language and the answer and voice
    follow it. Tested with a question spoken by Gemini's own voice ("ñaata
    foraj ñoo yaqu…" → the 8 broken boreholes, answered in Wolof); not yet
    with a real speaker
  - [ ] Wolof voice messages through Gemini audio transcription (browsers do
    not dictate Wolof). The assistant already listens through Gemini, and its
    transcription prompt accepts French or Wolof; quality to test with speakers
  - [x] Spoken answers in Wolof (the "speak" task takes the language)
  - [ ] A review sheet (French | Wolof draft | correction) for a speaker
- [ ] Step 2: a Wolof speaker reviews every string (and `locales/wo.draft.json`,
  where some entries already look wrong) before the field tests on 19 Dec
- [ ] Then Sérère, the same way; a speaker matters even more there
- [x] Gemini's speech model speaks Wolof (confirmed by the maintainer, 20 Nov
  2026); quality still to judge with speakers
- [ ] Try `/ndiedieng` on real phones (Android and iPhone, Safari and Chrome),
  dictation included
- [ ] Hackathon JDL 2026: application due 8 Dec 2026; field tests with the
  village chiefs on 19 Dec, final on 20 Dec, in Ndiédieng

## Website

- [x] Documentation on the website: quick start, agents, guides, design,
  contributing, roadmap, changelog; generated from the markdown and checked
  in CI (`pnpm site:check`)
- [x] Landing page ("Live example" button) and docs overview link the live
  example (`/ndiedieng`), and the sitemap lists it
- [x] Components page (`/components/`), cut to what is not available
  elsewhere: the USSD/SMS screen preview on Kalangu's budgeter, one USSD
  session on three phones, the voice orb on a real microphone, Marble Jr.,
  dictation that never hangs, and spoken answers that play on iPhones
- [ ] Look over the docs pages on a real phone and a desktop after the next
  deploy

## v0.1 build order (each piece independently testable)

- [x] Turn types: `say`, `choose`, `ask`, `confirm`; `pay` reserved in the union
- [x] Budgeter: encoding-aware counting (GSM-7 160/153 vs UCS-2 70/67,
  extension-table chars count double), pagination, reserved nav numbers
- [x] Engine + in-memory session store keyed by phone number
- [x] `@kalangu/ussd` adapter, validated against recorded request fixtures
- [x] Terminal keypad simulator
- [x] `@kalangu/sms` adapter, validated against recorded request fixtures
- [x] Deferral + pluggable background-work interface
- [x] Clinic example agent with the fake slow model; `pnpm demo`
- [x] README how-to and docs polish
- [x] CI: typecheck + vitest on push (Node 22/24), runtime smoke test on Node 20

## Design review: open questions (design doc §12), settled 17 Nov 2026

Decisions are recorded under "Decisions" in §12. Question 1 stays unverified
until a real operator confirms `98` is not intercepted (see the checklist
above).

- [x] 1. Navigation numbers: use `98` (More) ourselves, given telcos reserve
  it for auto-pagination?
- [x] 2. Unsafe-character policy on USSD screens: strip + warn vs strict mode
- [x] 3. Legacy vs new bulk SMS endpoint (legacy recommended until its sandbox
  ships)
- [x] 4. SMS split cap (proposed max 4 segments, never silent truncation)
- [x] 5. Callback authenticity: document path-secret/IP-allowlist mitigations
  (no signing exists to implement)
- [x] 6. Re-notice vs block-screen when a user redials during a pending
  deferral
- [x] 7. `enqueue` default on SMS send (proposed: omit unless configured)

## Version 0.2: payments (do not rush; money code needs care)

- [x] Draft the design: [docs/payments-design.md](docs/payments-design.md)
  - [x] Policy layer: per-payment, per-day per-user and pending limits,
    allowed currencies, refused before the user sees anything (§5)
  - [x] What the library does not guarantee; the agent never sees a PIN
    (§8, §9)
  - [x] Polling fallback for missed callbacks (§6.5)
- [x] Review the design, especially §3 (USSD session vs PIN prompt) and the
  open questions in §14
- [x] Prep code against the fake provider, no pawaPay (tested end to end):
  - [x] Decimal-string `pay` turn amount
  - [x] Policy layer, payment store, provider port, fake provider
  - [x] `pay` step, `payments` config validation (no policy, no payments)
  - [x] Confirm → end session → background initiate → poll → SMS outcome
    and receipt; unknown outcomes keep polling, give up as `UNRESOLVED`
  - [x] `agent.payments.settle(id)` re-checks status for callback routes
- [x] Localized policy and provider refusal messages (`en`, `fr`)
- [x] `agent.payments.reconcile()` for a cron or scheduler (§6.5): finishes
  payments whose in-process polling died with a restart
- [x] README note: on serverless, `reconcile()` on a schedule is the only
  reliable path (§6.5)
- [x] Address the CodeRabbit review of the payments PR: old in-flight payments
  counted by the pending limit, failed outcome deliveries retried by
  `reconcile`, outcome delivery waits for the turn's session save, `reconcile`
  gives up when a status check keeps failing, root pay step refusal no longer
  loops, operator lookup under the USSD deadline, provider phone stored,
  exact decimal totals, provider minimum, `"100.0"` accepted for NONE
  decimals, ids immutable
- [x] Make outcome delivery and a concurrent turn safe together (payments
  design §9): the handler's changes and an "applied" record are saved in one
  versioned save, a retry resends without running `onPaid` again, and a
  concurrent turn keeps its place
- [x] Atomic store primitives (`transition`, `claimNotification`,
  `withPhoneLock`) so two processes cannot notify or begin twice (§6.1)
- [x] Session store compare-and-set, so a double-tapped Yes cannot start two
  payments when `maxPendingPerPhone` is above 1
- [ ] Read pawaPay's terms of service (the v2 API docs were read on
  16 Nov 2026; the 24-country figure is the company's own claim)
- [ ] Sandbox account; work through the verify-first list in §12
- [ ] Then, and only then, payment code

## Version 0.3: languages

- [x] Desk-check CommonLingua (read 17 Nov 2026): Apache-2.0 per its model
  card; 2.35M parameters; PyTorch only, no ONNX or JS build; 77.6% strict
  accuracy on paragraphs; "not assessed on very short text"; Wolof, Hausa and
  Swahili not named as covered
- [x] Detector evaluation harness (`scripts/eval-detector.mjs`, languages
  design §13 item 6): accuracy, confusion, length, threshold sweep, latency
- [ ] Hands-on detector evaluation on short keypad-typed text in Wolof, Hausa
  and Swahili (languages design §12): needs labelled samples from speakers,
  then one run of the harness per candidate detector
- [ ] Review the languages design, especially §4 (ask first, detection as a
  hint) and the seven open questions in §14
- [x] Per-language model routing design (languages design §7)
- [x] Detector port and model map built (languages design §9.5), tested with
  a fake detector; no real detector ships
- [x] Language detection on the first SMS of a conversation (§5): a new
  number sees its language first in the menu, a known one is offered the
  switch (languages design §9.5)
- [x] `kalangu locale check` (placeholders, USSD and SMS fit) and the
  contributor guide for community locales (CONTRIBUTING.md); designed in
  languages design §8 and §9
- [x] Language menu: `createAgent({ languages })`, `languageMenu()`, country
  priors (languages design §4, §9.4)
- [x] Gemini drafting script for translations (`scripts/translate-locale.mjs`,
  CONTRIBUTING.md): drafts only, marked unreviewed
- [x] Wolof, Hausa and Swahili machine drafts (Gemini, 19 Nov 2026), through
  the checker and checked in CI: `locales/*.draft.json`, marked not reviewed
- [x] Draft the text normalization design:
  [docs/normalization-design.md](docs/normalization-design.md) (fold,
  render for USSD, canonicalize; Gemini offline only; own repo later)
- [x] Fix: a typed language name without its accent ("francais") was refused,
  though USSD itself shows it that way. Typed answers are now matched ignoring
  accents, case, spacing and apostrophe style, and against the USSD form of
  the label (normalization design §11 step 1)
- [ ] Review the normalization design and its questions for native speakers
  (§10, §12)
- [ ] Native speakers to review the Wolof, Hausa and Swahili drafts in
  `locales/` (`locales/README.md` says how)

## Version 0.4: channels

- [x] Draft the WhatsApp Cloud API adapter design:
  [docs/whatsapp-design.md](docs/whatsapp-design.md)
  - [x] Meta facts read from the official docs (17 Nov 2026), with what could
    not be confirmed listed in §12
  - [x] Identity (BSUIDs), the 24-hour window and cost, rendering, stale taps,
    webhook signing and deduplication
- [x] Settle WhatsApp questions 1 (identity key: phone, else BSUID, no alias
  store yet) and 9 (stale-tap `turnId` goes into core)
- [x] `turnId` stale-tap protection in core, a random per-turn token (tested,
  including that a stale Yes starts no payment)
- [ ] Review the rest of the WhatsApp design, especially §3 and §6, and the
  eight questions still open in §14
- [ ] Get a Meta test number and work through the verify-first list in §12
  (signature over raw bytes, per-market message cost, `wa_id` presence)
- [ ] Then, and only then, WhatsApp code
- [x] Survey the Chat SDK adapter directory for a community USSD adapter:
  none as of 17 Nov 2026 (docs/prior-art.md §6)
