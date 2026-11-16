# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

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
