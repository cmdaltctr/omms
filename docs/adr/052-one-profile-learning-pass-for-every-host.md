# ADR-052: One profile learning pass for every host

- **Date:** 2026-11-18
- **Status:** Proposed
- **Deciders:** OMMS maintainer
- **Change:** [`unify-profile-learning`](../../openspec/changes/archive/2026-11-18-unify-profile-learning/proposal.md)

## Context

Live profile learning builds the user profile from recent prompts. Before this change each host had its own loop:

- OpenCode ran an 824-line loop in `src/adapters/opencode/profile-learning.ts`. It sent a rich input, decayed old items before each merge, could check older items, and called the external API through a tool call whose reply nobody checked.
- Pi kept its batch in memory and called `analyzeProfile` with numbered prompts only. It skipped learning without a user email and did not wait after three save conflicts.
- Claude Code read the prompt store, called `analyzeProfile`, skipped learning without a user email, and paused while a catch-up run was active.

The same prompts gave a different profile on each host. This broke the host parity rule in `CLAUDE.md`, and the user could not see or change the differences. The modularity inventory (`openspec/changes/modularity-follow-ups/design.md`, "Task 2.1 inventory") lists 16 steps where the loops differed. The user chose one behaviour for each step.

## Decision

1. **One pass in shared core.** `runProfileLearningPass` in `src/core/profile-learning/pass.ts` runs every live pass. It skips trivial prompts, claims a batch, builds the model input, calls the model, checks the reply, merges, saves, marks the prompts learned, starts the automatic cleanup when due, and sends the notice. Adapters keep only the trigger, the model port and the notice display.
2. **No host names in the pass.** The host picks the label from `HOST_INFO` and the host field of the failure log record. The config comes in as an argument, so `src/core/` does not import `CONFIG`.
3. **One prompt source.** The pass reads waiting prompts from `user-prompts.db` on every host. Pi records each settled prompt there, as the other hosts do.
4. **Batch claims.** A pass claims its batch with `getPromptsForUserLearning(limit, { claim: true })`. It marks the prompts learned on success and releases the claim on failure. A claim expires after 10 minutes. A live pass and a catch-up run therefore never analyse the same prompt.
5. **One model call path.** `analyzeProfile` uses `completeStructured` when the port has it, and `complete` otherwise. It checks every reply against the shared schema, and a failed check gives the reason `invalid-reply`.
6. **One fallback.** `withExternalFallback` in `fallback.ts` wraps a host model. When the host model throws and the external API is ready, it shows "Using fallback provider" and repeats the call through the external API.
7. **New defaults, the same on every host.** Learn without a user email into the profile `unknown`. No decay before the merge. The full model input. The check of older items off. The notice on. Keep learning during a catch-up run. Three save attempts, then a 10-minute wait.
8. **Six global settings.** `userProfileWithoutEmail`, `userProfileDecayBeforeMerge`, `userProfilePromptDetail`, `userProfileValidationEnabled`, `showUserProfileToasts` and `userProfileDuringCatchUp`. A project config cannot set them. The Memory page shows them in one table with **Reset to default**.
9. **The pass starts the cleanup.** `pass.ts` becomes the one caller of `startAutoProfileCleanup`. The adapter can pass a `cleanupModel`.

## Alternatives Considered

| Option                                                     | Rejected Because                                                                                                     |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Extend `drainProfileBacklog` to serve live passes          | It loops until the queue is empty and owns the catch-up lease hooks. A live pass takes one batch.                    |
| Keep Pi's in-memory batch behind a "prompt source" port    | Pi would lose its batch at every restart, would not see claims, and a catch-up run would never see Pi prompts.       |
| Serialise live and catch-up batches through `CatchUpLease` | `beginBatch` makes the caller the newest owner, so a live pass would stop the catch-up run.                          |
| Per-host settings                                          | The user asked for the same behaviour on all three hosts. Per-host settings would bring the differences back.        |
| Keep OpenCode's defaults (decay on, email optional)        | The user chose each default. Decay stays one setting away, and the daily automatic cleanup still removes weak items. |

## Consequences

### Positive

- The same prompts and settings give the same profile on every host.
- Every external reply is checked before the merge.
- Pi keeps its waiting prompts across restarts, and a catch-up run sees them.
- Two runs never pay for the same prompts twice.

### Negative

- OpenCode users lose decay by default. Old items no longer fade at learning time. The daily automatic cleanup and the stale rules still remove weak items.
- A user with no email gets a profile named `unknown`. A later email starts a second profile. The Profiles card merges them.
- The full input is larger than the numbered prompts that Pi and Claude Code sent before, so each call costs more. The byte cut caps it at `userProfileMaxContextBytes`, and `prompts-only` is one setting away.

### Neutral

- The catch-up run and history imports keep `drainProfileBacklog` and their numbered-prompt input.
- The extra `user_learning_claimed_at` column is harmless to older code on rollback.

## References

- [Using memory: User profile](../using-memory.md#user-profile)
- [Shared core: Profile learning](../shared-core.md#profile-learning-srccoreprofile-learning)
- [ADR-030: The profile cleans itself up on every host, with a restore record](./030-profile-cleanup-runs-on-every-host.md)
- [ADR-050: One host registry, and ratchets on modularity debt](./050-one-host-registry-and-modularity-ratchets.md)
- `src/core/profile-learning/pass.ts`, `tests/profile-learning-pass.test.ts`, `tests/profile-learning-characterisation.test.ts`
