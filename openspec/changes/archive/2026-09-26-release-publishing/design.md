# Design

## Context

npm name: the package publishes as `om-memory-system` because npm's similarity rule rejects the unscoped name `omms` (too close to `ms`/`os`). The product, plugin id and folders stay `omms`.

See proposal.md for the motivation. Current state:

- `.github/workflows/release.yml` runs on a `v*` tag push. It calls `platform-smoke.yml` (six platforms: `bun run ci:local`, then `npm pack`, install into a scratch project, and native, libSQL-vector and package smoke scripts). It then typechecks, lints, format-checks and builds, checks that the tag equals the `package.json` version, and runs `npm publish --access public` with `NODE_AUTH_TOKEN: secrets.NPM_TOKEN` before creating a GitHub Release with `softprops/action-gh-release`.
- `.npmrc` hard-wires `//registry.npmjs.org/:_authToken=${NODE_AUTH_TOKEN}`.
- `docs/ci.md` documents a manual SemVer runbook. There are no git tags and no `CHANGELOG.md`, and `package.json` is at `3.0.0`.
- `npm view omms` returns 404, so the name is free and the package does not exist yet. The local npm CLI is not logged in.
- `bun run build` produces `dist/` (tsc) and `dist/web/` (vite). `files: ["dist"]` already ships both. `npm pack --dry-run` showed about 484 KB, 319 files, 102 of them `.map`, and 10 under `dist/web`. `scripts/smoke-test.mjs` checks the plugin exports only, not the web UI.
- Quality runs on pull requests and on pushes to `main`. `main` has required status checks.
- Facts checked against current docs: release-please-action v4 outputs `release_created`, `tag_name` and `version`. Resources it creates with the default `GITHUB_TOKEN` do not trigger other workflows, and it needs "Allow GitHub Actions to create and approve pull requests". npm trusted publishing needs npm ≥ 11.5.1 and Node ≥ 22.14; staged publishing needs npm ≥ 11.15.0, cannot stage a brand-new package, and holds a version until a maintainer approves it with 2FA (staged versions cannot be installed before approval). A trusted publisher can be set to stage-only, `permissions: id-token: write`, and the exact workflow filename registered on npmjs.com. It supports several trusted-publisher configurations per package and staged publishing (`npm stage publish`).

## Goals / Non-Goals

**Goals:**

- Publishing the maintainer can do by merging one pull request, with no npm credentials stored anywhere.
- No regression in the release gate: the six-platform smoke must still pass before anything is published.
- The web UI provably ships in every version.

**Non-Goals:**

- Changing plugin runtime behaviour or the OpenCode/Pi entry points (covered by `opencode-v2-native`).
- Installing from GitHub or running from unbuilt source.
- Rewriting the stale `macos-local-ci` spec (see Open Questions).

## Decisions

### D1. One `release.yml` driven by release-please, publishing in the same run

The workflow triggers on `push` to `main`. Job `release-please` runs `googleapis/release-please-action@v4` in manifest mode, with a `release-please-config.json` (`release-type: node`, `include-v-in-tag: true`, changelog sections for feat/fix/perf/deps/docs) and a `.release-please-manifest.json` seeded at `3.0.0`. Dependabot commits get a `deps:` (packages) or `ci:` (actions) prefix so release-please recognises them. When its `release_created` output is true, job `smoke` calls `./.github/workflows/platform-smoke.yml` with release-please's `sha` output as its `ref`, and job `publish` (`needs: smoke`) checks out that same `sha` to build and publish. The tagged commit can be older than the push that runs the workflow (for example when the release is created on a later push), so nothing is built from `github.sha`. `include-component-in-tag: false` keeps tags as `vX.Y.Z` to match the bootstrap `v3.0.0` tag.

_Alternative considered:_ keep the tag-triggered publish and let release-please only push tags. That is rejected because tags created with `GITHUB_TOKEN` do not trigger workflows (see Context), so the publish would silently never run. Publishing in the same run avoids that and removes the tag/version mismatch check, since release-please writes both.

### D2. release-please authenticates with a GitHub App token

**Decided: a GitHub App.** A small private App (for example `omms-release`) is owned by the maintainer's account, set to "Only on this account", installed only on `cmdaltctr/omms`, and uses the omms icon (`web/public/omms-icon.png`). It has repository permissions Contents: read and write and Pull requests: read and write, no webhook, and nothing else. It is maintainer tooling only: end users never install or interact with it, and it only shows up as the author of release pull requests. The workflow mints a token with `actions/create-github-app-token` from two repo secrets, `RELEASE_APP_ID` and `RELEASE_APP_PRIVATE_KEY`. Release pull requests opened with that token trigger Quality, so the required checks can pass and the PR can merge. _Alternative considered:_ a fine-grained PAT. It is simpler to set up, but tied to one person and it expires.

### D3. Trusted publishing, then lock the package

`publish` has `permissions: { id-token: write, contents: read }`, uses `actions/setup-node` with Node 24 and `registry-url`, upgrades npm to 11.15.0 or later, and runs `npm stage publish`. The version then waits in npm's Staged tab until the maintainer approves it with 2FA (on npmjs.com or with `npm stage approve`); only then can users install it. It has no `NODE_AUTH_TOKEN`, and the token line is removed from `.npmrc`. Provenance is attached automatically. The job runs in a GitHub environment named `npm-publish`, and the trusted publisher on npmjs.com is registered as repo `cmdaltctr/omms`, workflow `release.yml`, environment `npm-publish`, **stage-only**, so even a tampered release workflow cannot publish without the maintainer's approval. After the first CI publish succeeds, the maintainer switches the package to "Require two-factor authentication and disallow tokens" and deletes the `NPM_TOKEN` secret.

**Decided: staged publishing is on.** _Alternative considered:_ direct `npm publish` after the gate. It is one click less per release, but a compromised GitHub account or workflow could then ship to every user. Held versions cannot be installed from the registry, but the maintainer can fetch one with `npm stage download <stage-id>` and install the tarball locally before approving. Day-to-day pre-release testing still happens on the `next` channel (D7).

### D4. First publish is manual, from a clean build

npm cannot attach a trusted publisher to a package that does not exist yet. The maintainer runs a checklist once: `npm login` with 2FA, a clean checkout of the merged `main`, `bun install --frozen-lockfile` (root and `web/`), `bun run build`, `npm publish --access public`, then configures the trusted publisher. Version `3.0.0` stays as the first published version. Right after publishing, the maintainer tags that commit `v3.0.0` and creates its GitHub Release. The manifest is seeded at `3.0.0`, so release-please finds that release and computes the next version from later commits only. A `bootstrap-sha` is not used, because the merge commit is not known in advance.

### D5. Guard the package contents

- `scripts/verify-package.mjs` asserts that `dist/plugin.js`, `dist/v2/plugin.js`, `dist/adapters/pi/extension.js` and `dist/web/index.html` exist, and that at least one `dist/web/assets/*.js` exists. It runs as `prepublishOnly`, so a manual or CI publish without a web build fails before upload.
- `scripts/smoke-test.mjs` (run by platform smoke against the installed tarball) additionally asserts that `node_modules/omms/dist/web/index.html` exists and that starting the web server on a free port serves `/` with HTTP 200 and the `omms Memory Explorer` title, using a temporary HOME.
- `npx publint` and `npx @arethetypeswrong/cli --pack --profile esm-only` run in the Quality `check` job, so metadata regressions show up in pull requests.

### D6. Package metadata

Order `exports` conditions as `types`, then `import`, then `default`. Add `engines: { "node": ">=22.14" }` and `bun` where applicable. Set `declarationMap: false`, because the maps point at `src/`, which is not shipped. Set `author`, `homepage` and `bugs`. Drop the non-standard `"opencode"` manifest block if publint flags it. Keep `publishConfig.access: public`. None of this changes runtime resolution: the `./server` export used by OpenCode and the `pi.extensions` path used by Pi are unchanged.

### D7. `next` channel (decided: keep)

`.github/workflows/publish-next.yml` runs on `workflow_run` completion of Quality on `main` (success only). It is switched on by the repository variable `NPM_NEXT_ENABLED` (and the release-please job by `RELEASE_PLEASE_ENABLED`), so neither fails on `main` before the maintainer's one-time setup is done. It skips release commits (those that change `.release-please-manifest.json`), sets the version to `<next-minor>-next.<run_number>` with `npm version --no-git-tag-version`, runs build and `verify-package`, and publishes with `npm publish --tag next`. It runs in a separate GitHub environment, `npm-next`, restricted to the `main` branch, and is registered as a second trusted publisher (same repo, workflow `publish-next.yml`, environment `npm-next`) that publishes directly without approval, so each merge is immediately available as `om-memory-system@next`. It never touches `latest`, and a final step asserts that `npm view omms dist-tags.latest` is unchanged. Whether Pi reports updates for a dist-tag install (`npm:om-memory-system@next`) is unverified, and a task checks this before the channel is documented for users.

### D8. Docs

The README gets an "Install and update" section with commands for both hosts, unpinned by default, plus how to pin and how to apply updates (`pi update`, `opencode plugin update`, `opencode plugin check`). `docs/ci.md` replaces the manual runbook with the release-please flow, the one-time first-publish checklist, the trusted-publisher settings and the lockdown steps. `.github/release.yml`, which configures GitHub's generated notes, is removed, since release-please writes the release notes.

## Risks / Trade-offs

- [The workflow filename or environment registered on npm does not match exactly, so publish fails with `ENEEDAUTH`] → The first CI release is watched and the docs spell out the exact strings. The failure is safe: nothing publishes, and the job can be re-run after fixing the npm setting.
- [A release-please release commit fails platform smoke, leaving a tag and GitHub Release without an npm version] → `publish` only runs after `smoke`. Recovery is to fix forward, which produces a new patch release. The docs describe this, and the GitHub Release for the failed tag is marked as not published to npm.
- [The GitHub App or PAT is misconfigured, so release PRs do not get CI checks] → A validation task opens the first release PR and confirms that Quality runs on it.
- [npm version on the runner is older than 11.5.1] → `npm install -g npm@^11.5.1` runs before publishing.
- [Web UI build silently empty] → the `verify-package` asset check and the smoke-test HTTP 200 plus title check.
- [`next` builds confuse users] → it is never the default tag, and the README keeps it in a separate "testing builds" note.
- [The `next` trusted publisher can publish without approval, so a tampered `publish-next.yml` on `main` could in principle publish under any tag, including `latest`] → the `npm-next` environment only accepts `main`, and changes to `.github/workflows/` need a reviewed pull request (branch protection; add CODEOWNERS for `.github/`). The workflow's own `latest`-unchanged assertion plus npm's publish notifications make any misuse visible. The stage-only release publisher stays the only path to a normal release.
- [A release is forgotten in the Staged tab] → the release workflow's last step posts the staged version and the approval link in the GitHub Release body, and the docs list approval as the final release step.

## Migration Plan

1. Merge PR #9, then this change, into `main`. From then on release-please opens a release PR, but the maintainer does not merge it until step 3 is done.
2. Do the one-time manual `npm publish` of `3.0.0` (D4).
3. Configure the trusted publisher(s) and the `npm-publish` environment.
4. Merge the next release PR, approve the staged version on npmjs.com, confirm it is live with provenance, then lock the package (D3) and delete `NPM_TOKEN`.

Rollback: revert `release.yml` to the tag-triggered token flow and re-add `NPM_TOKEN`. Versions already published stay valid, and `npm deprecate` covers a bad version.

## Open Questions

- The `macos-local-ci` spec says platform workflows run only by manual dispatch on `macos-15`, but `platform-smoke.yml` also runs weekly and before every release on six platforms. That spec should be reconciled in a separate docs change. It does not affect this design.
