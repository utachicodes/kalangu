# TODO

State as of 18 Nov 2026. Design reference: [docs/design.md](docs/design.md).

## Verify-first checklist (before announcing anything)

- [x] Read the official Africa's Talking USSD and SMS docs: done; findings in
  design doc §2, corrections in §2.5
- [x] Claim the `@kalangu` npm scope: claimed; `0.1.0-alpha.0` to
  `0.1.0-alpha.3` published on 17 Nov 2026 and `0.1.0-alpha.4` on
  18 Nov 2026 (see [RELEASING.md](RELEASING.md))
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

## Website

- [x] Documentation on the website: quick start, agents, guides, design,
  contributing, roadmap, changelog; generated from the markdown and checked
  in CI (`pnpm site:check`)
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
- [ ] Make outcome delivery and a concurrent turn safe together (known limit,
  payments design §9): needs a way to retry `onPaid` without running it twice
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
- [ ] Hands-on detector evaluation on short keypad-typed text in Wolof, Hausa
  and Swahili (languages design §12): coverage, accuracy, what the score means
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
- [ ] Wolof, Hausa and Swahili translations, through the checker: draft with
  the script if useful, then native speakers (see the next item)
- [x] Draft the text normalization design:
  [docs/normalization-design.md](docs/normalization-design.md) (fold,
  render for USSD, canonicalize; Gemini offline only; own repo later)
- [x] Fix: a typed language name without its accent ("francais") was refused,
  though USSD itself shows it that way. Typed answers are now matched ignoring
  accents, case, spacing and apostrophe style, and against the USSD form of
  the label (normalization design §11 step 1)
- [ ] Review the normalization design and its questions for native speakers
  (§10, §12)
- [ ] Native speakers to supply and review the Wolof and Hausa translations
  (the first draft's sample Wolof strings were removed: unverified)

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
