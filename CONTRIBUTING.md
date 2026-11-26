# Contributing

Kalangu's packages are published on npm as alpha releases (see
[RELEASING.md](RELEASING.md) for how a release is made). Reviewing
[docs/design.md](docs/design.md) is still the most useful contribution;
code contributions are welcome too.

## Reviewing the design

1. Read [docs/design.md](docs/design.md) end to end. It is deliberately
   honest about what was verified against official documentation (§2) and
   what still rests on secondary sources (§2.5).
2. Answer or challenge the open questions in §12: they decide defaults.
3. If you run USSD services in production, say so; operator-specific reality
   (timeouts, screen limits, auto-pagination behaviour) beats published
   figures.
4. Open an issue, or comment inline on the document. Arguments for a better
   design are always welcome: the brief for this project explicitly asks
   for that over workarounds.

## Working on the docs

The documentation on the website (`/docs/` and `/contributing/`) is generated
from the markdown in this repository: `docs/*.md`, `CONTRIBUTING.md`,
`RELEASING.md`, `TODO.md` and `CHANGELOG.md`. Edit the markdown, never the
generated HTML under `site/`, then run `pnpm site:build` and commit both. CI
runs `pnpm site:check`, which fails if the pages are out of date or if a link
points to a page or heading that does not exist. The list of pages and the
sidebar are in `scripts/build-site.mjs`.

The quick start is also run: `scripts/docs-snippets.test.mjs` writes out
every block introduced by "Create `<file>`", runs the one after "Run it with
`node <file>`", and fails if the output differs from the block the page
shows. If you change the quick start's code or its output, keep them in
step.

## Setting up

Windows, macOS and Linux work the same way. You need **Git** and **Node 22.13
or later** (the packages run on Node 20; the Ndiédieng example needs 22.13).

1. **Install Node and Git** if you don't have them. On Windows, in
   PowerShell: `winget install OpenJS.NodeJS.LTS` and `winget install Git.Git`,
   then open a new terminal. Elsewhere: <https://nodejs.org> and
   <https://git-scm.com>.
2. **Clone and set up:**

   ```sh
   git clone https://github.com/utachicodes/kalangu.git
   cd kalangu
   node scripts/setup.mjs
   ```

   The script checks Node, installs every package with the pnpm version the
   repository pins (through `npx` if pnpm isn't installed, and it tells you
   how to install it for good: `npm install -g pnpm@12.6.0`), and builds. Run
   it again any time: when nothing changed it says so at once.
3. **In VS Code,** open the `kalangu` folder:
   - Accept the **recommended extensions** (EditorConfig, Vitest) when asked.
   - The first time, VS Code asks whether to allow the folder's automatic
     task: choose **Allow and run**. From then on, **Kalangu: set up** runs
     each time the folder opens, so a `git pull` that changed the packages
     is installed for you.
   - **Terminal → Run Task** lists the others: *Kalangu: demo*, *test*,
     *typecheck*, and the *Ndiédieng example*.
   - Generated files (the website under `site/`, the Wolof review sheet)
     open read-only: change their source and rebuild instead.

Line endings are LF on every platform (`.gitattributes`): several checks
compare generated files byte for byte, so don't change Git's settings to
check files out with CRLF.

## Working on the code

- `pnpm test`, `pnpm typecheck` and `pnpm build` at the root (or the VS Code
  tasks). `pnpm demo` runs the example on the simulator.
- Build order and test priorities are in `docs/design.md` §10 and §13.
  `@kalangu/core` must keep **zero runtime dependencies** and must never
  import a model SDK or a gateway SDK.
- Adapters are built on standard `Request`/`Response` so they work across
  runtimes; don't tie them to one framework.
- Tests: the budgeter and the engine's deadline behaviour (fake clock) are
  the two suites that matter most.
- TypeScript strict mode is not negotiable; `noUncheckedIndexedAccess` is on
  for a reason: keypad users' safety depends on never emitting a screen a
  channel would truncate.

## Contributing a translation

Translating Kalangu's fixed strings needs no code: see the
[translation guide](docs/translating.md), which covers the checker, what USSD
and SMS do to each language's letters, review by native speakers, and starting
from a machine draft.

## House rules

- **Security problems are reported privately,** never in a public issue:
  see [SECURITY.md](SECURITY.md).
- **Never commit secrets** (API keys, phone numbers of real users).
  Phone numbers are personal data; mask them in logs, tests, and fixtures.
- Fixed strings that face users go through locale files (`en`, `fr` ship
  first): never hardcode user-facing English.
- Don't publish packages to npm or create remote repositories from PRs;
  release is maintained by the maintainer.
- No payment code until the 0.2 design is reviewed; money code should not be
  rushed.
