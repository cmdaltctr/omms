# ADR-001: Local macOS and limited GitHub CI

**Date:** 2026-09-21
**Status:** Accepted
**Deciders:** Project maintainer

## Context

Routine pull requests started Windows, Linux, Intel macOS, Apple Silicon
macOS, and macOS 26 workflows. The maintainer develops on Apple Silicon and
can run routine validation locally before pushing. The multi-platform matrix
used GitHub Actions minutes for changes that did not require broad platform
coverage.

## Decision

Run format, lint, typecheck, unit tests, and the production build locally on
macOS through `bun run ci:local`. The pre-push hook runs this command.

Keep the Quality workflow automatic for pull requests only. Run embedding and
package-smoke workflows manually on `macos-15` only. Do not run routine
Windows, Linux, Intel macOS, or macOS 26 platform checks.

## Consequences

### Positive

- Routine validation happens before a push without GitHub Actions minutes.
- Manual GitHub checks retain an Apple Silicon hosted verification path.

### Negative

- Windows, Linux, and Intel macOS regressions can go undetected.
- A maintainer must dispatch manual workflows for native or package-risk changes.

### Neutral

- ADR files are local-only and ignored from Git as requested.

## Follow-up findings (2026-09-21)

- The full suite in one Bun process is order-dependent (shared module and
  storage state). ci:local now runs one Bun process per test file via
  scripts/run-tests-isolated.sh; the gate passes deterministically (~60s).
- Bun 1.3.14 resolves in-process Bun.build imports against the test file's
  directory when the file lives under tests/. plugin-bundle-boundary now
  bundles through the bun build CLI in a child process. Revisit after a Bun
  upgrade.
- The pre-push hook stays at bun run check only; the full gate is a deliberate
  command (ci:local) run before merging.

## Alternatives Considered

| Option                         | Rejected Because                                                |
| ------------------------------ | --------------------------------------------------------------- |
| Full automatic platform matrix | Uses GitHub Actions minutes for routine changes.                |
| Docker-based local CI          | Does not test macOS or Windows native binaries.                 |
| No GitHub checks               | Removes the independent hosted Apple Silicon verification path. |

## References

- `.github/workflows/quality.yml`
- `.github/workflows/embedding-backend.yml`
- `.github/workflows/platform-smoke.yml`
- `scripts/local-ci.sh`
