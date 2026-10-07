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
| Merge the release PR                   | GitHub, `ubuntu-latest`           | Release auto-merge, after Quality on PR |
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
| `bun run test`          | Every test file through the isolated runner, without check or build.                                               |

`ci:local` (`scripts/local-ci.sh`) runs tests through `scripts/run-tests-isolated.sh`:

- The script starts one Bun process for each test file.
- The suite shares module and storage state across files. In one process, results change with file order.
- One process for each file gives the same result every time.
- The runner runs every file, even after one fails. At the end it lists each failed file and exits 1. In GitHub Actions each failed file is also an error annotation on the job. So one smoke run shows every failure on a platform.
- The runner also runs each web page spec (`web/tests/*.spec.ts` and `*.spec.tsx`) in its own process. It passes `--tsconfig-override web/tsconfig.app.json`, because Bun does not follow the tsconfig references in `web/tsconfig.json` and cannot resolve the `$lib` alias without it. To run one spec by hand: `bash scripts/run-tests-isolated.sh web/tests/<name>.spec.tsx`.
- On Windows, each test gets 30 seconds, because process start-up is slow there. Other platforms keep the Bun default of 5 seconds.

The isolated runner gives each run an empty home folder (`HOME`, `USERPROFILE` and `OMMS_TEST_HOME`). Tests then never open the real `~/.omms` store or `~/.config/omms` config.

- Bun reads the home folder once, when the process starts. A test that changes `process.env.HOME` at run time still opens the real store. Before this runner change, `tests/user-prompt-learning-order.test.ts` deleted every row in the real `user-prompts.db` that way.
- The runner links `.omms/data/.cache` in the empty home to `~/.cache/omms-test-models`, so the embedding model downloads once per machine.
- It copies `~/.gitconfig` into the empty home, because some tests read the git identity.
- `tests/preload.ts` stops any test process that the runner did not start, or whose home folder is the real one (`OMMS_REAL_HOME`), with a message that names the runner. A test can still start a child with its own temporary home. `tests/test-home-isolation.test.ts` checks the empty home and that guard.
- To run one file safely, pass it to the runner: `bash scripts/run-tests-isolated.sh tests/<file>.test.ts`. A plain `bun test` refuses to run.

Bun also loads `.env.test` for every test process and its children. It:

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
  file, build first: `bun run build && bash scripts/run-tests-isolated.sh tests/<file>.test.ts`.
- The Claude Code status line module has its own test, `hooks/omms-status.test.ts`.
  Run it with `bash scripts/test-claude-mod.sh`, which needs the `claude` command.
  `ci:local` and the GitHub workflows do not run it. See [TDR-025](tdr/025-claude-plugin-test-runs-whole-folder.md).

### Timing tests and child processes

Wait for the event that starts a timer before testing its duration. Step-aside
starts its hold-off after database shutdown, so its tests keep shutdown real
and then advance a controlled clock. Fixed sleeps from the HTTP reply can read
the state too early on Windows.

A test that launches another test needs separate deadlines. Run only the
relevant child test, give its process time for startup and cleanup, and keep
that process deadline below the parent's. Use `runBunTest` from
`tests/test-process.ts`: it passes the 30-second test/hook timeout into the
child, bounds the process at 45 seconds, and exports a 60-second parent limit.
The outer runner's command-line timeout does not propagate into child runners.
Drain both output pipes concurrently so a failed child reports its error. Do not retry a recurring failure into a
green result. See [TDR-028](tdr/028-test-shutdown-state-and-child-deadlines.md).

Scenario scripts use `runBunProcess(["run", scriptPath], options)` from the same helper.
It bounds the child at 45 seconds and returns the exit code, stdout, and combined diagnostic output.
Give the enclosing test `TEST_PARENT_TIMEOUT_MS` (60 seconds). Reject a nonzero exit before parsing
stdout. Claude budget tests follow this policy without changing their assertions or the suite-wide
limit. See [TDR-035](tdr/035-bound-claude-budget-test-processes.md).

A held backfill contender needs time to release its claim after the parent
signals cleanup. Its tests wait for both child exits with separate five-second
cleanup deadlines and report failed exits with captured output. A 1.5-second
release delay checks this path. See [TDR-029](tdr/029-wait-for-backfill-test-child-cleanup.md).

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
  It then comments on the merged release pull request, mentions the
  repository owner, and gives the stage ID. The mention sends a GitHub
  notification. No issue is opened.
- `report-failure` runs when smoke or `publish` fails before npm stages the
  version. It marks the GitHub Release "not published to npm" and comments on
  the release pull request with a mention. The failed run also sends GitHub's
  failed-workflow notification.

Publishing happens in this run, not in a tag-push workflow. Tags that
release-please creates do not start other workflows.

### Release auto-merge (after Quality on the release pull request)

`release-auto-merge.yml` runs when a Quality run passes, Windows included, for
a pull request on a `release-please--` branch in this repository. The branch
name is only a first filter: anyone with write access can create such a branch.
Before it merges, `scripts/release-pr-guard.mjs` checks that the release App
wrote the pull request:

- The author is `omms-release[bot]`, and the base is `main`.
- Every commit has the App as author and a GitHub (`web-flow`) signature.
- The changed files are only `CHANGELOG.md` (additions only), `package.json`,
  `.claude-plugin/plugin.json` and `.release-please-manifest.json`.
- The JSON files change only the version, and all versions agree.

The guard runs from `main` and reads the pull request through the API. It
never checks out the pull request's code. If a check fails, the job fails with
the reasons and the pull request waits for the maintainer. The merge uses the
release App token, so it starts the Release workflow, and
`--match-head-commit` merges only the checked commit. All other pull requests
still need the maintainer to merge them. See
[ADR-023](adr/023-automate-release-except-npm-approval.md).

### Publish next (after Quality on `main`)

Runs when Quality succeeds for a push to `main`, once the repository variable
`NPM_NEXT_ENABLED` is `true`. It builds that commit and publishes it as
`X.(Y+1).0-next.<run>` under the npm `next` tag, without approval. The
maintainer can then try it with `om-memory-system@next`.

- It skips release commits (commits that change `.release-please-manifest.json`).
- It fails if `latest` moves.

### Claude plugin channel (hourly, manual after approval)

`claude-plugin-channel.yml` runs hourly and on manual dispatch. Its single
`ubuntu-latest` job runs only from `main` and pins checkout to `main`, with full
history and tags. A manual dispatch from another ref skips the job. It then runs
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
2. release-please updates the release pull request. When its Quality run passes,
   the Release auto-merge workflow merges it.
3. The Release workflow runs the six-platform smoke, then stages the version on
   npm.
4. GitHub emails you: the Release workflow mentions you in a comment on the
   release pull request. At <https://github.com/settings/notifications>, turn on
   Email under "Participating, @mentions and custom". For failures, also turn
   on Email under "Actions" with "Only notify for failed workflows".
5. Optional: to try the staged version, run `npm stage download <stage-id>` and
   install the tarball.
6. In the main checkout, run `bun run release:approve` and enter your 2FA code.
   The script approves the version, waits for npm `latest`, dispatches the
   Claude plugin channel, and checks that `stable` is at the release tag. Each
   npm version check uses `--prefer-online` to recheck cached data against the
   registry. It reads the stage ID from the newest GitHub Release note.
7. Users with marketplace auto-update get the plugin at their next check. Users
   on an unpinned npm install get an update notice.

If you approve another way, the hourly channel run moves `stable`.

To reject a staged version, run `npm stage reject <stage-id>`.

If no Release run starts after you merge the release pull request, GitHub
missed the push. Merge any other pull request into `main`. release-please then
finds the merged release pull request, tags it, and runs smoke and `publish`.

If the smoke gate fails, nothing is staged. The tag and GitHub Release
already exist. The `report-failure` job marks the GitHub Release "not published
to npm" and mentions you on the release pull request. To fix it, push a `fix:`
commit. release-please
then proposes the next patch.

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

### Tests skipped on Windows

Four tests time out at 30 seconds when a Windows runner stalls. They pass on a rerun and on every other platform. They are skipped on Windows only, through `SKIP_ON_SLOW_WINDOWS` in `tests/test-process.ts`. See [TDR-037](tdr/037-skip-slow-tests-on-windows.md).

| Test file                                      | Skipped on Windows                                                                   |
| ---------------------------------------------- | ------------------------------------------------------------------------------------ |
| `tests/web-profile-catch-up.test.ts`           | `previews, runs one catch-up at a time…` and `stops the page run…`                   |
| `tests/pi-importer.test.ts`                    | `applies session, date, and scope filters before expensive work`                     |
| `tests/profile-catch-up-lease-cleanup.test.ts` | The `user-prompt-learning-order` case. The `profile-catch-up-lease` case still runs. |

- Windows still runs every other test: paths, file locks, process handoff, and the package install.
- The code these tests exercise has no `win32` branch, and the catch-up lease is a database table, not a lock file. If you suspect a Windows problem in profile catch-up or the Pi importer, run these tests on a Windows machine.
- Do not add a test to this list because it failed once. Add it only after it timed out on a stalled runner and passed on a rerun, and record the runs in the TDR.

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
