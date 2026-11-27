## Context

- The shared pattern exists: `web/src/hooks/useSettingsConfirm.tsx` (`ask(request)` plus one rendered `dialog`) and `web/src/lib/components/settings/SettingsConfirmDialog.tsx`. The dialog runs the request only after confirm, shows progress, keeps a server error inside itself and closes on success. `onCancel` lets a card put a save-on-change control back to its saved value. `ReasoningLevel.tsx` shows that use.
- The Memorisation page already follows the rule through `web/src/hooks/useMemorisationConfirm.tsx` (PR #311).
- An audit of `web/src` (2026-11-27) listed every settings action without a dialog. The tasks name each card and trigger.
- Most cards stage edits in a form and save with one button. A few save on change: the summary language select, the two Skill learning switches, and the automatic import checkbox when turned off. A few are one-click actions: Pause, Resume, Retry, Retry now, Use external API, Generate token, Save password, Clear password, Record past turns, Ignore and Restore.
- File sizes: `memory/DirectoryMapsSection.tsx` is at the 500-line limit. `settings/ExternalApiSection.tsx` (456), `settings/EmbeddingSection.tsx` (431) and `memory/RerankerSection.tsx` (417) are close to it.

## Goals / Non-Goals

**Goals:**

- Every settings save and settings job action on the Settings and Memory pages confirms first, through one shared dialog.
- The dialog says exactly what will change: each setting with its old and new value, or one sentence for a job.
- Same request bodies as today. No server change.

**Non-Goals:**

- Actions that are not settings saves: memory delete, cleanup and dedup (`window.confirm` in `useMemoriesExplorer.ts`), "Analyse waiting prompts", Add memory, pin and unpin, profile Refresh, skill proposal Apply, Reject and Undo, skill mode and drafts, and the chat folder move. These go to a later change.
- Local-only view preferences (theme, palette, date and time format, language, sidebar, paging, filters). They write no server state.
- Test buttons and the Health check. They change nothing.
- A new dialog component, or a change to `SettingsConfirmDialog` beyond what the change list needs.

## Decisions

1. **Reuse `useSettingsConfirm` in every card.** Each card calls `ask` from its save handler and renders `dialog` once. A second dialog component was rejected because it would split the progress, error and close behaviour into two copies.

2. **One shared change list.** A pure helper `settingsChanges(saved, draft, fields)` returns the changed rows as `{ label, from, to }`, and a small `SettingsChangeList` component renders them as a definition list. Each card passes its own labels and value formatters: On and Off for booleans, the translated option name for selects, a number with its unit, and "Default (value)" for a reset. A text body per card was rejected: it would drift from the real edits, and nothing would test that it matches what is sent.

3. **One dialog per click.** When a card already opens a special dialog on a path, that dialog is the confirmation for that click, and its text gains the change list where it fits. Examples are memory cleanup's count dialog, the reranker's "Replace the key file?", the capture trace and zero-retention dialogs, and the external API's Save anyway. A second dialog after the first was rejected as noise.

4. **Test, then confirm.** A Save that runs a test call (external API, reranker, embedding) runs the test first, because a test changes nothing. A passing test opens the confirm dialog. A refused key still saves nothing and opens no dialog. A test that cannot reach the server opens the existing Save anyway dialog, which is the confirmation.

5. **Save-on-change controls hold a pending value.** The control shows the new value while the dialog is open, and `onCancel` puts the saved value back. This matches `ReasoningLevel.tsx`. Leaving the control on its saved value until confirm was rejected, because the user could not see what they had chosen.

6. **Page checks first.** A value the page can check (range, URL scheme, empty required field) shows its message on the page, and no dialog opens. A dialog for a save that cannot succeed was rejected.

7. **Job actions get one sentence.** Pause, Resume, Retry, Retry now and Record past turns each say what the job does and whether it calls a model. Pause is included because it changes saved state; the cost is one extra click.

8. **The redaction warning moves into the dialog.** The inline Callout before turning off "Remove private text and secrets" becomes the shared dialog, with the same warning text in its body.

9. **Size limits.** Cards near 500 lines move their confirm wiring into a small hook beside them, as `useMemorisationConfirm.tsx` does. `DirectoryMapsSection.tsx` is split first: the ignored-folders list moves to its own component. `tests/file-size-ceiling.test.ts` gets no new entry.

10. **Docs and rules.** `web/AGENTS.md` says that the rule covers settings saves and settings job actions, and that local-only view preferences are excluded. The two web UI guides say each save asks first.

## Risks / Trade-offs

- [One more click on every save] → This is the rule the project chose. The dialog shows the exact changes, so the click is a check, not a formality.
- [Many tests expect an immediate request] → Each is updated to confirm first and still asserts the same request body. Each card also gets a test that no request is sent before confirm.
- [Pending values on save-on-change controls can leave a control showing an unsaved value] → `onCancel` and the dialog's close path always restore the saved value. A test covers Escape and the close button as well as Cancel.
- [Special dialogs and the change list can disagree] → Decision 3 keeps one dialog per click, built from the same edits object that is sent.
- [Large diff across about 25 files] → The work is split by page, so the groups do not touch the same files.

## Migration Plan

Web only. No data or config migration. Rollback: revert the commit.

## Open Questions

None.
