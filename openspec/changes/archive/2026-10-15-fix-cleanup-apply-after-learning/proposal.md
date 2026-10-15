# Proposal

## Why

A category cleanup preview takes about 30 minutes on a large profile. Profile learning saves a new profile version about every 5 minutes. Apply refuses when the version moved after the preview started, so on a busy profile Apply fails every time, and so does each rebuilt preview. The same happens in `om-memory-system profile-cleanup-categories --yes`, which previews and applies in one run.

## What Changes

- Apply renames the accepted labels on the profile as it is stored at apply time. It no longer needs the profile to be unchanged since the preview.
- Apply still saves with a compare-and-set on the version it read in the same call. If a save lands during that write, Apply fails with a message to try again.
- Remove `version` from the apply request and from the preview payload. Nothing else reads it.
- Change the "Profile changed" message for the remaining write race.
- Update the web dialog, CLI, docs and tests to match.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `profile-category-cleanup`: the requirement "Applying a cleanup only renames categories" no longer fails when the profile changed after the preview. It fails only when a save lands during the apply write.

## Impact

- `src/services/user-profile/category-cleanup.ts` (`applyCategoryCleanup`, `CategoryCleanupPreview`)
- `src/services/api-handlers.ts` (`handleCategoryCleanupApply` message)
- `src/cli/profile-cleanup-categories-command.ts`
- `web/src/lib/components/explorer/CategoryCleanupDialog.tsx`
- `tests/category-cleanup-api.test.ts`, `tests/category-cleanup-service.test.ts`
- `docs/using-memory.md`, `docs/cli.md`, a new TDR
- Both hosts share this code, so Pi, OpenCode and Claude Code behave the same. No config or storage change.
