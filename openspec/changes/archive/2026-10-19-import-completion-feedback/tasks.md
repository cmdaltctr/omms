## 1. Tests first and groundwork

- [x] 1.1 Write failing tests for the bar function: memory phase, profile phase, preview returns null, no active child returns null
- [x] 1.2 Write failing tests for `classifyEnd`: running to done opens a dialog, finished at mount gives a banner, same job twice gives none, a dismissed job gives none, cancelled gives none for the dialog
- [x] 1.3 Find the existing refresh the page uses after a settings change and record it in `design.md` Decision 4
- [x] 1.4 Write failing tests for the failure messages: memory failure gives the fixed sentence with no number, profile failure gives its fixed sentence, neither contains model text, and `importFeedback` translates both in a non-English language
- [x] 1.5 Write failing tests for `handledSessionIds`: memory-only, profile-only, and both outputs; all rows imported or skipped is handled; one failed or in-progress row is not; no row of a ticked kind is not; no output ticked gives none; a missing file or table gives none and creates nothing
- [x] 1.6 Write failing tests for the listing: lookup by `sessionId` for all three hosts, a null `sessionId` is never handled, handled rows hidden by default with `hiddenHandled`, `total` and pages count shown rows only, `includeHandled` and `force` keep them, and hiding does not change the revision
- [x] 1.7 Write failing tests for `resolveImportSelection`: an "all" selection drops handled sessions for the job's outputs, and keeps them when `includeHandled` is true
- [x] 1.8 Write a failing web test: the checkbox shows handled rows marked, Select all matching counts only shown rows, and changing outputs, the checkbox, or Re-analyse reloads the list and clears the selection

## 2. Implementation

- [x] 2.1 Add the bar function and a `ImportProgressBar` component, and show it in the Sessions card for real runs only
- [x] 2.2 Add `classifyEnd` and the dismissal memory with safe storage access
- [x] 2.3 Add the finish dialog (success, failed, with the failed-unit count line) and the cancelled inline message; OK reloads data and keeps the draft
- [x] 2.4 Add the return banner with a dismiss control
- [x] 2.5 Change the failure message text in `src/importer/web-import-group.ts` to the fixed sentences in Decision 6
- [x] 2.6 Add `ImportLedger.handledSessionIds(sessionIds, outputs)`
- [x] 2.7 Add the outputs, `force`, and `includeHandled` to `validateSessionListRequest` and `web-server.ts`, and the `handled` and `hiddenHandled` fields to `listImportSessions`
- [x] 2.8 Add `includeHandled` to the "all" selection and the handled filter to `resolveImportSelection`
- [x] 2.9 Add the "Show handled sessions" checkbox to `ImportOptions.tsx` (one shared option for every host), the handled mark and the hidden-count line to `HostSessionSelection.tsx`; send the outputs and options with each list request; clear the selection on change in `import-draft.ts`
- [x] 2.10 Add the new strings to every language table; the 🎉 stays in English only

## 3. Verify

- [x] 3.1 Confirm each new test fails when its code is broken, then passes
- [x] 3.2 Check the card in the browser with synthetic data at 1280 px and 390 px: running bar, success dialog, failed dialog, banner, empty list after a finished run, Show handled sessions, dark and light
- [x] 3.3 Update `docs/web-ui-memory.md`: the bar, the dialog, the banner, the failure wording, and "Show handled sessions" with the per-output rule
- [x] 3.4 Run `bun run ci:local` and `openspec validate import-completion-feedback --strict`
