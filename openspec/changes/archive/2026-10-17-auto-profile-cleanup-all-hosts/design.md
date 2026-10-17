# Design

## Context

See `proposal.md` for the motivation. What exists today:

- **OpenCode** (`src/adapters/opencode/profile-learning.ts`) runs `runAutomaticProfileCleanup` after a learning pass when the prompt count passes a multiple of 100. It awaits the run inside the learning pass. It calls `aiCleanupProfile`, which sends the whole profile in one request, and it saves the result with no review.
- **Pi** (`src/adapters/pi/profile.ts`) and **Claude Code** (`learnProfile` in `src/importer/claude-hook-api.ts`) save learning with `saveMergedProfile` and have no cleanup. Claude Code learning runs inside the web app and has no host model, only the external API.
- Only OpenCode calls `registerHostProfileModel`. In a Pi process `callAICleanup` finds no host model, so it would use the external API or fail.
- All hosts share one profile and one counter, `totalPromptsAnalyzed`. A save that crosses a multiple of the interval happens on one host only.
- ADR-029 added `splitIntoBatches`, `runInBatches`, `selectForCleanup` and `applyCleanupEdits`. The dialog job map (`ai-cleanup-job.ts`) holds a finished result for review.
- Category cleanup stores a diff in its own table (`category-cleanup-store.ts`) and undoes by reversing it. The profile changelog keeps 5 versions and is not enough.
- `tests/file-size-ceiling.test.ts` lists `claude-hook-api.ts` (609) and `web-server.ts` (1826) at their current size. They must not grow.

## Goals / Non-Goals

**Goals:**

- One shared run for all three hosts. A host adds a trigger and, for Pi, its model.
- A way back that keeps what learning added after the run.
- No change to learning, capture or the manual memory tool when a run fails.

**Non-Goals:**

- Undo for the manual dialog. The record format allows it later.
- Cleaning only the categories that changed.
- A change to the batch size, the prompt or the 60-second call limit.

## Decisions

### 1. A separate run, not the dialog job

`startAutoProfileCleanup` in `src/services/user-profile/auto-cleanup.ts` splits the whole profile into batches, runs them with `runInBatches`, applies every proposed change and stores a restore record. It does not use the dialog job map. A job in that map shows in the dialog as a run to review, and a manual start would return it. A module flag allows one run at a time in a process. The host does not wait for it, and an error is logged with a reason code and nothing else.

- **Alternative: reuse the dialog job and auto-accept.** Rejected. The dialog would show "Batch X of Y" for a run the user did not start, and Stop and review would be wrong for it.

### 2. The trigger is a pure function, called by each host

`shouldStartAutoCleanup(previous, added, settings)` takes the two settings as arguments, as `live-model-choice.ts` does. OpenCode, Pi and Claude Code call it after a successful live save, with `previous` read from the profile they saved. It is not placed in `saveMergedProfile`, because history import, backfill and catch-up also use that function and would start many runs.

- **Alternative: a timer in the web app.** Rejected. Pi and OpenCode run without the web app, and a timer would need its own count.

### 3. Pi and Claude Code pass their model

`callAICleanup(prompt, model?)` uses `model` first when it is given. The run takes an optional `resolveModel`, and `runInBatches` receives a `callBatch` bound to it. Pi passes the resolver it uses for learning. Claude Code passes the external model that its learning pass resolved, so cleanup and learning use the same provider settings. OpenCode passes nothing, because it has the registered host model.

### 4. The whole profile, every time

The run sends every item, as the OpenCode run does. On the live profile that is about 23 calls and 6 minutes on `deepseek-flash`, about 160,000 input and 140,000 output tokens, every 500 prompts by default. The first run on a profile that was never cleaned finds the most duplicates. Later runs find few.

- **Alternative: only categories that learning touched since the last run.** Cheaper, but it needs a per-item change time and a stored last-run time. Left for a later change if the cost matters.

### 5. Apply and save: one helper for three callers

Manual Apply, the automatic run and Undo each load the newest profile, change it, save with the version check and try again up to three times. That is the third use, so a helper `applyToNewestProfile(userId, edit, options)` in `profile-edit-save.ts` holds the loop. `edit` and the `beforeSave` option receive the profile record that was read, so the run can store its restore record with the right profile id and prompt count. `handleAiCleanupApply` moves onto it, with its tests unchanged.

`applyCleanupEdits` already finds items by identity. It also returns `restore` entries: for a merge, the original items and the merged item written; for a removal, the original item. The automatic run accepts every change.

### 6. The restore record holds the changed items

A new table `profile_auto_cleanups` in `user-profiles.db`: `id`, `profile_id`, `created_at`, `prompts_analyzed`, `merged`, `removed`, `entries` (JSON), `undone_at`. The run inserts the row before the save and deletes it when the save fails. A run that applies nothing inserts nothing. Rows older than 30 days are deleted when the table is read or written.

- **Alternative: a copy of the whole profile.** Rejected. The profile is large and learning saves several times an hour, so restoring a copy would throw away later learning. This is the reason the proposal says "a copy of the profile" in plain words and the design stores only what changed.
- The rows hold profile text, as the profile does. They stay in the profile database, never in a project folder, and the log never gets their text.

### 7. Undo reverses the edits

`undoCleanupEdits(current, entries)` is pure. For a merge it finds the merged item by identity, removes it, and puts the originals back. For a removal it puts the original back. It counts a change as not found when the merged item is gone or changed, or when an original is already in the profile. It marks restored items as claimed, so one item serves one change and a restored original is never taken as the merged item of a later change.

The identity of an item is its section, the key of its category (`categoryKey`), its description and its steps. The key ignores case, spacing, hyphens and underscores. Every save runs `canonicaliseCategories`, which keeps one spelling for each category and may rewrite a stored item, so an exact comparison missed items that a save had rewritten. Apply uses the same identity, which also helps manual Apply when a save lands during a run. The save uses `applyToNewestProfile`, and the row gets `undone_at` after a good save.

### 8. A fixed log code when no model is set

`failureReason` returns `no-provider` when neither a host model nor an external API is set, so the log says why a run did nothing. The code list in `profile-ai-cleanup` gains it.

### 9. A safety limit on the size of a run

When the proposed changes would remove or merge away more than 25% of the items sent, the run applies nothing and logs the reason code `too-many-changes`. Live runs on the real profile changed about 0.5% to 1% of the items. A wrong reply that drops most of the profile is the case this stops. The user can still run AI Cleanup by hand, which shows the changes first.

### 10. Web API and Profile page

- `GET /api/user-profile/auto-cleanup` returns the newest row that is not undone: `id`, `createdAt`, `merged`, `removed`. It returns `null` when there is none.
- `POST /api/user-profile/auto-cleanup/undo` undoes that row and returns `restored` and `notFound`.
- A new `src/services/profile-cleanup-routes.ts` handles these routes and the existing `ai-cleanup` routes. `web-server.ts` replaces its `ai-cleanup` lines with one call, so it does not grow.
- `AutoCleanupUndo.tsx` shows the button in the Profile page header while the GET returns a row. It opens a confirmation dialog. A small hook reads the row again after Undo and after the profile reloads. `ProfileView.tsx` gains a few lines.

### 11. Remove the old OpenCode path

`runAutomaticProfileCleanup`, `shouldRunAutomaticProfileCleanup` and `aiCleanupProfile` go. No production caller remains for `aiCleanupProfile`. Its test cases move onto the shared run and the batch code, and the PR description lists each case that changed. `learnProfile` moves from `claude-hook-api.ts` to `src/importer/claude-profile-learning.ts` with no change except the added call, and the ceiling for `claude-hook-api.ts` drops. ADR-030 supersedes decision 5 of ADR-029.

### 12. The Memory page holds the switch and the interval

The Profile learning card of the Memory page (`memory-section-profile`) gets an `AutoCleanupSettings` block under the catch-up controls. It follows `AutoImportSection`: it reads the settings snapshot, saves through `PATCH /api/settings` with the snapshot revision, and shares the new snapshot with the other sections. Both keys join the editable and global-only lists of `settings-snapshot.ts` and the key list and validation of `global-config-writer.ts`. `initConfig` drops the project values, as it does for `autoBackfill`, so the page never shows a value that the hosts do not use. The pure form rules (what the field accepts, the message, the edit to send) sit in `auto-cleanup-settings-state.ts`, which the root tests cover. The default interval in `config.ts` and its template change to 500.

- **Alternative: the Settings page.** The Profile learning controls (catch-up, re-analyse) already live on the Memory page, so the switch sits with them.
- The server refuses an interval below 50 or above 100000, so the rule holds even for a client that is not the page.

## Risks / Trade-offs

- [The model removes or merges something it should keep, and no one reviews it] → The restore record for 30 days, the 25% limit, and the rule that a changed item is skipped.
- [Undo cannot find a merged item, because a later category cleanup renamed it or a save rewrote its label] → It reports "not found" and restores the rest. A save may rewrite a category spelling, so items match by the key of the category. A later rename of a category to another name is still not found.
- [A host process ends in the middle of a run] → Nothing is saved before the end, so the profile stays as it was. The next multiple of the interval tries again.
- [Cost: about 24 calls every 500 prompts, and a rate-limited key may fail them] → A failed batch changes nothing. The default interval is 500, because each run is paid for. The run can be turned off, and the interval changed, on the Memory page. A later change can narrow the scope.
- [Two hosts cross the same multiple at once] → The shared counter makes this rare. The version check and the identity match make the second run skip what the first one already changed.
- [A reasoning model takes more than 60 seconds a batch] → The batch fails and nothing changes. `docs/web-ui.md` already says how to turn reasoning off.
- [Default on changes Pi and Claude Code for existing users] → Stated in the proposal and the release note. The setting is `userProfileAutoCleanupEnabled`.

## Open Questions

These need an answer before apply. Each has a default in this design.

1. Interval: 500 analysed prompts on all hosts, changeable on the Memory page from 50 to 100000. The floor of 50 stops a value that would run a paid cleanup after almost every learning pass. A file edit is not limited by the floor. Decided by the maintainer.
2. Scope: the whole profile each run. Default: keep.
3. The size limit: 25% of the items sent. Default: keep.
4. How long a record can be undone: 30 days. Default: keep.
5. Default on for Pi and Claude Code. Decided by the maintainer: on, with a switch on the Memory page.
