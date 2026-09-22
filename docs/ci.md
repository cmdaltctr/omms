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
| Format, lint, typecheck                | GitHub, `ubuntu-latest`           | Quality workflow, every PR and `main`   |
| Build, unit tests                      | GitHub, `macos-latest`            | Quality workflow, every PR and `main`   |
| Native embedding smoke (4 platforms)   | GitHub, PRs touching native paths | Embedding Backend workflow, or manual   |
| Nested OpenCode fixture, Intel (#225)  | GitHub, PRs touching native paths | Embedding Backend workflow, or manual   |
| Full gate and pack smoke (6 platforms) | GitHub                            | Before release, weekly (Monday), manual |
| Publish and release                    | GitHub, `ubuntu-latest`           | Release workflow, tag push, after smoke |

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

| Command            | What it does                                             |
| ------------------ | -------------------------------------------------------- |
| `bun run check`    | Format check, lint, typecheck. Fast and deterministic.   |
| `bun run ci:local` | `bun run check`, then build, then the full test suite.   |
| `bun run build`    | Clean build of `dist/` and the web UI.                   |
| `bun run test`     | Whole suite in one Bun process. Not reliable for gating. |

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
- `check` on `ubuntu-latest`: format, lint, typecheck. Always runs, because
  Prettier also checks Markdown.
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

### Release (tag push)

Runs when you push a `v*` tag. It first calls Platform Package Smoke and
stops if any platform fails. It then validates and builds on `ubuntu-latest`,
checks that the tag matches `package.json`, publishes to npm, and creates the
GitHub Release.

## Release runbook

Versioning is manual SemVer. There is no Changesets or semantic-release.

1. Choose the next version: patch, minor, or major.
2. Set `version` in `package.json`.
3. Run `bun run ci:local` and confirm it passes.
4. Commit the version bump and push it.
5. Tag and push: `git tag vX.Y.Z && git push origin vX.Y.Z`.
6. The Release workflow publishes to npm and creates the GitHub Release.

The workflow fails if the tag and `package.json` version differ.

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
| Release or weekly smoke  | 1–2    | 1       | 4     |

The practical limit is the 5-job macOS queue. Local CI spends no GitHub jobs.
