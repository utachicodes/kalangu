# Releasing

Packages: `@kalangu/core`, `@kalangu/ussd`, `@kalangu/sms`, `@kalangu/sim`.
They share one version number and publish together. Publishing is done by
the maintainer; nothing here runs on its own.

## One-time setup

1. Claim the `@kalangu` scope on npm (create an organisation named
   `kalangu`, or publish under the maintainer's user scope if the name is
   taken). The packages are `publishConfig.access: public`.
2. Create an npm token with publish rights to the scope (a granular token,
   read and write for packages under `@kalangu`, with a short expiry, **and
   with the option to bypass two-factor authentication turned on**) and
   add it to the repository as the `NPM_TOKEN` secret. A token without that
   option fails in CI: the first release attempt was refused with
   `403 Forbidden: Two-factor authentication or granular access token with
   bypass 2fa enabled is required to publish packages`. **Put it only in
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
   (typecheck, tests, build, and what would be published); run it again with
   `dry_run` off. A dry run does **not** prove the token or the organisation
   work: only a real run does. Publishes carry npm provenance.
5. **Approve the staged versions.** npm's staged publishing holds CI
   publishes until a maintainer approves them, so a successful run is not a
   release. The workflow log says "Published package" for each package, but
   the version is not installable yet. On npmjs.com open the **Staged
   Packages** tab, review the four versions and click **Approve** (you can
   approve a batch with one two-factor prompt). Or from a terminal:
   `npm stage list`, then `npm stage approve <stage-id>` for each (it
   prompts for two-factor; `npm stage reject <stage-id>` removes one). npm's
   docs do not say whether a staged version expires, so approve promptly.
6. **Check the registry** (read-only, no login needed):
   `npm view @kalangu/core versions dist-tags` for all four packages. The
   new version must be listed, the `alpha` tag must point at it, and the
   package page should show a provenance badge. Then install it in an empty
   folder with `npm install @kalangu/core@alpha` and import it.
7. Tag the commit (`git tag v0.1.0-alpha.1 && git push --tags`).

### The `0.0.0-stage` placeholder

When a package does not exist yet, npm publishes a **public** placeholder
version `0.0.0-stage` ("Temporary package placeholder for staged
publishing") and the real version stays private until approved. On the first
release of each package that placeholder was the `latest` tag, so until
`latest` is moved, `npm install @kalangu/core` without a tag installs an empty
placeholder. After approving, run `npm view @kalangu/core dist-tags` and
decide deliberately what `latest` should be (`npm dist-tag add
@kalangu/core@<version> latest` sets it). Only the first release of a new
package has this placeholder.

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

- As of 17 Nov 2026 the first release, `0.1.0-alpha.0` of all four packages,
  has been staged but not approved, so it is not yet installable. Update this
  line when it is live.
- Move to `1.0` only after the verify-first checklist in `TODO.md` is done
  on real operators.
