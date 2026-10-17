# ADR-029: AI Cleanup runs as a batched background job and applies edits

- **Date:** 2026-10-17
- **Status:** Accepted
- **Superseded in part by:** [ADR-030](030-profile-cleanup-runs-on-every-host.md), which keeps the automatic cleanup on every host and replaces decision 5
- **Deciders:** Aizat Hawari

## Context

AI Cleanup in the web app sent the whole selection to the profile model in one request, inside one web request. On a profile of about 3,000 memories, the dialog's shortcuts select 744 or 2,045 memories. Each request ran into the 60-second limit of the external API call (TDR-051).

A run split into batches takes 10 to 20 minutes. Profile learning saves several times an hour, and every save changes the version (ADR-028). The old Apply refused a result when the version had changed. It also replaced the whole selection with the model's output, so a kept memory took the model's rewording, which the review screen never showed.

## Decision

1. The web cleanup sends the selection in batches of at most 100 memories, one request each, one after another. A batch holds one section. A category of up to 100 memories stays in one batch.
2. The web app runs the batches as a background job per user, as Clean up categories does. The dialog polls the job. The job holds the finished result until Apply, Back, a new start, or 30 minutes after it finished. Jobs live only in the running web app.
3. A failed batch leaves its memories unchanged, and the other batches continue. The job fails only when every batch fails. The dialog shows the error with Retry.
4. Apply edits the newest profile. It finds each memory of a ticked change by section, category, description and steps. It skips a change when one of its memories is gone. It changes no other memory. It saves with the version check and tries again up to three times.
5. The OpenCode automatic cleanup keeps its single call. A separate change removes it, so every host cleans up only through the reviewed dialog.

## Consequences

### Positive

- A cleanup of any size finishes, shows its progress and can be stopped.
- Apply works while learning saves, and saves only what the user reviewed.

### Negative

- Duplicates in different batches merge only on a second run.
- Apply replaces a merge target's counters with the merged memory's counters. A counter that learning raised during the run is lost.

### Neutral

- A web app restart drops a running job. Nothing is saved before Apply.

## Alternatives Considered

| Option                                         | Rejected Because                                                       |
| ---------------------------------------------- | ---------------------------------------------------------------------- |
| Raise the request time limits                  | Large selections outgrow any limit, and the user sees no progress      |
| The dialog loops over batches                  | The run stops when the tab closes, and the server must still join them |
| Keep refusing a result after a newer version   | Most large runs would end in "Profile changed"                         |
| Group batches by embedding similarity          | An extra step and failure mode; category order finds most duplicates   |
| Keep the full replacement and patch stale ones | Needs special cases for kept copies, counters and duplicates           |

## References

- [ADR-028: Every profile save checks the version it read](028-every-profile-save-checks-version.md)
- [TDR-051: AI Cleanup timed out on large selections](../tdr/051-ai-cleanup-timeout-on-large-selections.md)
- `openspec/changes/archive/2026-10-17-ai-cleanup-batching/`
