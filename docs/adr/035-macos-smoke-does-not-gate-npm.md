# ADR-035: The macOS release smoke does not gate npm

**Date:** 2026-10-30
**Status:** Accepted
**Deciders:** OMMS maintainer

## Context

The Release workflow ran the platform smoke on five runners, and `publish` waited for all of them. On 2026-10-30 GitHub had no free macOS arm64 runners for hours. Jobs that no runner picked up were cancelled after about 15 minutes with "The job was not acquired by Runner of type hosted". No test ran, but the cancelled job failed the smoke, so 4.29.0 never reached npm. Re-running only the failed job did not start, because the smoke is a called workflow. The maintainer had to push another commit and release again.

The workflow has no setting for the wait. Every change already runs `ci:local` on macOS before it is pushed.

## Decision

- The Release workflow calls the smoke twice. `smoke` tests `ubuntu-latest` and `windows-latest`, and `publish` waits for it.
- `smoke-macos` tests `macos-15`, `macos-26` and `macos-26-intel` at the same time. It reports but does not block `publish`.
- The weekly and manual smoke still test all five runners.

## Consequences

### Positive

- A macOS runner shortage no longer stops a release.
- Linux and Windows, which `ci:local` on a Mac cannot cover, still gate npm.

### Negative

- A bug that shows only on a packed install on macOS can reach npm. The maintainer checks the `smoke-macos` result after each release and runs the manual smoke when it was cancelled.
