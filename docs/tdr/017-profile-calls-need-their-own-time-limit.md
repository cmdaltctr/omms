# TDR-017: Profile calls need their own time limit

**Date:** 2026-09-30
**Status:** Proposed
**Deciders:** OMMS maintainers
**Tags:** profile-learning, external-api, timeout

## Context

Profile learning on the external API failed every time, on every host that used it. The log did not say why:

- Pi wrote only `History profile model call failed`.
- Claude Code wrote `{"code":"Error"}`.

After each failure, the next turn sent the same batch again, and paid for it again. 2,902 prompts waited for profile learning. A history backlog also filled each live pass with the oldest prompts, so recent prompts waited behind it.

### Root Cause Analysis

`selectImportModel` in `src/importer/model-selection.ts` built one external API provider for both ports: capture and profile. That provider used `autoCaptureIterationTimeout`, which defaults to 30 seconds.

A capture reply is short. A profile reply analyses a batch of prompts and is much longer. In a timed test, one profile call to `glm-5-turbo` took 66 seconds. Each profile call therefore hit the 30-second limit and was stopped. The provider returned `API request timeout`, and the log line dropped that text.

The Pi and OpenCode host-model profile paths already used 120 seconds, so only the external API path failed.

## Decision

1. `selectImportModel` builds a second provider for the profile port with its own limit. Captures keep `autoCaptureIterationTimeout`.

   ```ts
   export const PROFILE_REQUEST_TIMEOUT_MS = 120_000;
   const profileProvider = AIProviderFactory.createProvider(
     providerName as AIProviderType,
     buildMemoryProviderConfig(settings, { iterationTimeout: PROFILE_REQUEST_TIMEOUT_MS })
   );
   ```

2. A failed profile step logs one record with the host and a fixed reason code: `timeout`, `http-<status>`, `no-tool-call`, `invalid-reply`, `not-configured`, or `error` (`src/core/profile-failure.ts`). The record holds no prompt, reply, or key. The messages are `Claude Code profile learning failed`, `pi profile learning: aborted`, and `user-profile-learning: aborted` (OpenCode).
3. After a failure, the process starts no profile pass for 10 minutes (`src/core/profile-backoff.ts`). Capture continues. A success clears the wait. A restart also clears it.
4. A live pass reads waiting prompts from the last 7 days, newest first. When none are recent, it falls back to the oldest prompts.
5. A trivial prompt (trimmed text under 20 characters and fewer than three words, for example `yes go`) is marked as learned with no model call. It does not count toward `userProfileAnalysisInterval`.
6. The **Catch up profile** button and `om-memory-system profile-catch-up` clear a backlog in batches of 50, oldest first, after a confirmation with the call count.

## Consequences

### Positive

- External API profile learning finishes with slow models.
- A stuck capture still stops after 30 seconds, so the capture queue does not wait longer.
- The log names the cause of each failure with a code.
- A failing model costs at most one profile call for each process every 10 minutes.
- Recent prompts reach the profile first. The user clears the backlog when they choose to.

### Negative

- A profile call that hangs now holds the profile pass for up to 120 seconds.
- The 10-minute wait lives in memory only. Each new process tries once at once after a restart.

### Neutral

- The 120-second value matches the Pi and OpenCode host-model profile paths.
- No new config key. A user cannot change the profile limit.

## Alternatives Considered

| Option                                | Rejected Because                                                                |
| ------------------------------------- | ------------------------------------------------------------------------------- |
| Raise `autoCaptureIterationTimeout`   | A stuck capture would block the capture queue for longer.                       |
| A new `profileRequestTimeout` setting | No user needs to tune it. The host-model paths already use a fixed 120 seconds. |
| Smaller profile batches               | More calls for the same prompts, and a slow model can still pass 30 seconds.    |
| Retry the failed batch at once        | The same limit fails the same batch again, and each try costs money.            |

## How to Recognise / Handle This Again

1. Look for profile failure records in the log:

   ```bash
   grep -E 'profile learning failed|profile learning: aborted|user-profile-learning: aborted' ~/.omms/omms.log | tail
   ```

2. Read the `reason` field. `timeout` means the model did not reply within the limit.
3. Time one call to the model outside OMMS. Compare the time with `PROFILE_REQUEST_TIMEOUT_MS`.
4. If the model is slower than the limit, choose a faster model in the External API card. Or run `om-memory-system profile-catch-up --model <id>` with another model.
5. Check the backlog with `om-memory-system profile-catch-up --dry-run`.

## Revisit Triggers

- A supported model regularly takes more than 120 seconds for one profile batch.
- The profile batch size or the profile prompt changes.
- A provider adds streaming or a server-side time limit that is shorter than 120 seconds.

## References

- `src/importer/model-selection.ts` (`PROFILE_REQUEST_TIMEOUT_MS`, `selectImportModel`)
- `src/core/profile-failure.ts`, `src/core/profile-backoff.ts`, `src/core/trivial-prompt.ts`
- `src/services/user-prompt/user-prompt-manager.ts` (`recentFirst`)
- `src/importer/profile-backlog.ts`, `src/importer/profile-catch-up.ts`, `src/cli/profile-catch-up-command.ts`
- `tests/import-model-selection.test.ts`
- OpenSpec change `settings-keys-embedding-claude`
- [Using memory: User profile](../using-memory.md#user-profile)
