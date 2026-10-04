# TDR-032: Recheck npm after release approval

- **Date:** 2026-10-04
- **Status:** Accepted
- **Deciders:** Dr Muhammad Aizat Md Hawari
- **Tags:** npm, release, cache

## Context

During the first automated release, 4.5.0 on 2026-10-04, approval succeeded but
the Claude plugin channel needed a manual dispatch. The script polls npm 30 times,
five seconds apart. A cached answer can outlast that 150-second window.

### Root Cause Analysis

After approval, `npm view` returned 4.4.2. A subsequent check with
`--prefer-online` returned 4.5.0, and `npm stage list` showed no staged versions.
The owner has not confirmed the script's exact exit message. A regression fixture
reproduces the stale answer and stops the script before channel dispatch.

## Decision

Add `--prefer-online` to all three `npm view "$package" version` calls in
`scripts/release-approve.sh`. This forces npm to check cached data against the
registry for the initial check, each poll, and the final check.

The test fixture returns 4.4.2 unless the flag is present. The successful approval
test also checks all three calls. Keep the existing polling limits.

## Consequences

### Positive

- A locally cached version cannot prevent the channel dispatch after approval.

### Negative

- Each version check contacts the registry.

### Neutral

- Registry propagation can still take time. The hourly channel run remains the fallback.

## Alternatives Considered

| Option                       | Rejected Because                                                |
| ---------------------------- | --------------------------------------------------------------- |
| Increase the polling timeout | The observed fresh result was available with `--prefer-online`. |
| Clear npm's cache            | A per-call flag avoids changing the owner's wider npm cache.    |

## How to Recognise / Handle This Again

1. Compare `npm view om-memory-system version` with the same command using `--prefer-online`.
2. Ask the owner to check `npm stage list om-memory-system` if approval status is unclear.
3. After confirming publication, dispatch `gh workflow run claude-plugin-channel.yml --repo cmdaltctr/omms --ref main`.

Only the owner approves or rejects staged versions.

## Revisit Triggers

Investigate registry propagation if fresh checks still miss an approved version throughout the polling window.

## References

- [ADR-023](../adr/023-automate-release-except-npm-approval.md)
- [Release runbook](../ci.md#release-runbook)
- [Approval script](../../scripts/release-approve.sh)
- [Regression tests](../../tests/release-approve.test.ts)
- [npm cache configuration](https://docs.npmjs.com/cli/using-npm/config#prefer-online)
