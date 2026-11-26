# AGENTS.md

Instructions for AI coding agents working in this repository. People
contributing by hand follow the same rules; [CONTRIBUTING.md](CONTRIBUTING.md)
is their guide.

Kalangu is an open-source TypeScript toolkit for building AI agents that work
on any phone over USSD and SMS. Four packages are published on npm
(`@kalangu/core`, `@kalangu/ussd`, `@kalangu/sms`, `@kalangu/sim`), with two
examples (`examples/clinic`, `examples/ndiedieng`) and a website (`site/`).

## Rules that are never broken

1. **Never push to `main`.** Every change goes on a branch and reaches `main`
   through a pull request. A `pre-push` hook refuses pushes to `main`.
2. **Nothing is pushed without a CHANGELOG.md entry.** Every branch adds or
   changes an entry under `## [Unreleased]` in [CHANGELOG.md](CHANGELOG.md),
   in the section that fits (`Added`, `Changed`, `Fixed`, `Removed`). The
   `pre-push` hook refuses a branch whose changes do not touch CHANGELOG.md,
   and CI fails a pull request that does not.
3. **Never bypass a check.** No `git push --no-verify`, no `--force` to a
   shared branch, no disabling a test or a CI step to get green.
4. **No AI attribution anywhere:** no "Co-Authored-By" or "Generated with"
   lines in commits or pull requests, and no mention of an AI tool in code or
   docs.
5. **Merge only when the maintainer asks.** Opening a pull request is not
   permission to merge it.

Turn the hook on once per clone:

```sh
git config core.hooksPath .githooks
```

## Branches, commits and pull requests

- Branch from the latest `main`, named by area: `core/`, `example/`, `docs/`,
  `locales/`, `site/`, `fix/`, `chore/`, `release/` (for example
  `docs/languages-design-review`).
- One topic per branch and per pull request.
- Commit messages: a short subject that says what changed, then a body that
  says why, wrapped at 72 characters.
- Pull requests follow [the template](.github/pull_request_template.md):
  what and why, how it was tested, and the checklist, filled in honestly.
- Pull requests are merged with a merge commit, never squashed or rebased.

## Setting up and checking your work

Node 22.13 or later (the packages run on 20; the Ndiédieng example needs
22.13). Then, on Windows, macOS or Linux:

```sh
node scripts/setup.mjs
```

It installs every package with the pnpm version pinned in `package.json`
(through `npx` if pnpm is missing) and builds; run it again after a pull that
changed the packages. VS Code runs it when the folder opens (the "Kalangu: set
up" task), and offers tasks for the demo, tests and typecheck.

Before pushing, run what CI runs:

| Command | Checks |
|---|---|
| `pnpm typecheck` | Types in every package and example |
| `pnpm test` | Every package's tests |
| `pnpm test:scripts` | The repository scripts' tests, including the docs' code snippets |
| `pnpm site:check` | The website's docs pages match the markdown, and every link resolves |
| `pnpm --filter @kalangu/example-ndiedieng check:web` | The published Ndiédieng demo matches its source |
| `pnpm pack:check` | The packed packages install and run in an empty project |
| `node packages/core/dist/cli.js locale check <file> --complete` | A file in `locales/` keeps its placeholders and fits USSD and SMS |

## Generated files: change the source, then regenerate

These files are built from other files. Never edit them by hand; change the
source, run the script, and commit both.

| Generated | Source | Script |
|---|---|---|
| `site/docs/**`, `site/contributing/`, `site/security/`, `site/sitemap.xml` | `docs/*.md`, `CONTRIBUTING.md`, `RELEASING.md`, `TODO.md`, `CHANGELOG.md`, `SECURITY.md` | `pnpm site:build` |
| `site/ndiedieng/**`, `site/api/ndiedieng/**` | `examples/ndiedieng/src`, `examples/ndiedieng/web`, and the built packages | `pnpm build`, then `pnpm --filter @kalangu/example-ndiedieng build:web` |
| `examples/ndiedieng/wolof-review.csv` | `examples/ndiedieng/src/strings.ts` | `pnpm --filter @kalangu/example-ndiedieng build`, then `wolof:sheet` |

A change to `packages/core` changes the demo's bundled copy under
`site/ndiedieng/vendor/`: rebuild it, or `check:web` fails. A change to
CHANGELOG.md or TODO.md changes their website pages: run `pnpm site:build`.
A new docs page needs an entry in the page list in `scripts/build-site.mjs`.

## Design rules

- **The design documents come first.** [docs/design.md](docs/design.md),
  [payments](docs/payments-design.md), [languages](docs/languages-design.md),
  [WhatsApp](docs/whatsapp-design.md) and
  [text normalization](docs/normalization-design.md) say what is built,
  what is decided, and what is still open. A new feature that changes how
  Kalangu behaves gets a design note in `docs/` first, reviewed by the
  maintainer before any code. When code and a design document disagree, fix
  the document in the same pull request.
- **Verify first.** A fact about a gateway, an operator, a provider or a
  model comes from its official documentation or a test, with the source and
  date written down. What is unverified is marked so (see the verify-first
  checklist in [TODO.md](TODO.md)).
- **`@kalangu/core` has zero runtime dependencies** and never imports a
  model SDK or a gateway SDK.
- **Adapters are built on standard `Request` and `Response`,** never tied to
  one framework or runtime.
- **TypeScript strict mode, with `noUncheckedIndexedAccess`.** A screen that
  a channel would cut off must be impossible, not unlikely.
- **Works on Windows.** Contributors use Windows: build and test scripts use
  Node's `path` functions, compare paths with forward slashes, run tools
  through `process.execPath` rather than `node_modules/.bin`, and keep LF line
  endings (`.gitattributes`). CI runs the setup and the tests on Windows.
- **Never cut text silently.** Every USSD screen and SMS goes through the
  budgeter; text that does not fit is paginated or refused, never truncated.
- **Payments are experimental.** Nothing touches a real payment provider
  until its sandbox has been worked through ([payments design](docs/payments-design.md)).
- **No language is guessed.** Detection is a hint; the user's own choice
  sets the language ([languages design](docs/languages-design.md)).
- **Tests come with the change.** A bug fix includes a test that fails
  without it. The budgeter and the engine's deadline behaviour are the suites
  that matter most.

## Translations

- Machine-drafted translations are drafts: they go in `locales/*.draft.json`
  (or an example's strings file), marked not reviewed, and never ship until a
  speaker other than the author has reviewed them.
- Keep every `{placeholder}` exactly. Run the locale check on every change.
- The maintainer speaks Wolof and reviews Wolof drafts. Hausa, Swahili and
  Bambara wait for native speakers; their review issues are labelled
  `translation`.

## Writing style

For code comments, docs, commit messages, pull requests and user-facing text:

- Plain, short sentences that say the point first. Specific numbers, names
  and dates rather than adjectives.
- **No em dashes and no emojis.** Use a colon, a comma, parentheses or a new
  sentence instead of a dash.
- Say what was verified and what was not. Never claim a test passed, a
  release was published or a page was checked without having seen it.
- Users of the examples are named neutrally (they/them) unless a name and
  pronouns are given.

## The website

- One button or link per action on a page, placed where a visitor expects
  it. Never the same action twice on one page.
- Pages are static files under `site/`; the docs pages are generated (see
  above). The landing page and the components page are written by hand.

## Keeping track

- [TODO.md](TODO.md) lists what is done and what is next. Tick an item
  (`- [x]`) in the same pull request that finishes it, and add new open work
  as it appears.
- Releases follow [RELEASING.md](RELEASING.md) step by step. Publishing,
  approving staged versions on npm and tagging are done only when the
  maintainer asks.
- Secrets (API keys, tokens) never go in the repository, a commit, an issue
  or a pull request.
