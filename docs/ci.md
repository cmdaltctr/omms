# Continuous Integration

OMMS checks changes locally on macOS first. GitHub Actions then runs:

- quality and test checks on every pull request
- a native embedding matrix on pull requests that touch native paths
- a full platform matrix before each release

The repository is public, so hosted runners are free. The only limit is job
concurrency: 20 jobs in total, 5 of them macOS.

## Where each check runs

| Check                                  | Where                             | Trigger                                 |
| -------------------------------------- | --------------------------------- | --------------------------------------- |
| Format, lint, typecheck                | Local, before every push          | pre-push hook (`bun run check`)         |
| Build, unit tests                      | Local, full gate                  | `bun run ci:local`                      |
| Format, lint, typecheck, package shape | GitHub, `ubuntu-latest`           | Quality workflow, every PR and `main`   |
| Build, unit tests                      | GitHub, `macos-latest`            | Quality workflow, every PR and `main`   |
| Build, unit tests                      | GitHub, `windows-latest`          | Quality workflow, PR and `main`         |
| Native embedding smoke (4 platforms)   | GitHub, PRs touching native paths | Embedding Backend workflow, or manual   |
| Nested OpenCode fixture, Intel (#225)  | GitHub, PRs touching native paths | Embedding Backend workflow, or manual   |
| Full gate and pack smoke (6 platforms) | GitHub                            | Before release, weekly (Monday), manual |
| Release PR, tag, stage on npm          | GitHub, `ubuntu-latest`           | Release workflow, push to `main`        |
| `next` prerelease on npm               | GitHub, `ubuntu-latest`           | Publish next, after Quality on `main`   |
| Claude plugin `stable` channel         | GitHub, `ubuntu-latest`           | Hourly, manual, after npm approval      |

## Local toolchain

Install:

```bash
bun install --frozen-lockfile
(cd web && bun install --frozen-lockfile)
```

- You need Bun and Node 24. The package supports Node 22.14 or later.
- Node includes npm, which the package smoke tests use.
- The default embedding model downloads once from Hugging Face. After that it comes from the cache.

## Local commands

| Command                 | What it does                                                                                                       |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `bun run check`         | Format check, lint, typecheck. Fast and deterministic.                                                             |
| `bun run ci:local`      | `bun run check`, then build, then the full test suite.                                                             |
| `bun run build`         | Clean build of `dist/` and the web UI.                                                                             |
| `bun run check:package` | Published-package shape: entry points and web UI present (`verify:package`), `publint`, and `attw`. Needs a build. |
| `bun run test`          | Whole suite in one Bun process. Not reliable for gating.                                                           |

`ci:local` (`scripts/local-ci.sh`) runs tests through `scripts/run-tests-isolated.sh`:

- The script starts one Bun process for each test file.
- The suite shares module and storage state across files. In one process, results change with file order.
- One process for each file gives the same result every time.
- The runner runs every file, even after one fails. At the end it lists each failed file and exits 1. In GitHub Actions each failed file is also an error annotation on the job. So one smoke run shows every failure on a platform.
- The runner also runs each web page spec (`web/tests/*.spec.ts` and `*.spec.tsx`) in its own process. It passes `--tsconfig-override web/tsconfig.app.json`, because Bun does not follow the tsconfig references in `web/tsconfig.json` and cannot resolve the `$lib` alias without it. To run one spec by hand: `bun test --tsconfig-override web/tsconfig.app.json web/tests/<name>.spec.tsx`.
- On Windows, each test gets 30 seconds, because process start-up is slow there. Other platforms keep the Bun default of 5 seconds.
- Do not use `bun test` for the whole suite. About 48 tests fail from shared module state. Those failures are not regressions.

Tests never write to the real `~/.omms`. Bun loads `.env.test` for every test process and its children. It:

- points `OMMS_LOG_FILE` (and so the traces directory) at a temporary path
- turns off the one-time migrations (`OMMS_SKIP_LEGACY_MIGRATION`, `OMMS_SKIP_TAG_PREFIX_MIGRATION`)
- turns off automatic backfill (`OMMS_DISABLE_AUTO_BACKFILL`) and web login item changes (`OMMS_DISABLE_WEB_AUTOSTART`)
- stops the real CLI from recording its copy in `~/.omms/runtime.json` (`OMMS_DISABLE_RUNTIME_RECORD`). A test that passes its own folder to the record functions still writes there.

The isolated runner also gives each full run its own log directory.

## Git hooks

Husky installs two hooks:

- **pre-commit**: `bun run typecheck && bunx lint-staged`.
- **pre-push**: `bun run check`. It is fast and stable, about 11 seconds.

The full suite is not in the pre-push hook on purpose. Run `bun run ci:local`
before a push to a pull request and before a merge.

## Known test caveats

- `tests/plugin-bundle-boundary.test.ts` bundles `dist/` entries with the
  `bun build` CLI in a child process. In Bun 1.3.14, in-process `Bun.build`
  resolves imports against the test file's folder. That breaks every relative
  import in `dist/index.js`. A comment in the test file records this. Check it
  again after a Bun upgrade.
- Some tests import `dist/`. `ci:local` builds before it tests. For one test
  file, build first: `bun run build && bun test tests/<file>.test.ts`.
- The Claude Code status line module has its own test, `hooks/omms-status.test.ts`.
  Run it with `bash scripts/test-claude-mod.sh`, which needs the `claude` command.
  `ci:local` and the GitHub workflows do not run it. See [TDR-025](tdr/025-claude-plugin-test-runs-whole-folder.md).

## GitHub workflows

### Quality (automatic)

Runs on every pull request and on every push to `main`. Four jobs:

- `changes` on `ubuntu-latest`: lists the files the pull request changes.
- `check` on `ubuntu-latest`: format, lint, typecheck, then build and
  `bun run check:package` (entry points and web UI present, `publint`,
  `attw`). Always runs, because Prettier also checks Markdown.
- `test` on `macos-latest`: build, then the full suite through
  `scripts/run-tests-isolated.sh`. Skipped when a pull request changes only
  Markdown files or files under `docs/`.
- `test-windows` on `windows-latest`: the same build and suite, run in Git
  Bash. Skipped in the same cases as `test`. It catches tests that assume POSIX
  paths, a shell-script command, or a symlink. Those pass on macOS and used to
  fail only in the release smoke. See [ADR-020](adr/020-pull-requests-test-on-windows.md).

- A skipped `test` job still passes the required status check. So docs-only pull requests can merge.
- Do not add `paths-ignore` to this workflow. If it does not start, the required checks never report and the pull request stays blocked.
- If the `changes` job fails, `test` and `test-windows` run anyway.
- `test-windows` is a separate job, not a matrix entry of `test`. A matrix renames the job to `test (macos-latest)`, so the required `test` check would never report and every pull request would stay blocked.
- The "Protect main" ruleset requires `check` and `test`. `test-windows` is not required yet: a failure shows on the pull request but does not block the merge. Add it to the ruleset once it runs reliably.

Quality is the minimum gate for every pull request. This includes pull
requests that skip the local hooks, such as Dependabot updates. Pull requests
that touch native paths also run Embedding Backend Verification.

### Embedding Backend Verification (automatic on native changes, manual on demand)

Runs when a pull request touches `package.json`, `bun.lock`, `bunfig.toml`,
`.npmrc`, `src/services/embedding.ts`, `src/services/onnxruntime-resolve.ts`,
`scripts/verify-embedding-backend.mjs`,
`scripts/verify-nested-onnxruntime-fixture.mjs`,
`scripts/fixtures/compiled-host-entry.mjs`, or this workflow file. You can
also start it by hand at any time.

- onnxruntime-node and sharp ship a separate native binary for each platform.
  So the `verify` job runs on `macos-15`, `macos-15-intel`, `windows-latest`,
  and `ubuntu-latest`.
- `macos-15` is the oldest supported macOS. The Quality `test` job already covers the newest macOS.
- Each job installs without lifecycle scripts and makes real embeddings under Bun and Node 24.
- The `nested-intel-regression` job copies the OpenCode nested install on
  Intel macOS with Bun 1.3.14 and Node 22. The compiled host must run
  inference and exit 0 without a SIGILL (#210, #225).

Start it by hand for any other native or toolchain change:

```bash
gh workflow run "Embedding Backend Verification" --ref main
```

### Platform Package Smoke (release, weekly, manual)

Runs on `macos-15`, `macos-26`, `macos-15-intel`, `macos-26-intel`,
`windows-latest`, and `ubuntu-latest`. Each job:

1. Installs dependencies.
2. Runs the full local gate.
3. Packs the npm tarball and installs it into a scratch project.
4. Runs the native dependency, libSQL vector, and package smoke scripts.

It runs:

- Before every release. The Release workflow calls it and waits for it.
- Every Monday at 06:00 UTC, to find changes in runner images and upstream packages.
- On demand, after any packaging change:

```bash
gh workflow run "Platform Package Smoke" --ref main
```

It does not run on pull requests. Its four macOS jobs would queue behind the
5-job macOS limit.

### Release (push to `main`)

Runs on every push to `main` once the repository variable
`RELEASE_PLEASE_ENABLED` is `true`. Three jobs:

- `release-please` keeps one release pull request open. It collects the
  conventional commits since the last release, proposes the next SemVer
  version, and updates `CHANGELOG.md`. It signs in as the private
  `omms-release` GitHub App, so its pull requests run the Quality checks.
  Merging that pull request tags `vX.Y.Z` and creates the GitHub Release.
- `smoke` runs only for a release. It calls Platform Package Smoke on the
  release commit.
- `publish` runs only after `smoke` passes. It builds, verifies the package
  contents, checks the version, and runs `npm stage publish` with no token
  (npm trusted publishing). npm holds the version until the maintainer
  approves it, and the job adds the approval steps to the GitHub Release.

Publishing happens in this run, not in a tag-push workflow. Tags that
release-please creates do not start other workflows.

### Publish next (after Quality on `main`)

Runs when Quality succeeds for a push to `main`, once the repository variable
`NPM_NEXT_ENABLED` is `true`. It builds that commit and publishes it as
`X.(Y+1).0-next.<run>` under the npm `next` tag, without approval. The
maintainer can then try it with `om-memory-system@next`.

- It skips release commits (commits that change `.release-please-manifest.json`).
- It fails if `latest` moves.

### Claude plugin channel (hourly, manual after approval)

`claude-plugin-channel.yml` runs hourly and on manual dispatch. Its single
`ubuntu-latest` job checks out full history and tags, then runs
`scripts/sync-claude-plugin-channel.sh`. It installs no packages and needs only
`contents: write`.

The script reads npm `latest` and moves only `refs/heads/stable` to the commit
tagged `v<version>`. It accepts stable version numbers only. An explicit
`--force-with-lease` protects concurrent updates and permits rollback when npm
`latest` moves back. A matching branch needs no push. A missing tag or invalid
version fails the run. A registry failure prints a warning, leaves the branch
unchanged, and exits successfully.

The Claude Code marketplace installs the plugin from this branch. Create
`stable` at the commit tagged `v4.4.1` before merging the marketplace change.
Consider a repository ruleset that limits writes to `stable` to GitHub Actions.

After npm approval, dispatch the channel update:

```bash
gh workflow run claude-plugin-channel.yml
```

Wait for that run to pass before checking a Claude Code plugin update. The
hourly schedule covers a missed dispatch.

#### Claude plugin channel rollout checklist

These checks follow the first merge of the stable-channel change. They remain
separate from the archived implementation tasks and have not run yet.

- [ ] Dispatch `gh workflow run claude-plugin-channel.yml` after merge.
- [ ] Verify the new run passes and reports `stable` already at `v4.4.1`.
- [ ] Run `claude plugin marketplace update omms`, then `claude plugin list`.
- [ ] Confirm `omms@omms` shows version 4.4.1.

## Release runbook

Versions come from commit messages. Use `feat:` (minor), `fix:` (patch),
`deps:` (patch, used by Dependabot), and `!` or `BREAKING CHANGE:` (major).
`refactor:`, `test:`, `ci:` and `chore:` do not trigger a release.

1. Merge work into `main` as usual. Each merge also appears as `om-memory-system@next`.
2. When you want to ship, merge the open release pull request.
3. Wait for the Release workflow: six-platform smoke, then `publish`.
4. Optional: to try the staged version, run `npm stage download <stage-id>` and install the tarball.
5. Approve the staged version with 2FA (two-factor authentication). Use the
   Staged tab at <https://www.npmjs.com/package/om-memory-system>, or run
   `npm stage list om-memory-system`, then `npm stage approve <stage-id>`.
6. Run `gh workflow run claude-plugin-channel.yml` to move the Claude Code channel to the approved release.
7. Wait for the channel run to pass. Users with marketplace auto-update get it at their next check.
8. Users on an unpinned npm install get an update notice.

To reject a staged version, run `npm stage reject <stage-id>`.

If no Release run starts after you merge the release pull request, GitHub
missed the push. Merge any other pull request into `main`. release-please then
finds the merged release pull request, tags it, and runs smoke and `publish`.

If the smoke gate fails, nothing is staged. The tag and GitHub Release
already exist. To fix it:

1. Push a `fix:` commit. release-please then proposes the next patch.
2. Edit the failed GitHub Release to say it was not published to npm.

## First publish (one time)

The npm package is `om-memory-system`. npm rejects the name `omms` because it
is too similar to `ms` and `os`. The product, plugin id, config folder and data
folder are still `omms`.

npm allows a trusted publisher only on a package that already exists. So you
publish the first version by hand. Do these steps in order after you merge the
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

3. Tag that commit and create its GitHub Release. release-please then counts
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
   settings are in npmjs.com, om-memory-system, Settings, Trusted publishing.

5. Set the repository variables `RELEASE_PLEASE_ENABLED=true` and
   `NPM_NEXT_ENABLED=true`.
6. After the first CI release is approved and live with a provenance badge,
   lock the package: npm package settings, Publishing access, "Require
   two-factor authentication and disallow tokens". Delete the `NPM_TOKEN`
   repository secret.

If `publish` fails with `ENEEDAUTH`, the workflow file name, environment, or
repository on npmjs.com does not match exactly. Nothing is published. Fix the
setting and run the job again.

## Platform scope

Supported platforms: macOS 15 and later on Apple Silicon and Intel, Windows,
and Linux. OpenCode users install the plugin on all of them.

- Pull requests get one Linux quality job, one macOS test job, and one Windows test job. Windows runs on pull requests because its failures are the ones macOS cannot show.
- The native matrix runs only when native paths change.
- The full six-platform matrix runs before a release and every week.

Keep the `onnxruntime-node@1.20.1` pin:

- Newer releases can SIGILL when a macOS process exits (#225).
- OpenCode's nested installs ignore package overrides (#184).

Job counts for each event (hosted runners are free, macOS included):

| Event                    | Ubuntu | Windows | macOS |
| ------------------------ | ------ | ------- | ----- |
| Routine pull request     | 2      | 1       | 1     |
| Docs-only pull request   | 2      | 0       | 0     |
| Native-path pull request | 3      | 2       | 4     |
| Push to `main`           | 4      | 1       | 1     |
| Release or weekly smoke  | 2      | 1       | 4     |

The practical limit is the 5-job macOS queue. Local CI spends no GitHub jobs.
