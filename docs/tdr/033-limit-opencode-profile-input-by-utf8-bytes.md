# TDR-033: Limit OpenCode profile input by UTF-8 bytes

- **Date:** 2026-10-04
- **Status:** Accepted
- **Deciders:** Dr Muhammad Aizat Md Hawari
- **Tags:** opencode, unicode, context-limits

## Context

`userProfileMaxContextBytes` defaults to 32768 and controls OpenCode profile-learning input. Its previous implementation compared JavaScript string length with the byte limit. It then appended a truncation marker outside that limit.

### Root Cause Analysis

JavaScript counts UTF-16 code units. Chinese, Arabic, and emoji text can occupy more UTF-8 bytes than this count indicates. Slicing at a code-unit boundary can also split an emoji's surrogate pair.

The new regression test found 6479 bytes under a 5000-character check. Another case emitted 8078 bytes against a 4096-byte ceiling. A cut through an emoji left an unpaired surrogate.

## Decision

Use `truncateToMaxBytes` from `src/utils/context-limit.ts` in `buildUserAnalysisContext`. Count the marker inside the configured ceiling. Preserve the existing head-and-tail strategy and prompt construction. Keep stored prompts unchanged and retain this setting's OpenCode scope.

## Verification

`tests/opencode-profile-learning-bytes.test.ts` covers Chinese, Arabic, emoji, marker overhead, fitting input, and unchanged stored prompts. The worker recorded failures with the previous limiter. After the correction, the coordinator ran:

```bash
bun test tests/opencode-profile-learning-bytes.test.ts
```

Result on 2026-10-04: **5 passed, 0 failed**. The worker also ran `tests/user-profile-learning-error.test.ts`: **1 passed, 0 failed**.

## Consequences

### Positive

- The byte field now bounds UTF-8 input, including its marker, without splitting Unicode characters.

### Negative

- Multibyte input can be shortened earlier than it was with the character check.

### Neutral

- Stored prompts and other hosts' profile input keep their existing behaviour.

## Alternatives Considered

| Option                                            | Rejected because                                                                  |
| ------------------------------------------------- | --------------------------------------------------------------------------------- |
| Keep the character limiter and rename the setting | Breaks the existing byte contract and accepted configuration.                     |
| Slice a UTF-8 buffer at the limit                 | Can cut through a character; the existing helper already handles safe boundaries. |

## How to Recognise / Handle This Again

1. Compare `utf8ByteLength(input)` with the configured byte ceiling.
2. Check that truncation markers count inside that ceiling.
3. Run `bun test tests/opencode-profile-learning-bytes.test.ts` after changing the limiter.

## Revisit Triggers

Review this record if profile input moves to a shared pipeline or the UTF-8 utility changes.

## References

- [Memory limits](../configuration.md#memory-limits)
- `src/adapters/opencode/profile-learning.ts`: `buildUserAnalysisContext`
- `src/utils/context-limit.ts`: `truncateToMaxBytes`
- `tests/opencode-profile-learning-bytes.test.ts`
