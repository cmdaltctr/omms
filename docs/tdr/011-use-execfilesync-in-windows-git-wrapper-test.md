# TDR-011: Use execFileSync in the Windows Git wrapper test

**Date:** 2026-09-27
**Status:** Proposed
**Deciders:** OMMS maintainers
**Tags:** Windows, tests, Git

## Context

The Windows package smoke check reached `tests/project-scope.test.ts` after the import-source path tests were corrected. One Windows-only case failed before testing its Git wrapper.

### Root Cause Analysis

The test called `execSync("where.exe git.exe")`, but its only child-process import was `execFileSync`. The Windows-only branch raised `ReferenceError: execSync is not defined`.

## Decision

Call the existing `execFileSync("where.exe", ["git.exe"], { encoding: "utf-8" })` instead. Keep the wrapper assertion and all Windows test cases active. Passing the executable and argument separately avoids a shell.

## Consequences

### Positive

- The test runs its intended wrapper check on Windows.

### Negative

- None.

### Neutral

- Production Git lookup and project identity stay unchanged.

## Alternatives Considered

| Option                | Rejected Because                                                              |
| --------------------- | ----------------------------------------------------------------------------- |
| Import `execSync`     | The test already uses `execFileSync`, which passes arguments without a shell. |
| Skip the Windows case | It protects against repository-local command shims.                           |

## How to Recognise / Handle This Again

1. Find `ReferenceError: execSync is not defined` in the Windows package-smoke log.
2. Check imports in `tests/project-scope.test.ts`.
3. Run the complete Windows smoke job after the fix.

## Revisit Triggers

- The test stops using `where.exe` to locate Git.

## References

- `tests/project-scope.test.ts`
- `src/services/tags.ts`
