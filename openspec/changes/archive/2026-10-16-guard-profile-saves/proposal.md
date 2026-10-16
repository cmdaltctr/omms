# Proposal

## Why

On 2026-10-13 a smart category cleanup renamed 510 items. Eight minutes later a Claude Code learning run saved a copy of the profile that it had loaded at 09:48, 33 minutes before the cleanup, and the renames were lost. `updateProfile` checks the stored version only when the caller passes one, and 12 of the 14 save points do not pass one. Any slow writer can therefore overwrite newer work without notice. A second cleanup on 2026-10-16 also applied 284 groups that the model never checked, because the review dialog ticks every group by default.

## What Changes

- Every profile save passes the version it read. `updateProfile` requires the expected version, so the compiler rejects a save without one.
- When a learning save meets a newer version, learning loads the newer profile, merges the same model result into it again, and tries again. It does not call the analysis model again. After three failed attempts, the prompts stay unanalysed for a later run.
- Claude Code, Pi, OpenCode learning and the backlog catch-up use the same rule. OpenCode already has a retry loop and now passes the version to it.
- Background steps (confidence decay, automatic AI cleanup, learning paths) skip their save and log a code when they meet a newer version. They run again later.
- User actions (web item edit, AI cleanup apply, profile merge, normalise command) keep their existing "changed by another session" error, which now triggers in every case. The `memory` tool's profile add retries its merge like learning.
- The category cleanup dialog starts each group that the model did not check as unticked. The user can still tick it.
- New records: TDR-050 (the lost cleanup and its cause) and ADR-028 (every profile save is version-checked). TDR-044 gets a dated note with the 16 October recount.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `profile-learning`: adds a requirement that no profile save overwrites a newer version, and states how learning and other writers react to a conflict.
- `profile-category-cleanup`: the review requirement adds that groups not checked by the model start unticked.

## Impact

- `src/services/user-profile/user-profile-manager.ts`: `updateProfile` signature (`expectedVersion` becomes required).
- A new shared helper in `src/services/user-profile/` for "merge and save with retry".
- Save points: `src/importer/claude-hook-api.ts`, `src/importer/profile-backlog.ts`, `src/adapters/pi/profile.ts`, `src/adapters/opencode/profile-learning.ts` (3 points), `src/core/memory-operations.ts`, `src/services/api-handlers.ts` (3 points), `src/services/profile-admin.ts`, `src/cli/profile-normalise-categories-command.ts`.
- `web/src/lib/components/explorer/CategoryCleanupDialog.tsx` and its tests.
- Tests that stub `updateProfile` may need the extra argument.
- Docs: `docs/web-ui.md`, `docs/tdr/044-*.md`, new `docs/tdr/050-*.md`, new `docs/adr/028-*.md`, both indexes.
- No API, config or storage format change. More save conflicts become visible, so learning may spend extra merge time after a conflict. The per-process dedup cache limits repeated model calls.
