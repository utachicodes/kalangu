# Releasing

Packages: `@kalangu/core`, `@kalangu/ussd`, `@kalangu/sms`, `@kalangu/sim`.
They share one version number and publish together. Publishing is done by
the maintainer; nothing here runs on its own.

## One-time setup

1. Claim the `@kalangu` scope on npm (create an organisation named
   `kalangu`, or publish under the maintainer's user scope if the name is
   taken). The packages are `publishConfig.access: public`.
2. Create an npm token with publish rights to the scope (a granular token,
   read and write for packages under `@kalangu`, with a short expiry) and
   add it to the repository as the `NPM_TOKEN` secret. **Put it only in
   GitHub's secret store**, typed or pasted there yourself or through
   `gh secret set NPM_TOKEN`. Never paste a token into a chat, an issue or a
   commit; if you do, revoke it at once on npmjs.com.
   An alternative with no long-lived token is npm's trusted publishing
   (GitHub OIDC): it needs npm 11.5.1 or later, is configured per package on
   npmjs.com, and the docs say a new configuration must complete a first
   publish within two days. Check npm's current documentation before
   switching.

## Each release

1. Bump `version` in all four `packages/*/package.json` (same number).
   Alpha releases look like `0.1.0-alpha.1` and publish under the `alpha`
   tag, so `npm install @kalangu/core` does not pick them up by accident.
2. Move the CHANGELOG's `[Unreleased]` entries under the new version and
   date.
3. Merge to `main` and wait for CI to pass.
4. Run the **Release** workflow from `main`. It defaults to a dry run
   (checks the packages without publishing); run it again with
   `dry_run` off to publish. Publishes carry npm provenance.
5. Tag the commit (`git tag v0.1.0-alpha.1 && git push --tags`).

## Checking a package locally

```sh
pnpm build
cd packages/core && pnpm pack --dry-run   # lists exactly what would ship
```

Each package ships `dist/`, `src/` (for source maps), its README and the
LICENSE. `workspace:*` dependencies are rewritten to the real version when
packing.

## Before the first publish

- Finish the trademark search in `TODO.md`; a published package name is hard
  to take back.
- Run the **Release** workflow once as a dry run and read what it lists.
- Read each package README as a stranger would: they are what npm shows.
  The core README says payments are experimental and fake-provider only;
  keep that true.
- Alpha packages install only with the tag: `npm install @kalangu/core@alpha`.

## Not yet done

- The npm scope is not claimed and nothing is published.
- Move to `1.0` only after the verify-first checklist in `TODO.md` is done
  on real operators.
