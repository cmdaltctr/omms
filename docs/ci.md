# Continuous Integration

OMMS validates changes locally on macOS first. GitHub Actions runs one cheap
automatic check on pull requests and two manual verification workflows on
demand.

## Where each check runs

| Check                   | Where                    | Command or trigger                          |
| ----------------------- | ------------------------ | ------------------------------------------- |
| Format, lint, typecheck | Local, before every push | `bun run check` via the pre-push hook       |
| Unit tests              | Local, full gate         | `bun run ci:local`                          |
| Build                   | Local, full gate         | `bun run ci:local`                          |
| Format, lint, typecheck | GitHub, every PR         | Quality workflow, `ubuntu-latest`           |
| Native embedding smoke  | GitHub, manual           | Embedding Backend workflow, `macos-15`      |
| Package smoke           | GitHub, manual           | Platform Package Smoke workflow, `macos-15` |
| Publish and release     | GitHub, tag push         | Release workflow, `ubuntu-latest`           |

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

### Embedding Backend Verification (manual)

Runs on `macos-15` (Apple Silicon) when dispatched. It proves the native
ONNX runtime and prebuilt sharp binaries install without lifecycle scripts
and produce real embeddings under Bun and Node 24.

Dispatch it when you change `package.json`, `bun.lock`, the embedding
service, the ONNX resolve shim, or Bun or Node versions:

```bash
gh workflow run "Embedding Backend Verification" --ref main
```

### Platform Package Smoke (manual)

Runs on `macos-15` when dispatched. It installs dependencies, runs the full
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

Routine and manual CI do not cover Windows, Linux, Intel macOS, or macOS 26.
The platform matrices were removed to stop ordinary changes spending
GitHub-hosted minutes across seven runner allocations.

Before any change to native dependencies (`onnxruntime-node`, sharp), Bun, or
Node, dispatch both manual workflows and consider temporarily restoring the
wider matrix from git history for that one run.

Costs: a routine pull request spends one `ubuntu-latest` job. Each manual
dispatch spends one `macos-15` job. Local CI spends no GitHub minutes.
