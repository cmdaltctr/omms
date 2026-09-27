# TDR-009: Protect capture traces with Windows access-control lists

**Date:** 2026-09-27
**Status:** Proposed
**Deciders:** OMMS maintainers
**Tags:** Windows, capture, privacy

## Context

The release smoke check for v3.3.0 failed in `tests/capture-diagnostics.test.ts` on Windows. Trace files contain redacted prompts and replies, so the capture-trace specification requires user-only access.

### Root Cause Analysis

The tests expected Unix modes `0700` and `0600`, but Windows reported `0666` after `chmodSync`. Node.js documents that directory `mode` is unsupported on Windows and file `mode` controls only the write bit there. Neither value proves who can read a trace.

## Decision

Keep Unix mode checks on POSIX. On Windows, protect the traces directory before writing content. Use `Get-Acl` and `Set-Acl` with a protected access-control list (ACL) that grants full control only to the current user's security identifier. Remove inherited and explicit rules. Protect an existing daily file before appending to it, then protect the file after creation. Pass paths through an environment variable to a fixed PowerShell script, not through shell interpolation. If protection fails, stop the trace write and log only the failure code.

Tests inspect Windows ACLs and confirm that an explicit `Everyone` read grant is removed from an existing file. They continue to check exact mode bits on POSIX. The test for trace redaction still runs on every platform.

## Consequences

### Positive

- Windows tests check actual read access rather than Unix-style mode bits.
- An old file with a wider explicit read grant is narrowed before the next append.

### Negative

- Opt-in tracing starts PowerShell processes on Windows for ACL updates, which adds latency.

### Neutral

- Normal capture works even if tracing fails; the log contains a failure code without trace content.

## Alternatives Considered

| Option                                    | Rejected Because                                                             |
| ----------------------------------------- | ---------------------------------------------------------------------------- |
| Skip permission checks on Windows         | This would leave user-only access untested.                                  |
| Assert `stat().mode` is `0666` on Windows | The value says nothing about who can read the file.                          |
| Depend on inherited permissions           | A chosen log directory or an existing trace file could grant broader access. |

## How to Recognise / Handle This Again

1. Find a Windows smoke failure in `tests/capture-diagnostics.test.ts` or a `Capture trace write failed` log record.
2. Inspect the traces directory and file ACLs with `Get-Acl -LiteralPath <path>`.
3. Check that the current user is the only allowed identity and inheritance is disabled.
4. Run the focused test on Windows before another release attempt.

## Revisit Triggers

- A Node.js runtime adds native Windows ACL controls.
- The cost of PowerShell startup becomes significant during opt-in tracing.

## References

- [Node.js file system documentation](https://nodejs.org/docs/latest-v24.x/api/fs.html)
- [PowerShell Set-Acl documentation](https://learn.microsoft.com/powershell/module/microsoft.powershell.security/set-acl)
- `src/services/capture-diagnostics.ts`
- `tests/capture-diagnostics.test.ts`
- [TDR-005](./005-two-tier-capture-diagnostics.md)
