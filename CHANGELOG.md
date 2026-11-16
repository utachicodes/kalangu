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
