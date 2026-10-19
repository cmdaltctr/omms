## Why

A real import in the Memory page gives no clear sign that it is running or finished. The user must read a line of small print, such as "Pi · done · Profile batches: 2/2", to learn the result. A failed unit also marks the whole run "failed" with the text "Memory work failed. Refresh the preview and retry.", which hides that most work was saved.

## What Changes

- A real import (not a preview) shows a progress bar on the Sessions card while it runs. It shows the active host, its phase (memory units or profile batches), and the done count.
- When a real import ends, a dialog opens if the user is on the page. A successful run says "Import successful 🎉" with a short count line. A failed run says what failed and what to do next. A cancelled run shows a neutral message and no dialog. The user clicks OK, and the page reloads its import data without a full browser reload. The user's selection stays.
- If the user was away, a banner shows the same result when they return, until they dismiss it.
- A run that ends with failed memory units shows a fixed message: some memory units failed, completed work is saved, and a new preview and import retries only the failed units. The dialog shows the failed count on its own line, from the run's counts. The run state stays "failed", so later hosts still do not start.
- The 🎉 appears in the English text only.
- The session list hides sessions that are already handled for the outputs the user ticked. With only Project memories ticked, a session is handled when every memory row in the import ledger for it is imported or skipped. With only User profile ticked, the same test applies to its profile rows. With both ticked, both must pass. A checkbox, "Show handled sessions", brings them back. "Re-analyse handled history" also shows them. After a finished run, the list is empty or near empty. The check reads the ledger only, not the transcripts.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `import-progress`: add the Sessions card progress bar, the finish dialog, and the return banner.
- `multi-host-import`: add the wording rule for runs that end with failed units, and the rule that hides handled sessions from the session list.

## Impact

- `web/src/lib/components/memory/`: `ImportSection.tsx`, `ImportResults.tsx`, `HostSessionSelection.tsx`, `import-draft.ts`, `import-types.ts`, and new files for the bar and the finish dialog.
- `web/src/lib/i18n/settings.ts`: new strings for every language.
- `src/importer/web-import-group.ts`: failure message text only. States and ledger rules do not change.
- `src/importer/ledger.ts`: a read-only per-session handled lookup, split by output.
- `src/importer/import-sessions.ts`: a `handled` flag on each listed row, the outputs and `includeHandled` in `validateSessionListRequest`, and the same filter in `resolveImportSelection`.
- `src/services/web-server.ts`: pass the new list fields through.
- `docs/web-ui-memory.md`: describe the bar, the dialog, the banner, and "Show handled sessions".
- HTTP API: additive optional fields only. The session-list request gains the ticked outputs and `includeHandled`. Each row gains `handled`, and the page gains `hiddenHandled`. An "all" selection gains `includeHandled`. Existing callers keep working. No change to the ledger tables or model calls.
