## 1. Host state and action

- [x] 1.1 Write failing tests for `hostStatus()` and `cardLine()`: a finished run reads Running with Pause, a never-run host reads Running with Pause, a paused host reads Paused with Resume, a failed host reads Retry, a stopped run with pending work reads Stopped with Resume. Confirm they fail on current code.
- [x] 1.2 Change `web/src/lib/components/memory/host-status.ts` to the new rules. Drop the `done`, `idle` and `run` cases.
- [x] 1.3 Update `HostStatusHeader.tsx` for the new action kinds and labels. Remove the **Run now** label and the unused `STATE_LABEL` entries.
- [x] 1.4 Update `HostCard.tsx` for the `Running · last import <date>` line.
- [x] 1.5 Update `web/src/lib/i18n/settings.ts`: add the new strings, remove unused ones, keep every language table in step.

## 2. Reload restore rule

- [x] 2.1 Write a failing test for `restorableJob()`: it returns active jobs and returns `null` for done, failed and cancelled jobs. Confirm it fails before the function exists.
- [x] 2.2 Add `restorableJob()` to `web/src/lib/components/memory/import-job-view.ts`.
- [x] 2.3 Apply it to the job loaded on mount in `ImportSection.tsx`. Leave a job that ends on the page in state so the finish dialog still opens.

## 3. Verify and document

- [x] 3.1 Resolve the open question: `autoBackfill: false` is left as a follow-up. The spec has no scenario for it, and this change does not alter that case.
- [x] 3.2 Update the guides that name **Run now**: `docs/web-ui-memory.md`, `docs/web-ui.md`, `docs/web-ui-settings.md`, and the three history-import guides. Check `docs/README.md` needs no change.
- [x] 3.3 Run `bun run ci:local` and `openspec validate auto-import-live-state --strict`.
- [x] 3.4 Browser check at 1280 px and 390 px: Running with Pause, pause then Resume on an idle host, reload after an import finished shows no results panel.

## 4. Ignore and Ignore all feedback (restores specified behaviour; no spec change)

- [x] 4.1 Write failing tests: a failed save keeps the Ignore all dialog open with the reason, and a refused save says so. Confirm they fail on the old code.
- [x] 4.2 In `DirectoryMapsSection.tsx`, close the Ignore all dialog only after a successful save, and show a message when a save is refused because the list is not ready.
- [x] 4.3 Make the synthetic preview server store `importIgnoredDirectories` and hide those directories, so Ignore can be checked in the browser.
- [x] 4.4 Browser check in the preview: Ignore all clears every row and closes the dialog; a single Ignore removes its row.
