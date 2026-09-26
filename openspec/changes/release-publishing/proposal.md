# Proposal

## Why

omms has never been published, so nobody can install it the way Pi and OpenCode v2 expect (`pi install npm:om-memory-system`, `opencode plugin add om-memory-system`). The existing release workflow also depends on a long-lived `NPM_TOKEN` secret and a hand-edited version number. That is the setup behind 2026's npm token-theft incidents, and it makes releasing slow enough that users rarely get updates. Both hosts already notify users about new versions of unpinned npm packages, so a reliable release pipeline is what turns that into real update delivery, including the web UI that sets omms apart.

## What Changes

- **First publish** of `omms` to npm, done once by the maintainer. npm only allows a trusted publisher to be configured on a package that already exists.
- **Tokenless CI publishing** with npm trusted publishing (GitHub OIDC). Provenance is attached automatically. The `NPM_TOKEN` secret and the `.npmrc` token line are removed, and the package is set to "require 2FA and disallow tokens", so only the release workflows can publish.
- **Maintainer approval before users get a release (staged publishing).** Full releases are uploaded with `npm stage publish` and held by npm until the maintainer approves them with 2FA on npmjs.com or with `npm stage approve`. The release workflow's trusted publisher is stage-only, so it cannot publish directly.
- **Automatic versioning** with release-please. Conventional commits on `main` keep one release pull request up to date with the next SemVer version and a `CHANGELOG.md`. Merging it tags the release and creates the GitHub Release. The same workflow run then passes the six-platform package smoke gate and publishes. **BREAKING (maintainer workflow):** the manual "edit version, push `v*` tag" runbook is retired.
- **Web UI is guaranteed in every release.** A pre-publish check refuses to publish without the built plugin and web UI, and the package smoke test asserts the installed tarball contains the web UI and serves it.
- **Package metadata cleanup** for publishing: `engines`, `exports` conditions ordered types-first with a `default`, no source maps pointing at unshipped `src/`, correct `repository`, `homepage`, `bugs` and `author`.
- **`next` channel:** every push to `main` that passes checks publishes a prerelease under the npm `next` dist-tag, without approval, so the maintainer can try each merge before a full release. The default `latest` tag is never moved by this channel.
- **Docs:** README install and update instructions for Pi and OpenCode v2 (install unpinned; run `pi update` / `opencode plugin update` when notified), and `docs/ci.md` replaces the manual runbook with the release-please flow and the first-publish steps.

## Capabilities

### New Capabilities

- `release-publishing`: how omms versions are cut and published to npm, including who can publish, what every published version must contain, the release gate, channels, and user-facing install and update guidance.

### Modified Capabilities

<!-- None. The existing macos-local-ci spec is stale relative to the current workflows (see design.md, Open Questions) but this change does not alter its requirements. -->

## Impact

- CI: `.github/workflows/release.yml` (rewritten around release-please and OIDC), a new `.github/workflows/publish-next.yml` (optional channel), `release-please-config.json`, `.release-please-manifest.json`, and `.github/release.yml` (superseded by release-please notes).
- Package: `package.json` (metadata, `exports`, `engines`, `prepublishOnly` guard), `tsconfig.json` (`declarationMap`), `.npmrc` (token line removed), `scripts/smoke-test.mjs` (web UI assertions), a new `scripts/verify-package.mjs`, and a new `CHANGELOG.md` (managed by release-please).
- Docs: `README.md` and `docs/ci.md`.
- External settings, done by the maintainer: the npm account (first publish, trusted publisher, token lockdown), and in GitHub the removed `NPM_TOKEN` secret, an optional `npm-publish` environment, and release-please permission to open pull requests.
- Depends on PR #9 (`feat/opencode-v2-native`), which this branch is based on.
