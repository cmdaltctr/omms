# Proposal

## Why

Only OpenCode cleans up the profile by itself. Every 100 analysed prompts it sends the whole profile to the model in one request and saves the answer with no review. Pi and Claude Code never do this, so their profiles keep their duplicates until the user runs AI Cleanup by hand.

The OpenCode run has two faults. It sends about 2,000 items in one request, and the external API call stops after 60 seconds, so it fails and leaves only a log line. It also has no way back: AI Cleanup has no undo, and the profile keeps only its last 5 versions, which learning fills within hours.

The user wants all three hosts to clean up the profile by themselves, with a safety net.

## What Changes

- **All three hosts** run an automatic cleanup after live profile learning, every 500 analysed prompts by default (it was 100 on OpenCode). The interval and the on/off setting are `userProfileAutoCleanupInterval` and `userProfileAutoCleanupEnabled`. The setting is on by default, so Pi and Claude Code start cleaning up after they update. A run makes about one model call for every 100 items, so a longer interval keeps the cost down.
- The **Memory page** gets the two controls in its Profile learning card: a switch and the interval. Saving uses the same safe global save as the other settings. A project config cannot override them.
- The run uses the **batched cleanup** that the AI Cleanup dialog uses (ADR-029), so no single request is too large. It runs in the background and never blocks learning or capture.
- The run **saves every merge and removal the model proposes**, into the newest profile, with the version check (ADR-028). A change whose items learning altered in the meantime is skipped.
- Before the run changes anything, OMMS stores a **restore record**: the items the run merged or removed, as they were stored, and the merged item it wrote. It does not store the whole profile, so an undo keeps what learning added later.
- The Profile page gets an **Undo last automatic cleanup** button. It shows only while a restore record exists. Undo puts the original items back and removes the merged item. A confirmation dialog says what will change.
- The old OpenCode-only cleanup (`runAutomaticProfileCleanup` and the single-call `aiCleanupProfile`) is **removed**. OpenCode uses the shared run.
- Pi passes its own model to the run, because only OpenCode registers a host model for cleanup today. Claude Code passes the external model that its learning pass used.

Out of scope:

- Undo for the manual AI Cleanup dialog. The restore record is built so a later change can reuse it.
- Running only on the categories that changed since the last run. Each run covers the whole profile, as the OpenCode run does today.

## Capabilities

### New Capabilities

- `profile-auto-cleanup`: when the automatic cleanup runs on each host, how it saves, the restore record, and the undo.

### Modified Capabilities

- `profile-ai-cleanup`: the log gets the reason code `no-provider`, and Apply and Undo treat two spellings of one category as the same category. The batching and the job are reused as they are. The version check and label rules in `profile-learning` still apply to the save.

## Impact

- Shared code: new `auto-cleanup-trigger.ts`, `auto-cleanup.ts` (the run), `auto-cleanup-store.ts` (restore records), `ai-cleanup-undo.ts` and `profile-edit-save.ts` (the save loop that Apply, the run and Undo share). `ai-cleanup-apply.ts` returns what it changed and matches a category by its key. `callAICleanup` and `cleanupBatch` accept an optional model.
- Hosts: `src/adapters/opencode/profile-learning.ts` shrinks. `src/adapters/pi/profile.ts` calls the run. Claude Code's `learnProfile` moves out of `src/importer/claude-hook-api.ts`, which sits at its size ceiling, into its own file and calls the run.
- Web API: `GET /api/user-profile/auto-cleanup` returns the newest restore record. `POST /api/user-profile/auto-cleanup/undo` undoes it. A new `profile-cleanup-routes.ts` serves these and the AI Cleanup routes, so `web-server.ts` gets shorter.
- Web UI: a new Undo button and confirmation on the Profile page, and the switch and interval in the Profile learning card of the Memory page, with English, Chinese and Arabic text.
- Config: the default of `userProfileAutoCleanupInterval` changes from 100 to 500. Both keys become page-editable and global only.
- Storage: one new table in `user-profiles.db`. It is created on first use, as for category cleanup.
- Docs: `docs/configuration.md`, `docs/web-ui.md`, a new ADR (it supersedes decision 5 of ADR-029), and the host guides.
- Cost: a run covers the whole profile. On the live profile (about 2,260 items) one run is about 24 model calls, about 6 minutes on `deepseek-flash`, every 500 prompts by default.
- **BREAKING for Pi and Claude Code users:** the profile now changes without a review. The restore record is the way back.
