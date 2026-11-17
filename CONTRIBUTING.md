# Contributing

Kalangu's packages are published on npm as alpha releases (see
[RELEASING.md](RELEASING.md) for how a release is made). Reviewing
[docs/design.md](docs/design.md) is still the most useful contribution;
code contributions are welcome too.

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

## Contributing a translation

Fixed strings (the "Yes", "Invalid choice", payment messages and so on) can be
translated by anyone who speaks the language, with no code. See
[docs/languages-design.md](docs/languages-design.md) §8 and §9 for the why.

1. Copy the English messages from `packages/core/src/locales.ts` (the `en`
   object) into a JSON file named for the language, e.g. `wo.json`, and
   translate the values. Keep the keys exactly. You may translate only some:
   anything missing falls back to the default language.
2. Keep every `{placeholder}` exactly as written: the program fills it in
   (`{amount}`, `{yes}`). You can move it within the sentence.
3. Run the checker from the repository root:

   ```
   pnpm build
   node packages/core/dist/cli.js locale check wo.json --verbose
   ```

   It reports lost or invented placeholders (errors), strings that will take
   more than one USSD screen or SMS segment, and the letters USSD shows
   differently. `--complete` makes a missing message an error, and `--strict`
   makes warnings fail.
4. **Mind the channels.** USSD shows plain ASCII, so Wolof `ë`, `ŋ` and `ó`
   and Hausa `ɓ`, `ɗ` and `ƙ` appear as `e`, `ng`, `o` and `b`, `d`, `k`. If
   that makes a word ambiguous, choose a wording that survives it. On SMS one
   such letter makes the whole message UCS-2, 70 characters per segment
   instead of 160. The checker lists both, so you can judge.
5. Open a pull request. A translation is marked **reviewed** only when a
   speaker of that language other than the author has checked it, and the file
   says who; until then it ships as **experimental**.

Agent content (menu titles, answers) is the developer's own and lives in the
agent definition as `{ en: "...", wo: "..." }`, not in these files.

## House rules

- **Never commit secrets** (API keys, phone numbers of real users).
  Phone numbers are personal data; mask them in logs, tests, and fixtures.
- Fixed strings that face users go through locale files (`en`, `fr` ship
  first) — never hardcode user-facing English.
- Don't publish packages to npm or create remote repositories from PRs;
  release is maintained by the maintainer.
- No payment code until the 0.2 design is reviewed; money code should not be
  rushed.
