# Tasks

Build order: group 1 first (small). Groups 2, 3, 4 and 5 then run in parallel; they own different files. Group 6 starts when groups 4 and 5 are in, because it uses their modules. Group 7 can run any time after group 6's layout is settled. Group 8 is last.

Each group lists the files it owns. A group edits only its own files. Run a focused test with `bash scripts/run-tests-isolated.sh <file>`. Every bug fix starts with a test that fails on the old code; record the failing run in the pull request notes.

## 1. Shared scaffolding

Owns: `web/src/lib/i18n/import-status.ts`, `web/src/lib/i18n/import-flow.ts`, `web/src/lib/i18n/import-result.ts` (new, empty tables), the spread lines at the top of `web/src/lib/i18n/settings.ts`, `web/src/lib/components/memory/import-types.ts`.

- [x] 1.1 Create the three empty translation tables in the `spaces.ts` shape and spread them into the settings text in `i18n/settings.ts`; verify `tests/web-translations-parity.test.ts` and `bun run typecheck` pass
- [x] 1.2 Add `title?: string | null` to `SessionRow` in `import-types.ts`, and remove nothing yet; verify `bun run typecheck` passes

## 2. Status card and the Off state (bug fix, score 16)

Owns: `web/src/lib/components/memory/host-status.ts`, `use-host-statuses.ts`, `HostStatusHeader.tsx`, `web/src/lib/i18n/import-status.ts`, `web/tests/host-status.spec.ts`, `web/tests/fake-statuses.ts`, new `web/tests/host-status-header.spec.tsx`.

- [x] 2.1 Add failing tests to `web/tests/host-status.spec.ts`: with `autoImport: false` and no active run, `hostStatus` returns state `off`, action `turn-on`, and a sentence that does not contain "Automatic import is on"; `cardLine` reads `Automatic import off` and not `Running`; a running run while off still reads Running with Pause; paused, failed and stopped are unchanged. Run the file and record that the new tests fail
- [x] 2.2 Add `autoImport` to `HostStatusInput`, the `off` state and the `turn-on` action in `host-status.ts`; replace "Use Sessions below for newer chats" with a pointer to **Import new chats**; verify 2.1 passes
- [x] 2.3 Feed `autoImport` from `backfill.snapshot.settings.autoBackfill.globalValue` in `use-host-statuses.ts`; update `fake-statuses.ts`; verify existing memory view specs still pass
- [x] 2.4 In `HostStatusHeader.tsx` add the Off label, **Turn on** (saves `{ autoBackfill: true }` through `backfill.save`, with the note that it applies to every host), the status line `History imported up to {date} · {n} waiting · Automatic import on|off`, and the one-line difference between automatic import and **Import new chats**; verify in `host-status-header.spec.tsx` for each scenario of the status header requirement, including that **Turn on** sends `autoBackfill: true`
- [x] 2.5 Add every new string in English, Chinese and Arabic to `i18n/import-status.ts`; verify the parity test passes

## 3. Server: titles and help text

Owns: `src/importer/opencode-reader.ts`, `src/importer/import-sessions.ts`, `src/importer/import-readiness.ts`, the two `/import in OpenCode` keys in `web/src/lib/i18n/settings.ts`, `tests/opencode-reader.test.ts`, `tests/opencode-web-selection.test.ts`, `tests/import-readiness.test.ts`.

- [x] 3.1 Change the assertion in `tests/import-readiness.test.ts` ("names the terminal and /import") to expect `/memory-import-opencode-history`; run it and record that it fails
- [x] 3.2 Fix the sentence in `import-readiness.ts` and the two translation keys and their Chinese and Arabic text in `i18n/settings.ts`; verify 3.1 passes and the parity test passes
- [x] 3.3 Add a failing test in `tests/opencode-web-selection.test.ts`: an OpenCode session with title `Fix the login redirect` lists with that title; a title holding `<private>…</private>` lists without the private text; a 120-character title lists cut to 80; a Pi and a Claude Code row have no title
- [x] 3.4 Carry `title` through `OpencodeSessionMeta` and `readRows` into `ImportSessionRow`, applying `stripPrivateContent` and the 80-character cut in `import-sessions.ts`; verify 3.3 passes and `tests/opencode-reader.test.ts` still passes

## 4. Pure import logic

Owns: `web/src/lib/components/memory/import-draft.ts`, `import-model-blocker.ts`, `import-host-choice.ts`, new `import-checks.ts`, `import-estimate.ts`, `import-summary.ts`, `web/tests/import-scope-change.spec.ts`, `web/tests/memory-import-contract.spec.tsx`, new `web/tests/import-checks.spec.ts`, `web/tests/import-estimate.spec.ts`, `web/tests/import-summary.spec.ts`, `web/tests/import-model-line.spec.ts`.

- [x] 4.1 Write failing specs for `importEstimate`: 40 units plus 2 profile calls with a last Pi run of 60 units in 30 minutes gives 42 calls and 21 minutes; a run under 5 units or under one minute gives `minutes: null`; two hosts sum their rates; `nothingToImport` is true only when sessions, units, profile calls and skill turns are all zero
- [x] 4.2 Implement `import-estimate.ts`; verify 4.1 passes
- [x] 4.3 Write failing specs for `importSummary`: sums `unitsImported`, `profile.promptsRecorded` and `unitsFailed` over children; `failed` is true for failed units or a failed profile step; a group with no children reads the top-level summary
- [x] 4.4 Implement `import-summary.ts`; verify 4.3 passes
- [x] 4.5 Write failing specs for `defaultImportModel` and the model line text: Claude Code is always `external`; a Pi backfill `provider/model` listed in `readiness.opencode.models` is used; `inherit`, `external` and an unlisted model give `external`; the line names a second model only when the backfill model differs
- [x] 4.6 Implement them in `import-model-blocker.ts`; verify 4.5 passes
- [x] 4.7 Write failing specs for `importChecks`: each row's pass, fail, untested and unknown state; `blocked` only on a fail; the History found row names hosts left out for no history and fails for a chosen Pi whose reader is missing; failure rows carry the action text from the spec
- [x] 4.8 Implement `import-checks.ts` on top of `modelBlockedReason`; verify 4.7 passes
- [x] 4.9 Change `initialImportDraft` to `scope: "all-projects"`, remove `maps` from the draft, `membership`, `optionsError` and `groupRequest` (send `pathMaps: []`), and remove `parseMaps`; let `loadHostChoice` take the set-up hosts for a fresh draft; update the affected cases in `import-scope-change.spec.ts` and `memory-import-contract.spec.tsx` to the new defaults, keeping every other assertion; verify both files pass
- [x] 4.10 Check that no other file imports `parseMaps` or `draft.maps` except the files group 6 owns; list them in the pull request notes for group 6

## 5. Confirm dialog, progress and finish summary

Owns: new `web/src/lib/components/memory/ImportConfirmDialog.tsx`, `ImportFinish.tsx`, `ImportProgressBar.tsx`, `ImportResults.tsx`, `import-finish.ts`, `web/src/lib/i18n/import-result.ts`, `web/tests/import-completion-feedback.spec.tsx`, `web/tests/import-finish.spec.ts`, `web/tests/skills-import-option.spec.tsx`, new `web/tests/import-confirm-dialog.spec.tsx`.

- [x] 5.1 Write a failing spec for `ImportConfirmDialog`: it shows sessions, calls, minutes or "known once the import starts", and the skipped-chats line; Cancel calls nothing; Import calls `onConfirm` once; a server error shows inside and the dialog stays open
- [x] 5.2 Build `ImportConfirmDialog.tsx` on `ui/dialog.tsx`, following the `SpaceConfirmDialog` pattern and the omms-design skill; verify 5.1 passes
- [x] 5.3 Add failing cases to `import-completion-feedback.spec.tsx`: the bar shows minutes left when given, and unknown when not; the finish dialog shows the three lines, **Retry failed** only when something failed, and a closed **Details** holding today's counters
- [x] 5.4 Add `minutesLeft` to `ImportProgressBar` props and the three lines, **Retry failed** (`onRetry` prop) and **Details** to `ImportFinish.tsx`, using `importSummary` from group 4; keep the success, failure, cancelled and banner rules; verify 5.3 and `import-finish.spec.ts` pass
- [x] 5.5 Add the new strings in three languages to `i18n/import-result.ts`, with 🎉 in English only; verify the parity test passes

## 6. Import panel, Customise and views

Owns: `web/src/lib/components/memory/ImportSection.tsx`, new `use-import-job.ts`, `use-quick-import.ts`, `ImportChecklist.tsx`, `ImportCustomise.tsx`, `ImportOptions.tsx`, `HostSessionSelection.tsx`, `HostView.tsx`, `MemoryOverview.tsx`, `MemoryView.tsx`, `web/src/lib/i18n/import-flow.ts`, `web/tests/memory-workspace-import.spec.tsx`, `web/tests/memory-host-views.spec.tsx`, `web/tests/memory-profile-actions.spec.tsx`, new `web/tests/quick-import.spec.tsx`.

- [x] 6.1 Write a failing spec in `memory-profile-actions.spec.tsx` (or `memory-host-views.spec.tsx` if it fits better): after **Re-analyse chat history** the overview shows the import panel and Customise open with the profile-only preset; run it and record that it fails (score 16)
- [x] 6.2 Move the job refresh, poll, start and cancel from `ImportSection.tsx` into `use-import-job.ts` with no behaviour change; verify `memory-workspace-import.spec.tsx` passes unchanged before any other edit
- [x] 6.3 Write failing specs in `quick-import.spec.tsx` with a fake `settingsRequest`: **Import new chats** on Pi sends the external API test once, lists with `scope: "all-projects"`, posts a dry run with `selection.mode: "all"`, then opens the confirm dialog; a second click on the same page sends no test; a failed test starts no preview; an empty preview shows **Nothing new to import** and no dialog; Confirm posts the same request with `dryRun: false`; a stale reply relists once; **Import all hosts** chooses only hosts with history
- [x] 6.4 Build `use-quick-import.ts` and wire it to the primary button; verify 6.3 passes
- [x] 6.5 Build `ImportChecklist.tsx` from `importChecks` and `useWriteHealth`, with the model line and **Change** (opens Customise and focuses the model select); disable the primary button while `blocked`; verify with spec cases for each checklist scenario
- [x] 6.6 Build `ImportCustomise.tsx` (closed disclosure) holding `ImportOptions`, host ticks on the overview, `HostSessionSelection`, **Preview (dry run)** and **Start import**; **Start import** opens the confirm dialog and is disabled after a preview with no work; remove `window.confirm`; verify in `memory-workspace-import.spec.tsx`, rewriting the cases that pinned Pi plus current project and `window.confirm` to the new rules and keeping every other assertion
- [x] 6.7 In `ImportOptions.tsx` remove the directory map text box; in `HostSessionSelection.tsx` remove the `None` model option, fix the `/import` help text, show `row.title` before the id, and replace "Show them and add a directory map" with the one missing-folder notice; verify with spec cases for the folder notice on a host view and on the overview
- [x] 6.8 Lay out `HostView.tsx` (status header, import panel, folder list, settings), `MemoryOverview.tsx` (cards, import all hosts panel visible, opens on `profilePreset > 0`) and `MemoryView.tsx`; feed the active child's `minutesLeft` from `statuses.backfill.runs` to `ImportProgressBar` and reload backfill runs on each job poll; pass `onRetry` to `ImportFinish`; verify 6.1 passes and `memory-host-views.spec.tsx` passes after its all-hosts cases are updated to the visible panel
- [x] 6.9 Add the line "Chats already imported are skipped, so running an import again is safe." and every other new string in three languages to `i18n/import-flow.ts`; verify the parity test passes
- [x] 6.10 Keep `ImportSection.tsx` and every new file at 500 lines or fewer; verify `tests/file-size-ceiling.test.ts` passes

## 7. Documentation

Owns: `docs/web-ui-memory.md`.

- [x] 7.1 Rewrite "Import chat history", "Review and start", "Models and pinned history", "Advanced options" and "Group progress, cancellation and retry" for the new flow: status line, Off state, checklist, one button, dialog, summary, Retry failed, Customise, the removed map text box (use saved maps or `--map`), All projects default, OpenCode titles; verify every UI label in the guide matches the English strings in the three new tables
- [x] 7.2 State in the guide what each host has outside the web page (terminal commands, `/memory-import-pi-history`, `/memory-import-opencode-history`, none for Claude Code); verify by grep that no `/import in OpenCode` or **Run now** remains in `docs/` and `README.md`

## 8. Verification

- [x] 8.1 Run every spec and test file touched above through `bash scripts/run-tests-isolated.sh <files>`; verify all pass and paste the exit lines
- [x] 8.2 Run `bun run check`; verify it exits 0
- [x] 8.3 Run `bun run build`; verify it exits 0
- [x] 8.4 Live check from the worktree build. Make a scratch HOME under the scratchpad (`simpler-import/home`) with a small fake history for Pi (two `.jsonl` sessions under `~/.pi/agent/sessions/`) and Claude Code (two transcripts under `~/.claude/projects/`), one with a recorded folder that does not exist. Start a stub model endpoint on a free port that answers OpenAI-chat requests with a fixed extraction reply, and point `memoryProvider`, `memoryApiUrl` and a `file://` `memoryApiKey` at it in the scratch global config. Check the web port is free with `lsof -iTCP:<port> -sTCP:LISTEN`, start `node dist/cli/index.js web` with the scratch HOME, and probe `/api/settings/imports/readiness` before opening the page. Never touch `~/.omms` or `~/.config/omms`, and make no paid model call. The first embedding check downloads the model once (evidence in the run's scratch folder: `live-simpler-import/`, `job4.json`, `job6.json`, `job7.json`, `stub.log`; no paid call made)
- [x] 8.5 In the browser (chrome-devtools, or Orca if Chrome is missing) at 1280 px and 390 px: turn automatic import off and see **Off** and **Turn on**; run **Import new chats** on Pi through the dialog to the three-line summary; run **Import all hosts**; open Details; use **Resolve** on the missing folder; use **Change** on the model line; use **Re-analyse chat history**; verify no sideways scroll, the dialog actions stay reachable at 390 px, and Arabic layout reads right. Save screenshots in the scratchpad (screenshots in the run's scratch folder, `live-simpler-import/shots/`; the defects it found are fixed in group 10)
- [x] 8.6 Run `bun run ci:local`; verify the final summary line reports no failed file (2026-11-17, after the live-check fixes: exit 0, 598 test files, 5,300 tests passed, 0 failed)
- [x] 8.7 Run `openspec validate simpler-import --strict`; verify it reports the change as valid

## 9. Review fixes

Owns: the files of groups 2, 4, 5 and 6, `web/src/lib/components/memory/TurnOnAction.tsx` (new), `web/tests/turn-on-confirm.spec.tsx` (new), `src/importer/import-readiness.ts`, `tests/import-readiness.test.ts`, one `id` in `HostSettings.tsx`.

- [x] 9.1 Off with Turn on for a host the server reports as blocked while the switch is off, card line too, on all three hosts; verify `host-status.spec.ts` ("reads Off with Turn on for a blocked host while the switch is off, on every host")
- [x] 9.2 Time estimate adds each host's own calls at its own speed, null when a host with work has no speed, never 0 minutes for real work; verify `import-estimate.spec.ts`
- [x] 9.3 The overview stores the host choice only after readiness ticked the hosts and the user changed something; verify `quick-import.spec.tsx` ("stores no host choice when the user leaves before readiness loads")
- [x] 9.4 The model test result is kept per provider, model and URL; verify `quick-import.spec.tsx` ("tests the model again after the saved model changes, for a pass and for a fail")
- [x] 9.5 A stale reply to Import closes the dialog, previews once more and asks again; a second one shows one plain line; verify `quick-import.spec.tsx`
- [x] 9.6 Retry failed on a host view retries that host only; verify `quick-import.spec.tsx`
- [x] 9.7 Change focuses the model choice of a visible host section; verify `quick-import.spec.tsx`
- [x] 9.8 A failed listing ends the busy line, and a second click while busy starts nothing; verify `quick-import.spec.tsx`
- [x] 9.9 Plain words for the progress step, the stop button, the waiting count, the model row reasons, the finish lines and the overview host line, in three languages; verify the focused specs and `tests/web-translations-parity.test.ts`
- [x] 9.10 Turn on asks first in a confirm dialog; verify `turn-on-confirm.spec.tsx` and `host-status-header.spec.tsx`
- [x] 9.11 Remove the two unused directory-map translation keys
- [x] 9.12 Add `id="memory-section-auto-import"` to the automatic-import row in `HostSettings.tsx` for `friendly-settings`

## 10. Live-check fixes

Owns: the files of groups 3, 4, 5, 6 and 9, `src/core/profile-failure.ts` (one constant), `src/importer/profile-import.ts` (uses it), `src/importer/web-import-group.ts`, one line in `src/services/web-server.ts`, `tests/web-settings-api.test.ts` (readiness keys), `tests/web-settings-i18n.test.ts`.

- [x] 10.1 Waiting profile prompts alone are no work, because the server runs no host with no sessions: the page says Nothing new to import; verify `import-estimate.spec.ts` ("counts waiting profile prompts only when a host has sessions to run") and `quick-import.spec.tsx` ("says Nothing new to import when only waiting profile prompts remain")
- [x] 10.2 The primary button never re-analyses; the dialog for a re-analyse from Customise says imported chats are analysed again; verify `quick-import.spec.tsx` ("never runs a forced re-import from Import new chats…", "says in the dialog that a re-analyse from Customise…") and `import-confirm-dialog.spec.tsx`
- [x] 10.3 The dialog names only hosts with sessions, and shared profile calls are timed on the first host that runs; verify `import-estimate.spec.ts` and `quick-import.spec.tsx` ("lists in the overview dialog only the hosts…")
- [x] 10.4 A Profile row fails before a run when no email names the profile, and a failed profile step for that reason says what to set; verify `import-checks.spec.ts`, `import-readiness.test.ts`, `web-import-group.test.ts` and `web-settings-i18n.test.ts`
- [x] 10.5 The settings checkbox asks with the Turn on dialog before it turns automatic import on; verify `turn-on-confirm.spec.tsx`
- [x] 10.6 Customise options belong to one host view, and the Re-analyse preset ends when the page leaves the overview; verify `quick-import.spec.tsx` ("keeps each host view's Customise options to that host", "ends the Re-analyse preset…")
- [x] 10.7 Plain words: singular counts, a plain sentence and code for a failed model test, no `0 / 0 · 0%` before the first count, one model state in Customise and the checklist, the OpenCode-only sentence on the OpenCode view only, and the one-short-call line; verify `quick-import.spec.tsx`, `import-checks.spec.ts`, `import-completion-feedback.spec.tsx` and `tests/web-translations-parity.test.ts`

## Workflow follow-up

- Archive the change with the `openspec-archive-change` skill before the pull request, in the same pull request.
- Propose the follow-up changes listed in proposal.md only when the owner asks.
