## Context

The Sessions card (`ImportSection.tsx`) polls `/api/settings/imports/current` every second while a job runs and renders `ImportResults`. That component prints state and counts as text. The app keeps one current job, so the card sees every job, preview or real. `HostRunDetails.tsx` already draws a progress bar for backfill runs, and `web/src/lib/components/ui/dialog.tsx` exists. A failed unit sets `child.row.error` in `src/importer/web-import-group.ts` to "<Host>: Memory work failed. Refresh the preview and retry."

The page translates server messages by exact text. `importFeedback` in `ImportResults.tsx` strips the host prefix and looks the rest up in the language table. A message that contains a number finds no entry and shows in English.

The import ledger holds two kinds of rows per session. Memory units use the unit key. Profile prompts use the unit key plus `#profile` (or `#profile-rebuild` for a forced re-analysis), with `project_hash = 'profile'`. Both kinds store the session id in `session_id`. List rows use a different key: the OpenCode session id, or the Pi or Claude Code file path.

## Goals / Non-Goals

**Goals**

- A visible running state, a clear end state, and a way to continue (OK reloads data).
- Honest failure wording that says what was saved and what a retry does.
- A session list that shows only work still to do for the ticked outputs.

**Non-Goals**

- No change to job states, the ledger tables, retry rules, or model calls. The HTTP API gains only additive optional fields.
- Failed units do not become "partial success". The run stays failed and later hosts do not start.
- No time-left estimate here. The existing `import-progress` requirement covers backfill runs.

## Decisions

1. **Bar source.** Use fields the job already returns: the active child's `processed` and `total` in the memory phase, and `profileProcessed` and `profileTotal` in the profile phase. Label them separately so a memory percentage never reads as group progress. Hide the bar for `dryRun`. A small pure function turns a job into `{ host, phase, done, total, percent }` or null, so it is easy to test.
2. **End detection.** Keep the previous job in a ref. A transition from a running state to done, failed, or cancelled for the same job id, while mounted, opens the dialog. A real job already finished at mount opens the banner. A pure function `classifyEnd(previous, current, mounted)` returns "dialog", "banner", or "none".
3. **Dismissal memory.** Store the last dismissed job id in `localStorage` under a fixed key, inside try/catch. If storage fails, the banner shows once per page load. This is a per-viewer convenience, not shared state.
4. **Reload without full reload.** On OK, call `reloadSettingsSnapshot()` from `settings-api.ts` and re-read the current job. `reloadSettingsSnapshot()` is the existing refresh after a settings change. It publishes the snapshot to every `onSettingsSnapshot` listener: `ImportSection` reloads readiness, `useBackfill` reloads the host rows, and `useHostStatuses` reloads host readiness. Do not call `location.reload()`. The draft, including lists and selection, stays. No new refresh hook is needed (task 1.3).
5. **Dialog.** Use `ui/dialog.tsx` with one OK button focused by default. Failed runs use the same dialog with a danger style. Cancelled runs use an inline neutral message.
6. **Failure wording (fixed text, count shown apart).** The server message stays fixed text with no number, so the existing exact-text lookup translates it. Memory failure: "<Host>: Some memory units failed. Completed work is saved. A new preview and import retries only the failed units." Profile failure: "<Host>: Profile learning failed. Completed memory work is saved. Refresh the preview and retry." The dialog shows the count on its own line, "Failed memory units: N", from the child's `summary.unitsFailed`. That label is fixed text too. Each language table gets one entry per new sentence. The server never builds a sentence around a number, so no plural rules are needed. A per-language sentence builder (option 3b) was rejected: it needs plural rules per language, including six forms in Arabic, for the same result on screen.
7. **Emoji.** The English source string contains 🎉. Other languages use their own strings without it. Fall back to English only when a translation is missing.
8. **Handled sessions (ledger only, per output).** Add `ImportLedger.handledSessionIds(sessionIds, outputs)`, where `outputs` is `{ memories, profile }`. It opens the ledger read-only like `peek` and never creates the file or table. A missing file or table returns an empty set. It reads the rows for the given session ids and splits them by kind: `project_hash = 'profile'` is a profile row, any other value is a memory row. For each ticked output, a session passes when it has at least one row of that kind and every row of that kind is imported or skipped. A session is handled when it passes for every ticked output. With no output ticked, no session is handled. A full unit count (option 1b of the earlier review) was rejected because it reads every transcript on each listing.
9. **Lookup key.** The lookup uses each list row's `sessionId`, not its `key`, because Pi and Claude Code keys are file paths. A row with a null `sessionId` is never handled.
10. **Listing.** The list request carries `skipMemories`, `skipProfile`, `force`, and `includeHandled`. `includeHandled` is true when the checkbox is on or when `force` ("Re-analyse handled history") is on. `listImportSessions` sets `handled` on each matching row, then removes handled rows unless `includeHandled` is true, and only then pages. `total` counts the rows that stay. The page reports `hiddenHandled`. Unresolved rows are never handled. The revision hash stays based on all matching keys, so the revision does not depend on the outputs or the checkbox.
11. **Selection.** The server rebuilds an "all" selection itself in `resolveImportSelection`, so the page cannot exclude hidden keys. The "all" selection carries `includeHandled`, and `resolveImportSelection` drops handled sessions with the same lookup and the job's outputs unless it is true. An "ids" selection contains only rows the user saw, so it needs no filter. Changing the ticked outputs, the checkbox, or "Re-analyse handled history" reloads the list and clears the selection, as a scope change does now in `import-draft.ts`.

## Risks / Trade-offs

- **Stale last job.** After a restart the app may return the last finished job at once. The dismissal memory stops it showing forever, at the cost of one banner after the first open.
- **Banner and dialog both firing.** `classifyEnd` returns one result, so they never show together.
- **Polling gap.** The page polls once a second, so a very short run may end between polls. The mount-time banner covers that case.
- **Handled is a hint.** Ledger rows exist only for units already reached. A session where the run stopped before its later units shows as handled if its earlier rows are all done. A session that gained turns after import can also look handled. Preview is the source of truth for pending work, and "Show handled sessions" exposes every row.
- **No rows for an output.** A session with nothing to learn for an output (for example, every prompt is private) never gets a row of that kind, so it stays listed. This costs a row on screen and never causes a wrong import.
- **Profile handled means prompts collected.** Profile rows record that a prompt was saved. The profile batches that follow run for all sessions together and have no per-session row. This is the same test a profile preview uses.
- **Handled state changes between listing and import.** `resolveImportSelection` reads the ledger again. A session that became handled in between is dropped, and the importer would have skipped its units anyway. The ledger never moves an imported or skipped row back without `force`, and `force` includes handled sessions.
- **File size.** `ImportSection.tsx` has 476 lines and the cap is 500. New code goes in new files and the section only imports them.

## Open Questions

- None.
