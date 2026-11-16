# Contributing

Kalangu's v0.1 packages are in this repository but nothing is published
yet. Reviewing [docs/design.md](docs/design.md) is still the most useful
contribution; code contributions are welcome too.

## Reviewing the design

1. Read [docs/design.md](docs/design.md) end to end. It is deliberately
   honest about what was verified against official documentation (§2) and
   what still rests on secondary sources (§2.5).
2. Answer or challenge the open questions in §12 — they decide defaults.
3. If you run USSD services in production, say so; operator-specific reality
   (timeouts, screen limits, auto-pagination behaviour) beats published
   figures.
4. Open an issue, or comment inline on the document. Arguments for a better
   design are always welcome — the brief for this project explicitly asks
   for that over workarounds.

## Working on the code

- `pnpm install`, then `pnpm test`, `pnpm typecheck` and `pnpm build` at the
  root. `pnpm demo` runs the example on the simulator.
- Build order and test priorities are in `docs/design.md` §10 and §13.
  `@kalangu/core` must keep **zero runtime dependencies** and must never
  import a model SDK or a gateway SDK.
- Adapters are built on standard `Request`/`Response` so they work across
  runtimes; don't tie them to one framework.
- Tests: the budgeter and the engine's deadline behaviour (fake clock) are
  the two suites that matter most.
- TypeScript strict mode is not negotiable; `noUncheckedIndexedAccess` is on
  for a reason — keypad users' safety depends on never emitting a screen a
  channel would truncate.

## House rules

- **Never commit secrets** (API keys, phone numbers of real users).
  Phone numbers are personal data; mask them in logs, tests, and fixtures.
- Fixed strings that face users go through locale files (`en`, `fr` ship
  first) — never hardcode user-facing English.
- Don't publish packages to npm or create remote repositories from PRs;
  release is maintained by the maintainer.
- No payment code until the 0.2 design is reviewed; money code should not be
  rushed.
