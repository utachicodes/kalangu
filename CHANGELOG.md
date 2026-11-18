# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Website: a Providers page (models: Ollama, Claude, Gemini, any API in
  OpenAI's chat format, a model per language; gateways: Africa's Talking,
  several channels at once, writing a channel for another gateway). The
  header links to Agents and Providers, and Quick start opens a popup with
  one paste that builds and runs an agent from npm.

### Added

- Documentation on the website (kalangu.utachi.website/docs/): a quick start,
  a guide to building agents, guides (the Africa's Talking sandbox,
  translating, releasing), the design documents, contributing, the roadmap
  and the changelog. The pages are generated from the repository's markdown
  by `scripts/build-site.mjs` (`pnpm site:build`), and CI fails if they are
  out of date or have a broken link (`pnpm site:check`). The landing page
  links to them. The translation instructions moved from CONTRIBUTING.md to
  `docs/translating.md`.

### Fixed

From CodeRabbit's review of everything since #20 (#32):

- A live turn's time limit is now shared. Language detection, the handler
  and a payment's preparation each had their own, so one turn could run past
  the 10 seconds a USSD gateway waits. Together they now get `deadlineMs`
  plus the detection timeout, and a dial string that runs several handlers
  shares it too.
- A slow language detector could overwrite a newer turn: if the user moved on
  while it was answering, its suggestion replaced the newer screen. It is
  now dropped when another turn has saved the session first.
- Two Yes answers to a language suggestion arriving together could both run
  the held answer's handler. The first one now claims it, the same way a
  payment's Yes is claimed.
- The language menu now resolves a number against the languages it showed,
  not today's order: a deployment that reordered them could switch a caller
  who chose `1. English` to French. A language no longer offered shows the
  menu again.
- A held answer runs only if its step still asks the same question; after a
  change to the tree the offer lapses instead of reaching another handler.
  Offers saved by earlier versions lapse too.
- `@kalangu/sms`: a direct `send` now enforces `maxSegments`, as replies did.
- The translation drafting script no longer overwrites a file created at its
  output path while Gemini was answering, unless `--force` is given.
- RELEASING.md: what to do when a release fails part-way, and the smoke test
  installs the exact new version. The translation guide says how to use a
  translation and where to send one.

## [0.1.0-alpha.3] - 2026-11-17

### Fixed

From an independent review of everything merged in #21 and #26 to #30:

- A pending language suggestion could answer a later question: after a
  dropped call, a redial whose shortcut reached a confirm or a `pay` step had
  its Yes taken as the answer to the old suggestion. Any new question now
  clears a pending suggestion.
- Language detection ran on `number` answers and on text with no letters, so
  amounts and account numbers went to the detector. It no longer does.
- After accepting a language switch, a later answer could be offered another
  switch straight away. Detection now offers at most one switch per
  conversation; a No is still kept for good, deliberately.
- The first-contact language menu's stored id depended on how many extra
  steps the agent had, so changing them could send a user waiting at the menu
  to another step. It now has the fixed id `language`.
- Confirm labels that differ only by accents: typing the exact No label could
  read as Yes. An exact match now wins, and a folded match that fits both
  Yes and No is refused.
- `kalangu locale check` crashed on a key such as `toString`. It now reports
  it as an unknown key. The command sets its exit status instead of calling
  `process.exit`, so piped output is no longer cut off, and an unexpected
  error is reported in one line.
- `scripts/translate-locale.mjs` reports a network failure or an unreadable
  saved response in words, with an exit status, instead of crashing.

## [0.1.0-alpha.2] - 2026-11-17

### Added

- Language detection as a hint (docs/languages-design.md §9.5):
  `languages.detection: { detector, threshold, minChars, timeoutMs? }` with
  the `LanguageDetector` port. On a typed `ask` answer that a detector
  confidently places in another of the agent's languages, the user is asked
  in that language whether to continue in it; the answer is held and then
  handled in whichever language they choose. A "No" is remembered for the
  session. No detector ships; `threshold` and `minChars` have no default.
- `models: { default, [locale]: model }`: a model per language, resolved as
  `ctx.model` for the user's current language.
- `docs/prior-art.md` refreshed (17 Nov 2026): nothing new since 16 Nov, and
  `@omoyolab/ussdkit` recorded as the closest prior art.
- `scripts/translate-locale.mjs`: drafts Kalangu's fixed strings in another
  language with Gemini (`gemini-3.5-flash-lite` by default), writes
  `locales/<code>.draft.json` marked as an unreviewed machine draft, and runs
  the locale checker on it. The key is read from `GEMINI_API_KEY` and sent
  only in the request header. Its tests run in CI (`node --test "scripts/**/*.test.mjs"`).
- `kalangu locale check` takes the language code from the file name up to its
  first dot, so `wo.draft.json` is checked as `wo`.
- `docs/normalization-design.md`: the text normalization design (folding,
  USSD spelling, canonicalizing; Gemini offline only; its own repository
  later).

### Fixed

- A typed answer that names an option without its accents was refused: on
  USSD the language menu shows "Français" as "Francais", and typing that back
  gave "Invalid choice". `interpret` now matches typed text to labels and to
  the yes and no words ignoring accents, case, spacing and apostrophe style
  (`foldForMatch`), and against the label as a USSD screen shows it, so Hausa
  "Ɗan" shown as "Dan" can be typed back too. An exact match still wins; a
  folded match that fits more than one label is refused.

## [0.1.0-alpha.1] - 2026-11-17

### Fixed

- The installed `kalangu` command did nothing. npm installs a package's
  command as a symlink, and the check for "started as a command" compared
  the symlink's path with the real file's, so it never ran. Both paths are
  now resolved first (`isEntryPoint`), with a test that runs through a
  symlink.
- `RELEASING.md` told people to install with `@alpha`, a tag that does not
  exist: npm's staged-publishing approval set `latest` on the first release.
  It now says to install without a tag and to check the tags after approving.

## [0.1.0-alpha.0] - 2026-11-17

First publish of `@kalangu/core`, `@kalangu/ussd`, `@kalangu/sms` and
`@kalangu/sim`. Everything below was in it.

### Added

- Payments in `@kalangu/core` (prep, no real provider yet): the `pay` step,
  `createAgent({ payments })` with a mandatory policy, the confirm screen
  that ends the USSD session before the deposit is initiated, background
  initiation, status polling with backoff and a 72-hour give-up
  (`UNRESOLVED`), `agent.payments.settle(id)` for callback routes (re-checks
  the provider, never trusts the body), and the outcome and receipt by SMS.
  The `pay` turn amount is now a decimal string.
- `agent.payments.reconcile()`: a sweep for a cron job or scheduler that
  settles non-final payments, re-initiates fresh never-initiated ones,
  fails old never-started ones, and marks payments past the give-up window
  `UNRESOLVED`. It reports what it did and survives a failing payment.
- `PaymentStore` gains three atomic operations a durable store must
  implement: `transition` (a final status stays final), `claimNotification`
  (each outcome is announced once) and `withPhoneLock` (limits cannot be
  raced past). Fixes a bug where two processes could both notify the user.
- `SessionStore.save` takes `{ ifVersion }` for compare-and-set and the
  store declares `atomic: true` when it honours it; `SessionRecord.version`
  is bumped on every save. An agent with `payments` requires an atomic store,
  and a double-tapped "Yes" now starts exactly one payment.
- Review fixes in payments: payments still in flight count toward the pending
  limit however old; an outcome that failed to send is released and retried
  by `reconcile` (`unnotified`, `releaseNotification`, `notifyAttempts`,
  report field `redelivered`); outcome delivery waits for the turn's session
  save; `reconcile` marks a payment unresolved when its status check keeps
  failing; a refused root `pay` step ends with a message instead of looping;
  looking up the operator on a live channel honours the USSD deadline;
  `PaymentRecord.providerPhone`; `pollRepeatMs`; exact decimal sums; the
  provider minimum amount; `"100.0"` accepted for providers without decimals;
  amounts too large to hold exactly refused; payment ids cannot change.
- A payment is failed as "not found" only if it is still in the status that
  justified that conclusion, and an outcome is only ever announced for a
  final payment: another process seeing the payment in the meantime can no
  longer cause a "not completed" message for a payment still in progress.
- Stale-tap protection for channels with tappable history: a random per-turn
  token, `turnId`, on sessions, `InboundEvent.turnId` and
  `RenderContext.turnId`. A tap carrying any token but the current one (an
  earlier turn, a cleared or restarted session, a concurrent request that
  rendered a different turn) shows the current turn again with "That choice
  has expired." and runs nothing, so an old Yes can never confirm a later
  question or start a payment, and a Yes on one confirmation cannot pay the
  amount of another. USSD and SMS are unaffected.
- Languages (first slice of docs/languages-design.md, no model needed):
  `createAgent({ languages })` asks the user to choose a language on first
  contact and remembers it per phone number, with a menu that names each
  language in itself and lists the likely ones for the caller's country
  first (`DEFAULT_LANGUAGE_PRIORS`, `orderLanguages`, `callingCodeOf`); and
  `languageMenu()` for a Language entry in the tree. New message
  `common.language`.
- `kalangu locale check <file>` and `checkLocale`: checks a translation for
  missing, unknown and empty keys, lost or invented `{placeholders}`, and how
  each string fits USSD (letters removed or shown differently, screen length)
  and SMS (UCS-2, segments). The `kalangu` command is the new `bin` of
  `@kalangu/core`.
- Payment refusals (policy rules and provider reasons) are localized in `en`
  and `fr` through `payments.refusal.*` messages, which can be overridden.

- `@kalangu/core` package with the turn types (`say`, `choose`, `ask`,
  `confirm`, and `pay` reserved for 0.2), `parseTurn`/`isTurn` for
  validating turns from untyped sources, `assertNever` for exhaustive
  switches, and tests. TypeScript and vitest added as root dev dependencies.
- Budgeter in `@kalangu/core`: encoding-aware SMS length (`smsLength`,
  exact `splitSegments`, `budgetSms` with a 4-segment cap that throws
  instead of truncating), and USSD screen helpers (`toUssdSafe` safe
  character set with transliteration, `optionNumbers` skipping reserved
  `98`/`00`, `paginateText` and `paginateMenu` with a `98. More` line).
- Engine in `@kalangu/core`: step builders (`menu`, `choose`, `ask`,
  `say`, `confirm`), `createAgent` with `handle()` and a standard
  `Request`/`Response` `requestHandler`, USSD and SMS renderers with a
  matching input interpreter, channel helpers (`ussdChannel`,
  `smsChannel`), an in-memory session store keyed by phone number with
  resume-on-redial, `en`/`fr` messages with per-step localized text, and a
  logger that masks phone numbers by default.
- `@kalangu/ussd`: Africa's Talking USSD adapter. Parses the callback
  form, answers `200 text/plain` with `CON `/`END ` on every path including
  errors, optional `at-ussd-hop-metadata` header, configurable screen size,
  and a session-end notification route. Tested against form fixtures built
  from the documented fields.
- Engine: a new gateway session id counts as a fresh dial, and a dial
  string with choices in it (`*384*1*2#`) is replayed from the start menu.
- `@kalangu/sim`: terminal keypad-phone simulator. `SimPhone` drives an
  agent directly (dial, press, hang up, text, inbox) for tests; `runTerminal`
  puts a boxed-screen UI on top with `x` to hang up, `sms <text>` and `q`.
- `@kalangu/sms`: Africa's Talking SMS adapter. Sends through the legacy
  `/version1/messaging` endpoint behind an `SmsTransport` seam (HTTP 201
  success, sandbox domain switch, `bulkSMSMode`, `enqueue` only when set),
  raises `SmsSendError` with the gateway's own codes (including the `409`
  DND rejection), answers incoming messages by SMS in the background, and
  logs delivery reports.
- Deferral in `@kalangu/core`: handlers on a live channel run under a
  deadline (default 4000 ms; warns above 8000, refuses above 10000). A
  missed deadline ends the session with the localized notice and the
  answer is sent by SMS when it arrives; a late failure is logged and the
  user gets one apology SMS. Redialing while an answer is pending repeats
  the notice. Background work is pluggable (`BackgroundWork`) for
  serverless platforms; the default runs in-process.
- `examples/clinic`: the clinic agent (opening hours, ask a nurse,
  English/French) with a fake nurse model that takes 6 s against the 4 s
  deadline. `pnpm demo` builds the workspace and runs it on the simulated
  keypad phone; `src/server.ts` serves it on Africa's Talking with Node's
  `http` module.

- CI on GitHub Actions: typecheck, tests and build on Node 22 and 24, and
  a smoke test of the compiled packages on Node 20 (`pnpm smoke`).

- Payments design for 0.2 (`docs/payments-design.md`): pawaPay deposits,
  policy layer, idempotency, signed callbacks with polling fallback, and
  what the library does not guarantee. Draft; no payment code.

- Publish preparation: npm metadata (repository, keywords, `alpha` tag,
  public access), a README and LICENSE in each package, a manual Release
  workflow (dry run by default, npm provenance), and `RELEASING.md`.
  Nothing is published yet.

### Changed

- README: v0.1 status, package list, quick start, how to write an agent,
  and known limits. CONTRIBUTING updated for working on the code.
- Design document: corrected which French letters are in GSM-7, and added
  §14 listing where the implementation differs from the design.
- Design document `docs/design.md` for version 0.1: package layout, public
  API sketch, turn types (with `pay` reserved), engine and sessions keyed by
  phone number, deferral, the encoding-aware budgeter, Africa's Talking USSD
  and SMS adapters, a terminal keypad simulator, an example clinic agent, a
  test plan, and open questions.
- Verified gateway facts (checked 16 Nov 2026 against official
  documentation and the official Node SDK): USSD callback format and timing
  bounds, Kenya screen limits, telco auto-pagination with reserved `98`/`00`
  codes, session-end notifications, and the legacy vs new bulk SMS endpoints
  (`docs/design.md` §2).
- Repository setup: README, TODO, CHANGELOG, MIT license, contributing
  guide, pnpm workspace scaffolding (root `package.json`,
  `pnpm-workspace.yaml`, `tsconfig.base.json`), `.gitignore`,
  `.editorconfig`.
