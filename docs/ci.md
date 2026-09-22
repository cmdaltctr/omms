# Continuous Integration

OMMS validates changes locally on macOS first. GitHub Actions runs two
automatic checks on pull requests, one manual verification workflow on
demand, and the release pipeline on tag push. The repository is public, so
hosted runners cost nothing; the only limit is job concurrency.

## Where each check runs

| Check                   | Where                             | Command or trigger                                         |
| ----------------------- | --------------------------------- | ---------------------------------------------------------- |
| Format, lint, typecheck | Local, before every push          | `bun run check` via the pre-push hook                      |
| Unit tests              | Local, full gate                  | `bun run ci:local`                                         |
| Build                   | Local, full gate                  | `bun run ci:local`                                         |
| Format, lint, typecheck | GitHub, every PR                  | Quality workflow, `ubuntu-latest`                          |
| Native embedding smoke  | GitHub, PRs touching native paths | Embedding Backend workflow, `macos-latest` (Apple Silicon) |
| Native embedding smoke  | GitHub, manual                    | Same workflow, `workflow_dispatch`                         |
| Package smoke           | GitHub, manual                    | Platform Package Smoke workflow, `macos-latest`            |
| Publish and release     | GitHub, tag push                  | Release workflow, `ubuntu-latest`                          |

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

Runs on every pull request only, on `ubuntu-latest`. It repeats format,
lint, and typecheck as an independent remote check. It never runs on pushes
to `main`.

### Embedding Backend Verification (automatic on native changes, manual on demand)

Runs on `macos-latest` (newest macOS, Apple Silicon) whenever a pull request
touches `package.json`, `bun.lock`, `src/services/embedding.ts`,
`src/services/onnxruntime-resolve.ts`, `scripts/verify-embedding-backend.mjs`,
or this workflow file. It can also be dispatched at any time. The workflow
proves the native ONNX runtime and prebuilt sharp binaries install without
lifecycle scripts and produce real embeddings under Bun and Node 24.

Dispatch it manually for any other native or toolchain change:

```bash
gh workflow run "Embedding Backend Verification" --ref main
```

### Platform Package Smoke (manual)

Runs on `macos-latest` when dispatched. It installs dependencies, runs the full
local gate, packs the npm tarball, installs it into a scratch project, and
runs the native dependency, libSQL vector, and package smoke scripts.

Dispatch it before a release or after any packaging change:

```bash
gh workflow run "Platform Package Smoke" --ref main
```

### Release (tag push)

Runs on `ubuntu-latest` when you push a `v*` tag. It validates, builds,
checks that the tag matches `package.json`, publishes to npm, and creates
the GitHub Release.

## Release runbook

Versioning is manual SemVer. There is no Changesets or semantic-release.

1. Choose the next version: patch, minor, or major.
2. Set `version` in `package.json`.
3. Run `bun run ci:local` and confirm it passes.
4. Commit the version bump and push it.
5. Tag and push: `git tag vX.Y.Z && git push origin vX.Y.Z`.
6. The Release workflow publishes to npm and creates the GitHub Release.

The workflow fails if the tag and `package.json` version differ.

## Disabled coverage

Supported platform scope is Apple Silicon macOS, version 15 and above.
GitHub tests only `macos-latest` (the newest macOS arm64 image); the local
gate runs on the developer machine, which is newer still. Intel macOS,
Windows, Linux, and the exact macOS 15 floor have no coverage, by decision.
The `onnxruntime-node@1.20.1` pin stays in place regardless: newer releases
can SIGILL on macOS process exit (#225), and OpenCode's nested installs
ignore package overrides (#184).

Before any change to native dependencies (`onnxruntime-node`, sharp), Bun, or
Node, the Embedding Backend workflow fires automatically on the pull request,
and you should dispatch the Platform Package Smoke workflow. For toolchain
changes that touch no watched path, dispatch the Embedding Backend workflow
as well.

Costs: the repository is public, so hosted runners are free and macOS minutes
are not billed. A routine pull request spends one `ubuntu-latest` job; a pull
request touching native paths adds one `macos-latest` job. A Package Smoke
dispatch spends one `macos-latest` job. The practical limit is queue
concurrency, not minutes. Local CI spends no GitHub jobs at all.
