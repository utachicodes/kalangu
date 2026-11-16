# TODO

State as of 16 Nov 2026. Design reference: [docs/design.md](docs/design.md).

## Verify-first checklist (before announcing anything)

- [x] Read the official Africa's Talking USSD and SMS docs — done; findings in
  design doc §2, corrections in §2.5
- [ ] Claim the `@kalangu` npm scope (found unclaimed 16 Nov 2026)
- [ ] Claim the GitHub organisation / repo name
- [ ] Domain
- [ ] Trademark search (a Hausa word — check local usage in target markets)
- [ ] Test the real session timeout and screen length on the operators you can
  reach; published figures vary and Kenya-only numbers are verified so far
- [ ] Confirm that a USSD session and an SMS to the same number work together
  on your operators — deferral depends on it
- [ ] Check what a USSD short code and an SMS sender ID cost and require, per
  country (sandbox is free; production is not)
- [ ] Search npm and the Chat SDK adapter directory for a USSD adapter
  published since 16 Nov 2026
- [ ] Ask two or three teams who run USSD services today whether deferral to
  SMS would suit their users (design doc §12, question 6, depends on this)

## v0.1 build order (each piece independently testable)

- [x] Turn types: `say`, `choose`, `ask`, `confirm`; `pay` reserved in the union
- [x] Budgeter: encoding-aware counting (GSM-7 160/153 vs UCS-2 70/67,
  extension-table chars count double), pagination, reserved nav numbers
- [x] Engine + in-memory session store keyed by phone number
- [x] `@kalangu/ussd` adapter, validated against recorded request fixtures
- [x] Terminal keypad simulator
- [x] `@kalangu/sms` adapter, validated against recorded request fixtures
- [x] Deferral + pluggable background-work interface
- [ ] Clinic example agent with the fake slow model; `pnpm demo`
- [ ] README how-to and docs polish
- [ ] CI: typecheck + vitest on push

## Design review — open questions to settle (design doc §12)

- [ ] 1. Navigation numbers: use `98` (More) ourselves, given telcos reserve
  it for auto-pagination?
- [ ] 2. Unsafe-character policy on USSD screens: strip + warn vs strict mode
- [ ] 3. Legacy vs new bulk SMS endpoint (legacy recommended until its sandbox
  ships)
- [ ] 4. SMS split cap (proposed max 4 segments, never silent truncation)
- [ ] 5. Callback authenticity: document path-secret/IP-allowlist mitigations
  (no signing exists to implement)
- [ ] 6. Re-notice vs block-screen when a user redials during a pending
  deferral
- [ ] 7. `enqueue` default on SMS send (proposed: omit unless configured)

## Version 0.2 — payments (do not rush; money code needs care)

- [ ] Read pawaPay's terms and sandbox docs before designing (the 24-country
  figure is the company's own claim)
- [ ] Design the policy layer: per-transaction limit, per-day per-user limit,
  allowed currencies — refused before the user sees anything
- [ ] State clearly what the library does not guarantee; the agent never sees
  a PIN
- [ ] Callback polling fallback design (MTN MoMo callbacks do not always
  arrive)

## Version 0.3 — languages

- [ ] Evaluate CommonLingua (61 languages, ~2M parameters) for detection
- [ ] Per-language model routing design
- [ ] Guide for community locale contributions (Wolof, Hausa, Swahili first)

## Version 0.4 — channels

- [ ] WhatsApp Cloud API adapter design
- [ ] Survey the Chat SDK adapter directory for a community USSD adapter
