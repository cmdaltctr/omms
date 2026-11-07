# TDR-065: Windows home paths are scrubbed before POSIX paths

**Date:** 2026-11-06
**Status:** Accepted
**Deciders:** Aizat Hawari
**Tags:** memory-spaces, export, privacy, scrubber

## Context

The change `memory-space-transfer` scrubs a space export file (design D7). The scrubber in `src/services/spaces/identifier-scrub.ts` must turn `/Users/<x>/...`, `/home/<x>/...` and `C:\Users\<x>\...` into `~/...`, and email addresses into `<email>`.

### Root Cause Analysis

A Windows home path in forward-slash form (`C:/Users/sam/tools`) ends in `/Users/sam/...`, which the POSIX pattern also matches: the character before the slash is `:`, and the POSIX lookbehind only rejects a word character. When the POSIX pass ran first, it rewrote the `/Users/sam/...` part and left the drive letter behind: `C:/Users/sam/...` became `C:~/...`.

The user name still left the file, so the exporter's final safety scan did not fail. The exported text was wrong instead: a colleague importing the file read a broken path. Only the forward-slash Windows form is affected; the backslash form never matches the POSIX pattern.

Evidence: `tests/identifier-scrub.test.ts` ("accepts forward slashes in a Windows home path") feeds `C:/Users/sam/tools/build.bat` and expects `~/tools/build.bat`.

## Decision

The scrubber runs the Windows pass first and the POSIX pass second:

```ts
const afterPaths = withoutPrivate.replace(WINDOWS_HOME, toTilde).replace(POSIX_HOME, toTilde);
```

The Windows pattern takes both separators (`C:\Users\x\` and `C:/Users/x/`), so both forms are gone before the POSIX pass sees the text. A comment in the file states that the order is load-bearing.

## Consequences

### Positive

- Both Windows forms scrub to a clean `~/...`.
- The exported text stays valid for a colleague on any platform.

### Negative

- The replace order is now a hidden rule; only the comment and the test state it.

### Neutral

- POSIX-only text never matches the Windows pattern, so its behaviour is unchanged.

## Alternatives Considered

| Option                                  | Rejected Because                                                                         |
| --------------------------------------- | ---------------------------------------------------------------------------------------- |
| One regex for both shapes               | The shapes differ (drive letter, separators); one pattern is hard to read and test       |
| Make the POSIX pass skip a drive prefix | A lookbehind for `X:` still leaves the drive letter in the text, so the path reads wrong |

## How to Recognise / Handle This Again

1. Symptom: an export file holds `C:~/...` instead of `~/...`.
2. Check `tests/identifier-scrub.test.ts` for the forward-slash Windows case.
3. When two replace passes can match the same text, order them and test the overlap.

## Revisit Triggers

- A new path shape joins the scrubber, for example a UNC path.
- The final safety scan gains a new pattern.
