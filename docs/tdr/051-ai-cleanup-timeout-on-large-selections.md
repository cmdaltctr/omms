# TDR-051: AI Cleanup timed out on large selections

**Date:** 2026-10-17
**Status:** Accepted
**Deciders:** Aizat Hawari
**Tags:** ai-cleanup, profile, web-ui, timeouts

## Context

On the live profile (v4.19.1, about 3,000 memories), AI Cleanup with **Low Freq (≤3)** or **Same Category (3+)** showed the loading screen for about a minute. The dialog then went back to the selection screen. The only sign of a failure was a toast that disappeared after a few seconds.

### Root Cause Analysis

The symptom was a dialog that returned to the selection. The cause was one model request for the whole selection, which ran past the 60-second limit of the external API call.

Evidence from `~/.omms/omms.log` on 2026-10-16 (local time), reproduced in the Orca browser:

| Shortcut           | Items | Prompt size | Result after about 60 s                                |
| ------------------ | ----- | ----------- | ------------------------------------------------------ |
| Low Freq (≤3)      | 2,045 | 549 KB      | `handleAICleanup: error: TimeoutError` at 22:49, 22:56 |
| Same Category (3+) | 744   | 238 KB      | `handleAICleanup: error: TimeoutError` at 23:09        |

No recent run logged `AI response received`. `callViaExternalAPI` in `src/services/user-profile/ai-cleanup.ts` uses `AbortSignal.timeout(EXTERNAL_PROFILE_CLEANUP_TIMEOUT_MS)`, 60 seconds. The handler ran the call inside the web request. The dialog sent the request with a 180-second limit, caught the error, set the phase back to "select" and showed a toast.

The same evening the profile saved a new version 5 times in one hour (versions 535 to 539). One save landed during the Same Category test. A run split into batches would take many minutes, and the old Apply refused any result after a version change.

## Decision

Change `ai-cleanup-batching` (ADR-029):

1. Send the selection in batches of at most 100 memories (`AI_CLEANUP_BATCH_SIZE` in `src/services/request-timeouts.ts`). Each request keeps the 60-second limit.
2. Run the batches as a background job. The dialog polls `GET /api/user-profile/ai-cleanup` every 2 seconds and shows "Batch X of Y".
3. A failed batch leaves its memories unchanged. When every batch fails, the dialog shows the error with Retry.
4. Apply edits the newest profile and retries a save conflict up to three times.

### Measurement

Measured on 2026-10-17 on a scratch copy of the live profile. Each row is one call with a batch of 97 or 100 items.

| Model                         | Reasoning | Batch time            | Output tokens |
| ----------------------------- | --------- | --------------------- | ------------- |
| `glm-5.3-flash` (z.ai coding) | on        | over 60 s (timed out) | not received  |
| `glm-5.3-flash` (z.ai coding) | off       | 58.9 s                | 5,358         |
| `deepseek-flash`              | on        | 95.4 s                | 25,437        |
| `deepseek-flash`              | off       | 12.7 to 21.6 s        | about 6,000   |

Same Category (3+) with `deepseek-flash` and reasoning off: 8 batches, 0 failed, slowest 21.6 s, 2 minutes 25 seconds in total.

The batch size is not the main cause of a slow batch. Reasoning is. A reasoning model writes thousands of hidden tokens before the reply. With z.ai, even 24 items took 59.6 s. The z.ai coding plan also sent HTTP 429 (too many requests) when the live web app used the same key.

To turn reasoning off for a provider that supports it, set `"memoryExtraParams": { "thinking": { "type": "disabled" } }`. This setting applies to every external API call.

## Consequences

### Positive

- Both shortcuts finish on a large profile.
- The user sees progress and the reason for a failure.

### Negative

- Duplicates in different batches merge only on a second run.

### Neutral

- The 60-second limit for one call stays as it was.

## Alternatives Considered

| Option                              | Rejected Because                                                   |
| ----------------------------------- | ------------------------------------------------------------------ |
| Raise the 60-second limit           | 2,045 items outgrow any sensible limit, and the user sees nothing  |
| Show the error only, no batching    | The shortcuts would still never finish                             |
| Smaller batches of 50               | Twice the requests; 100 fits the limit (see the measurement above) |
| Ask only for merged and removed ids | On z.ai the shorter reply format got no reply in 300 s, twice      |

## How to Recognise / Handle This Again

1. The dialog shows a batch that fails again and again, or the log has `AI cleanup: batch failed` with `reason: "timeout"`.
2. Read `callMs` on the `AI cleanup: batch reply received` lines for the slowest batch.
3. If the model reasons, turn reasoning off with `memoryExtraParams` (see Measurement), or choose a model without reasoning.
4. If the slowest batch still comes near 60 seconds, lower `AI_CLEANUP_BATCH_SIZE` and the batch size in the `profile-ai-cleanup` spec together.
5. If the log has `reason: "http-429"`, the provider limits requests. Wait, or use a key that no other app uses at the same time.

## Revisit Triggers

- A slower or faster profile model.
- A change to the cleanup prompt or to the 60-second limit.

## References

- `openspec/changes/archive/2026-10-17-ai-cleanup-batching/`
- [ADR-029](../adr/029-ai-cleanup-runs-as-a-batched-job.md), [ADR-028](../adr/028-every-profile-save-checks-version.md)
