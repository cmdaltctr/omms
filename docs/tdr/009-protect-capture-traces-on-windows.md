# TDR-009: Protect capture traces with Windows access-control lists

**Date:** 2026-09-27
**Status:** Accepted
**Deciders:** OMMS maintainers
**Tags:** Windows, capture, privacy

## Context

The release smoke check for v3.3.0 failed in `tests/capture-diagnostics.test.ts` on Windows. Trace files contain redacted prompts and replies, so the capture-trace specification requires user-only access.

### Root Cause Analysis

The tests expected Unix modes `0700` and `0600`, but Windows reported `0666` after `chmodSync`. Node.js documents that directory `mode` is unsupported on Windows and file `mode` controls only the write bit there. Neither value proves who can read a trace.

## Decision

Keep Unix mode checks on POSIX. On Windows, protect the traces directory before writing content. Use the .NET `System.IO.File` and `System.IO.Directory` access-control methods from PowerShell. The GitHub Windows runner could not load PowerShell's `Microsoft.PowerShell.Security` module, so `Get-Acl` and `Set-Acl` failed. Reject a directory or file owned by another user. Remove inherited and explicit rules, then grant full control only to the current user's security identifier. Protect retained date-named files and an existing daily file before appending. Reject symbolic links. A new file inherits the private directory ACL until its own rules are protected. Pass paths through an environment variable to a fixed script, not through shell interpolation. If protection fails, stop the trace write and log only the failure code.

Tests inspect Windows ACLs and confirm that an explicit `Everyone` read grant is removed from an existing file. A regression also checks retained files from an earlier day. POSIX tests still check exact mode bits, and trace redaction runs on every platform.

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
2. Inspect ACLs with `[System.IO.Directory]::GetAccessControl(<path>)` or `[System.IO.File]::GetAccessControl(<path>)` in Windows PowerShell.
3. Check that the current user is the only allowed identity and inheritance is disabled.
4. Run the focused test on Windows before another release attempt.

## Revisit Triggers

- A Node.js runtime adds native Windows ACL controls.
- The cost of PowerShell startup becomes significant during opt-in tracing.

## References

- [Node.js file system documentation](https://nodejs.org/docs/latest-v24.x/api/fs.html)
- [.NET file ACL documentation](https://learn.microsoft.com/dotnet/standard/io/how-to-add-or-remove-access-control-list-entries)
- `src/services/capture-diagnostics.ts`
- `tests/capture-diagnostics.test.ts`
- [TDR-005](./005-two-tier-capture-diagnostics.md)
