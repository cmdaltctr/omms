# Continuous Integration

OMMS validates changes locally on macOS first. GitHub Actions then runs
quality and test checks on every pull request, a native embedding matrix on
pull requests that touch native paths, and a full platform matrix before each
release. The repository is public, so hosted runners cost nothing. The only
limit is job concurrency: 20 jobs in total, 5 of them macOS.

## Where each check runs

| Check                                  | Where                             | Trigger                                 |
| -------------------------------------- | --------------------------------- | --------------------------------------- |
| Format, lint, typecheck                | Local, before every push          | pre-push hook (`bun run check`)         |
| Build, unit tests                      | Local, full gate                  | `bun run ci:local`                      |
| Format, lint, typecheck, package shape | GitHub, `ubuntu-latest`           | Quality workflow, every PR and `main`   |
| Build, unit tests                      | GitHub, `macos-latest`            | Quality workflow, every PR and `main`   |
| Native embedding smoke (4 platforms)   | GitHub, PRs touching native paths | Embedding Backend workflow, or manual   |
| Nested OpenCode fixture, Intel (#225)  | GitHub, PRs touching native paths | Embedding Backend workflow, or manual   |
| Full gate and pack smoke (6 platforms) | GitHub                            | Before release, weekly (Monday), manual |
| Release PR, tag, stage on npm          | GitHub, `ubuntu-latest`           | Release workflow, push to `main`        |
| `next` prerelease on npm               | GitHub, `ubuntu-latest`           | Publish next, after Quality on `main`   |

## Local toolchain

Install:

```bash
bun install --frozen-lockfile
(cd web && bun install --frozen-lockfile)
```

You need Bun and Node 24. Node ships with npm, which the package smoke tests
use. The default embedding model downloads once from Hugging Face and is
cached afterwards.

## Local commands

| Command                 | What it does                                                                                                       |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `bun run check`         | Format check, lint, typecheck. Fast and deterministic.                                                             |
| `bun run ci:local`      | `bun run check`, then build, then the full test suite.                                                             |
| `bun run build`         | Clean build of `dist/` and the web UI.                                                                             |
| `bun run check:package` | Published-package shape: entry points and web UI present (`verify:package`), `publint`, and `attw`. Needs a build. |
| `bun run test`          | Whole suite in one Bun process. Not reliable for gating.                                                           |

`ci:local` runs tests through `scripts/run-tests-isolated.sh`. That script
starts one Bun process per test file. The suite shares module and storage
state across files, so a single-process run fails non-deterministically
depending on file order. One process per file is deterministic.

## Git hooks

Husky installs two hooks:

- **pre-commit**: `bun run typecheck && bunx lint-staged`.
- **pre-push**: `bun run check`. Fast and deterministic, about 11 seconds.

The full suite is deliberately outside the pre-push hook. Run
`bun run ci:local` before merging.

## Known test caveats

- `tests/plugin-bundle-boundary.test.ts` bundles `dist/` entries through the
  `bun build` CLI in a child process. Bun 1.3.14 resolves in-process
  `Bun.build` imports against the test file's directory when the file lives
  under `tests/`, which breaks every relative import in `dist/index.js`. The
  comment in the test file records this. Revisit after a Bun upgrade.
- Tests depend on a built `dist/`. `ci:local` builds before testing. If you run
  a single test file without building first, build first:
  `bun run build && bun test tests/<file>.test.ts`.

## GitHub workflows

### Quality (automatic)

Runs on every pull request and on every push to `main`. Three jobs:

- `changes` on `ubuntu-latest`: lists the files the pull request changes.
- `check` on `ubuntu-latest`: format, lint, typecheck, then build and
  `bun run check:package` (entry points and web UI present, `publint`,
  `attw`). Always runs, because Prettier also checks Markdown.
- `test` on `macos-latest`: build, then the full suite through
  `scripts/run-tests-isolated.sh`. Skipped when a pull request changes only
  Markdown files or files under `docs/`.

A skipped `test` job still satisfies the required status check, so docs-only
pull requests can merge. Do not add `paths-ignore` to this workflow: if it does
not start, the required checks never report and the pull request stays
blocked. If the `changes` job fails, `test` runs anyway.

Quality is the baseline gate for every pull request, including those that
skip the local hooks, such as Dependabot updates. Pull requests that touch
native paths also run Embedding Backend Verification.

### Embedding Backend Verification (automatic on native changes, manual on demand)

Runs when a pull request touches `package.json`, `bun.lock`, `bunfig.toml`,
`.npmrc`, `src/services/embedding.ts`, `src/services/onnxruntime-resolve.ts`,
`scripts/verify-embedding-backend.mjs`,
`scripts/verify-nested-onnxruntime-fixture.mjs`,
`scripts/fixtures/compiled-host-entry.mjs`, or this workflow file. It can
also be dispatched at any time.

onnxruntime-node and sharp ship a separate native binary for each platform, so
the `verify` job runs on `macos-15`, `macos-15-intel`, `windows-latest`, and
`ubuntu-latest`. `macos-15` is the supported floor; the Quality `test` job
already covers the newest macOS. Each job installs without lifecycle scripts and produces
real embeddings under Bun and Node 24.

The `nested-intel-regression` job reproduces the OpenCode nested install on
Intel macOS with Bun 1.3.14 and Node 22. The compiled host must run inference
and exit 0 without a SIGILL (#210, #225).

Dispatch it manually for any other native or toolchain change:

```bash
gh workflow run "Embedding Backend Verification" --ref main
```

### Platform Package Smoke (release, weekly, manual)

Runs on `macos-15`, `macos-26`, `macos-15-intel`, `macos-26-intel`,
`windows-latest`, and `ubuntu-latest`. Each job installs dependencies, runs
the full local gate, packs the npm tarball, installs it into a scratch
project, and runs the native dependency, libSQL vector, and package smoke
scripts.

It runs:

- Before every release. The Release workflow calls it and waits for it.
- Every Monday at 06:00 UTC, to catch runner image and upstream drift.
- On demand, after any packaging change:

```bash
gh workflow run "Platform Package Smoke" --ref main
```

It stays off pull requests so its four macOS jobs do not queue behind the
5-job macOS limit.

### Release (push to `main`)

Runs on every push to `main` once the repository variable
`RELEASE_PLEASE_ENABLED` is `true`. Three jobs:

- `release-please` keeps one release pull request open. It collects the
  conventional commits since the last release, proposes the next SemVer
  version, and updates `CHANGELOG.md`. It signs in as the private
  `omms-release` GitHub App, so its pull requests run the Quality checks.
  Merging that pull request tags `vX.Y.Z` and creates the GitHub Release.
- `smoke` runs only for a release: it calls Platform Package Smoke on the
  release commit.
- `publish` runs only after `smoke` passes. It builds, verifies the package
  contents, checks the version, and runs `npm stage publish` with no token
  (npm trusted publishing). npm holds the version until the maintainer
  approves it, and the job adds the approval steps to the GitHub Release.

Publishing happens in this run, not on a tag-push workflow, because tags
created by release-please do not start other workflows.

### Publish next (after Quality on `main`)

Runs when Quality succeeds for a push to `main`, once the repository variable
`NPM_NEXT_ENABLED` is `true`. It builds that commit and publishes it as
`X.(Y+1).0-next.<run>` under the npm `next` tag, without approval, so the
maintainer can try it with `om-memory-system@next`. It skips release commits (those that
change `.release-please-manifest.json`) and fails if `latest` moves.

## Release runbook

Versions come from commit messages. Use `feat:` (minor), `fix:` (patch),
`deps:` (patch, used by Dependabot), and `!` or `BREAKING CHANGE:` (major).
`refactor:`, `test:`, `ci:` and `chore:` do not trigger a release.

1. Merge work into `main` as usual. Each merge also appears as `om-memory-system@next`.
2. When you want to ship, merge the open release pull request.
3. Wait for the Release workflow: six-platform smoke, then `publish`.
4. Approve the staged version with 2FA, in the Staged tab at
   <https://www.npmjs.com/package/om-memory-system> or with `npm stage list om-memory-system`, then
   `npm stage approve <stage-id>`. To try it first, run
   `npm stage download <stage-id>` and install the tarball.
5. Users on an unpinned install are told about the update.

If the smoke gate fails, nothing is staged, but the tag and GitHub Release
already exist. Fix forward with a `fix:` commit, and release-please proposes
the next patch. Edit the failed GitHub Release to say it was not published to
npm. To reject a staged version instead of approving it, run
`npm stage reject <stage-id>`.

## First publish (one time)

The npm package is `om-memory-system`: npm rejects the plain name `omms` as too similar
to `ms` and `os`. The product, plugin id, config folder and data folder are
still `omms`.

npm only allows a trusted publisher on a package that already exists, so the
first version is published by hand. Do these steps in order after merging the
release-publishing change.

1. GitHub settings:
   - Settings, Actions, General: allow GitHub Actions to create and approve
     pull requests.
   - Create the private `omms-release` GitHub App: omms icon
     (`web/public/omms-icon.png`), no webhook, repository permissions
     Contents and Pull requests set to read and write, "Only on this
     account". Install it on `cmdaltctr/omms` only, generate a private key,
     and save `RELEASE_APP_ID` and `RELEASE_APP_PRIVATE_KEY` as repository
     secrets.
   - Create environments `npm-publish` and `npm-next`. Limit `npm-next`
     deployment branches to `main`.
   - Add CODEOWNERS for `.github/` and require review on `main`.
2. Publish `3.0.0` from a clean checkout of `main`:

   ```bash
   npm login            # with 2FA
   bun install --frozen-lockfile && (cd web && bun install --frozen-lockfile)
   bun run build
   npm publish --access public
   ```

3. Tag that commit and create its GitHub Release, so release-please counts
   later commits from it:

   ```bash
   git tag v3.0.0 && git push origin v3.0.0
   gh release create v3.0.0 --title v3.0.0 --notes-file CHANGELOG.md
   ```

4. Add the two npm trusted publishers (npm 11.15.0 or later; each asks for
   2FA). Names are case-sensitive and must match exactly:

   ```bash
   npm trust github om-memory-system --file release.yml --repo cmdaltctr/omms --env npm-publish --allow-stage-publish
   npm trust github om-memory-system --file publish-next.yml --repo cmdaltctr/omms --env npm-next --allow-publish
   npm trust list om-memory-system
   ```

   The first is **stage-only**, so releases wait for approval. The same
   settings are under npmjs.com → om-memory-system → Settings → Trusted publishing.

5. Set the repository variables `RELEASE_PLEASE_ENABLED=true` and
   `NPM_NEXT_ENABLED=true`.
6. After the first CI release is approved and live with a provenance badge,
   lock the package: npm package settings, Publishing access, "Require
   two-factor authentication and disallow tokens". Delete the `NPM_TOKEN`
   repository secret.

If `publish` fails with `ENEEDAUTH`, the workflow file name, environment, or
repository on npmjs.com does not match exactly. Nothing is published; fix the
setting and re-run the job.

## Platform scope

Supported platforms: macOS 15 and above on Apple Silicon and Intel, Windows,
and Linux. OpenCode users install the plugin on all of them.

Pull requests get the cheapest useful coverage: one Linux quality job and one
macOS test job. The native matrix runs only when native paths change. The full
six-platform matrix runs before release and weekly.

The `onnxruntime-node@1.20.1` pin stays in place: newer releases can SIGILL on
macOS process exit (#225), and OpenCode's nested installs ignore package
overrides (#184).

Costs: the repository is public, so hosted runners are free, macOS included.

| Event                    | Ubuntu | Windows | macOS |
| ------------------------ | ------ | ------- | ----- |
| Routine pull request     | 2      | 0       | 1     |
| Docs-only pull request   | 2      | 0       | 0     |
| Native-path pull request | 3      | 1       | 4     |
| Push to `main`           | 4      | 0       | 1     |
| Release or weekly smoke  | 2      | 1       | 4     |

The practical limit is the 5-job macOS queue. Local CI spends no GitHub jobs.
