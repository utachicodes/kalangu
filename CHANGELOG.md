# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Search and sharing: the landing page describes Kalangu to search engines
  (schema.org WebSite and SoftwareSourceCode), and the landing, components
  and docs pages share with a 1200×630 card (`site/assets/og.png`) instead of
  a bare link. The four packages' npm "homepage" now points to the website.
- The landing page scrolls past the hero to a short "Why Kalangu?": six
  reasons (keypad phones, screens counted before sending, the 4-second
  deadline, any model, languages, testing without a SIM), an agent in one
  screen of code, the Ndiédieng example, how to install, and a footer. The
  hero's "↓" now leads there.
- No button or link appears twice on a page any more, each kept where it
  belongs: on the landing page the hero keeps Quick start, Documentation and
  Live example and the nav the site's sections; the docs header keeps only
  what the sidebar doesn't list; the components page names the example once.
  The Ndiédieng dashboard stays as it was.
- Ndiédieng's assistant answers in Wolof when asked in Wolof, in writing and
  aloud: Gemini reports the question's language (from the transcription and
  the question) and the answer and the voice follow it; otherwise French.
  The prompt now lists the data's exact values ('en panne', not 'en_panne'),
  which fixed a wrong "no broken borehole" answer. Spoken answers use two
  speech requests at most, since the speech quota is tight; if the second
  fails, the browser's voice finishes a French answer.
- Ndiédieng's assistant listens through Gemini when it is available: the page
  records the question, stops by itself at a pause (judged against the
  room's own noise), and Gemini transcribes it (French or Wolof), so it works
  in every browser, not only those whose dictation runs. Spoken answers start
  sooner: the first sentence plays while the next is prepared. The glow at
  the bottom of the screen is now a full-width band that rises with the
  voice and breathes while the assistant thinks; the fine print under the
  orb is gone.
- The components page keeps only what is not available elsewhere: "The
  Bouncer", a USSD and SMS screen preview on Kalangu's own budgeter (which
  characters double an SMS's cost, how a menu splits into screens); "The
  Triplets", one real Kalangu USSD session on a keypad phone, an Android and
  an iPhone; the voice orb on your real microphone; Marble Jr.; dictation
  that never hangs; and spoken answers that play on iPhones. The commodity
  pieces (select, toast, tabs, quick search, CSV) are gone from it.
- The website has a components page (`/components/`, linked next to Design,
  Roadmap and Contribute, and in the docs header): the twelve UI components
  built for the Ndiédieng example, each with a live demo running from the
  exact code shown (HTML, CSS, JS, copyable), a nickname, and the reason it
  exists, plus Marble, a mascot orb with googly eyes that follow the pointer.
- Ndiédieng's dashboard: deleting a report is immediate, with "Annuler" in
  the toast to bring it back under its own number (`POST
  /api/signalements/S-xxxx/restaurer`, for ten minutes, refused if the number
  was given out again); "Exporter" downloads the reports shown as a CSV for
  Excel (semicolons, accents kept, phone numbers masked); and Ctrl/Cmd + K
  opens a quick search over reports, villages and actions, driven from the
  keyboard.
- Ndiédieng on the website can use Gemini: a serverless function
  (`/api/ndiedieng/gemini`, generated from `src/geminiFunction.ts`) holds
  `GEMINI_API_KEY` and runs only the prototype's fixed tasks (write a query,
  word an answer, sort a message), with size limits, an origin check and a
  per-visitor rate limit. The page uses it when it is there, and the rules
  otherwise. All Gemini prompts now live in `src/gemini.ts`; greetings and
  thanks get a proper answer, with or without Gemini. The assistant's orb is
  now a glassy sphere with colour drifting inside; a spoken question gets a
  spoken answer and a typed one a written answer, so the separate Voix/Texte
  switch is gone. With Gemini, answers are read by Gemini's speech model (a
  `speak` task in the same function), and the orb follows the voice's real
  level; the browser's own voice, now the most natural French one the system
  has, is the fallback.
- The README, the docs overview and the landing page present the Ndiédieng
  example as Kalangu's live use case (`/ndiedieng`, a "Live example" button
  and an "Example" link), and the sitemap lists its two pages. TODO.md tracks
  what is done and what is next for it.
- Ndiédieng: the Mairie can open any report in a dialog to change its
  category, equipment, urgency, status or description, create one itself, or
  delete one (new `POST`, `GET`, `PATCH` and `DELETE` routes under
  `/api/signalements`); the equipment's state follows its open reports. The
  dashboard fits the screen without scrolling (one filter row, a five-column
  list, the phone scaled to fit), and the assistant has its own page
  (`/ndiedieng/assistant/`) built around a glowing orb: touch it and speak,
  and the answer is read aloud or written (a keyboard button types the
  question instead). The iPhone and the Android phone now follow their own
  systems (Dynamic Island inside the screen, iOS keypad and Messages; punch-
  hole camera, Material 3 dialer and Google Messages). An unrecognised
  question gets suggestions to tap instead of a list of examples. Dictation now fails with a clear message instead
  of hanging where a browser offers it but does not run it, and shows a live
  waveform and glow. The in-browser demo is kept in IndexedDB, so both pages
  share it and a reload keeps it.
- The Ndiédieng prototype is online at kalangu.utachi.website/ndiedieng,
  running entirely in the visitor's browser (Kalangu, SQLite through sql.js,
  and the API), with a new interface: three phones (a simple keypad phone,
  Android and iPhone, each with its own USSD dialog), voice messages and a
  spoken assistant (the browser's dictation and speech), and a reworked
  dashboard (search, status filters, relative times, cards on phones). The
  example's data layer now runs on both Node's SQLite and sql.js; CI checks
  the published page is built from source.
- `examples/ndiedieng`: a prototype for the commune of Ndiédieng (Senegal), in
  French, on fictitious data (58 villages, 200 equipments, 499 records). Village
  chiefs report breakdowns, births and deaths by USSD or SMS; free SMS are
  sorted by keywords or Gemini, unclear ones sent to be checked; the town
  hall's dashboard answers each report by SMS; and a territorial assistant
  answers questions from the data, showing its SQL, with Gemini's queries
  checked and run read-only. A demo page puts a simulated chief's phone beside
  the dashboard.

## [0.1.0-alpha.9] - 2026-11-19

### Added

- `checkSessionStore(makeStore)` and `checkPaymentStore(makeStore)`: the
  session and payment store contracts, runnable against a store you write,
  for any test framework. They check versions and `ifVersion` conflicts,
  copies, isolation by phone, an idempotent payment `create`, a final status
  kept final, exactly one winner among simultaneous versioned saves,
  transitions and notification claims, release counting, `unnotified`,
  `pending`, the policy's `totals`, and the phone lock. Each returns the
  problems found.
- `@kalangu/sim`: each incoming SMS shows what it costs, for example
  `✉ SMS from CLINIC (2 segments, UCS-2 because of ë): ...`, so a message
  that one letter makes three times as expensive is visible while testing.
- Clinic example: `sqliteSessionStore`, a durable, atomic session store on
  Node's built-in `node:sqlite` (Node 22.13+), a reference for writing one on
  any database; it passes `checkSessionStore`. The example server takes
  `SESSION_DB`, and `CALLBACK_SECRET` and `ALLOWED_IPS` to protect its
  callbacks.
- Protecting callbacks, which Africa's Talking does not sign: the Agents
  page explains a secret path segment and an address allowlist (the
  gateway's addresses are not published; its support shares them), with
  code.
- Machine drafts of Kalangu's fixed strings in Wolof, Hausa and Swahili
  (`locales/*.draft.json`, Gemini, not reviewed), with `locales/README.md`
  on how a native speaker reviews one. CI runs `kalangu locale check
  --complete` on every file in `locales/`.
- `SECURITY.md`: how to report a vulnerability privately, what to expect,
  what is in scope, and the documented limits that are not vulnerabilities.
- `pnpm pack:check` (in CI, on Node 20): packs the four packages, installs
  the tarballs in an empty project, runs the installed `kalangu` command,
  imports every package, typechecks against the published types, and runs
  an agent on the simulator.
- The quick start is tested: its files are written out exactly as the page
  shows them, run, and their output compared with the page's (in CI).
- Website: a sitemap, `robots.txt`, a favicon, canonical URLs and link
  previews on every page, and a 404 page, all generated with the docs.

### Changed

- The four package READMEs (what npm shows): `npm install`, links to the
  website's docs, the store checks and the reference SQLite store, the
  simulator's SMS costs and `Dial>` hint, the SMS cap on direct sends, and
  how to protect unsigned callbacks.
- Repository: CodeQL code scanning, Dependabot for GitHub Actions and npm
  (with `@types/node` held on the oldest supported Node), issue forms and a
  pull request template; the workflows moved to `actions/checkout@v7`,
  `actions/setup-node@v7` and `pnpm/action-setup@v6`, with no cache restored
  in the job that publishes.

### Fixed

- `@kalangu/sim`: the published types needed Node's own type definitions
  (`NodeJS.ReadableStream`), so a TypeScript project without `@types/node`
  got errors from the package. The terminal's `input` and `output` options
  are now typed by what they use (`TerminalInput`, `TerminalOutput`).
  Found by `pnpm pack:check` on its first run.
- Website: on phones the docs header's links ran into the logo. The logo no
  longer shrinks, GitHub hides below 440 px (it is in every page's footer)
  and Contributing below 360 px (it is in the sidebar).

## [0.1.0-alpha.8] - 2026-11-19

### Added

- The clinic example can answer with Gemini: `GEMINI_MODEL=gemini-3.5-flash-lite
  pnpm demo` with `GEMINI_API_KEY` exported (and the same for the server).
  The key goes in a header, never the URL; the model's thinking parts are
  never sent; answers are cleaned and fitted to the SMS cap as for Ollama,
  whose shared pieces moved to `answer.ts`. `nurses.ts` picks Gemini, then
  Ollama, then the fake nurse.

### Changed

- `@kalangu/sim`: typing something that is not a code at `Dial>` (such as
  `1` after a USSD screen ended, or to answer an SMS) still gets the phone's
  own "invalid MMI code" screen, now followed by a line saying what to type
  instead: dial the code, or reply by SMS with `sms 1`. The header also says
  to dial again after a screen marked `END`.

## [0.1.0-alpha.7] - 2026-11-19

### Fixed

From a review of everything since 0.1.0-alpha.4:

- A turn's own save could undo a payment outcome or a deferred answer saved
  while it ran: `onPaid`'s session changes were lost (and, the outcome being
  marked delivered, never retried), or the "answer on its way" notice came
  back for 15 minutes after the answer was sent. The turn's save is now
  versioned and merges its changes into the newer session. Payment outcomes,
  deferred answers and turns share one merge, so the two background paths no
  longer have their own retry loops.
- Payment delivery no longer runs `onPaid` again when the session keeps
  changing: after five conflicts the message is sent without updating the
  session, instead of failing and being retried.
- A deferred answer whose save conflicted was rendered again, repeating the
  developer's `spec` callback and the operator lookup when the reply was a
  pay step. It is now rendered once and merged.
- Clinic example: `OLLAMA_HOST=localhost` (no port) pointed at port 80; it
  now uses Ollama's 11434 when no scheme is given. Cleaning up a model's
  answer no longer strips `*` and `#` from USSD codes such as `*384*1#`.
- `scripts/eval-detector.mjs` no longer hangs on a detector that never
  answers: past the timeout it moves on, as Kalangu does.

## [0.1.0-alpha.6] - 2026-11-18

### Added

- `scripts/eval-detector.mjs`: measures a language detector on labelled
  samples the way Kalangu uses it: per-language accuracy, a confusion
  matrix, accuracy by length, false offers and catches at each threshold and
  `minChars`, latency against the timeout, and contract checks, with a
  suggested setting under a false-offer limit. `--ascii` folds the text as
  typed on a keypad. A guide on the website, and an English and French
  example to show the format.

### Fixed

- A deferred answer could undo changes saved while it was pending. When a
  slow answer went out by SMS, the session was saved with the whole of the
  handler's copy of the data and its language, so anything saved meanwhile
  (a payment outcome's data, a language switch) was lost, and a user who had
  moved on after the deferral expired lost their place. It now applies only
  what the handler changed after the deadline, with a version check, and
  keeps a newer turn's place.

## [0.1.0-alpha.5] - 2026-11-18

### Added

- Language detection now also reads the SMS that starts a conversation
  (languages design §5). A number with no language yet gets the language
  menu with the language its message looks like listed first; nothing is
  chosen for it. A number with a language is offered to continue in the one
  it wrote in, under the same rules as for typed answers: at most once per
  conversation, and never again after a No.
- The clinic example can answer with a local Ollama model:
  `OLLAMA_MODEL=llama3.2 pnpm demo` (and the same for the server), with
  `OLLAMA_HOST` for another machine. Answers are shortened to fit the SMS
  cap, formatting and reasoning blocks are stripped, and an apology is sent
  when Ollama is down. Without `OLLAMA_MODEL`, the fake nurse as before. The
  quick start shows the same call for your own agent.
- Website: a Providers page (models: Ollama, Claude, Gemini, any API in
  OpenAI's chat format, a model per language; gateways: Africa's Talking,
  several channels at once, writing a channel for another gateway). The
  header links to Agents and Providers, and Quick start opens a popup with
  one paste that builds and runs an agent from npm.

### Fixed

- Payments: a retried outcome delivery ran `onPaid` or `onFailed` again. When
  the outcome SMS failed to send, the handler had already run and saved, and
  the retry from `reconcile` ran it a second time. The handler's changes and
  a record of the applied outcome are now saved together, so a retry only
  resends the message.
- Payments: an outcome delivered while the user was in another turn could
  overwrite that turn, or be overwritten by it. The delivery now saves with
  a version check; on a conflict it applies the handler's session changes
  to the newer session without running the handler again, and keeps the
  user's place if they are answering a question (payments design §9).

## [0.1.0-alpha.4] - 2026-11-18

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
