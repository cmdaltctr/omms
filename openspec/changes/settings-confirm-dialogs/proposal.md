## Why

`web/AGENTS.md` says every action that changes state opens a confirm dialog first. Many settings cards do not follow it. PR #311 made the Memorisation page confirm every save, and a read-only audit of `web/src` then found the rest of the app split three ways:

- About 25 settings actions on the Settings and Memory pages write at once, with no dialog.
- 7 cards confirm on one path only, for example the reranker's "Replace the key file?". Their ordinary Save still writes at once.
- 9 cards already use the shared dialog (`useSettingsConfirm` and `SettingsConfirmDialog`).

So the same kind of click asks first on one card and writes at once on the next. This change gives every settings save in the app the same confirm step.

## What Changes

- Every settings action on the Settings page and the Memory pages opens the shared settings confirm dialog before it sends a request. This covers Save buttons, settings that save on change (selects, switches, checkboxes), per-row Reset to default, and buttons that start or stop a settings job (Pause, Resume, Retry, Retry now, Record past turns, Use external API, Generate token, Save password and Clear password).
- The dialog names the card, and lists each setting that changes with its old and new value in plain words. It has Cancel and a confirm button. Nothing is sent until the user confirms. It shows progress while the request runs. It shows a server error inside itself and stays open, and it closes on success.
- **Cancel** sends nothing. A setting that saves on change goes back to its saved value. Text the user typed in a form stays as a draft.
- A value that breaks a rule on the page still shows its message on the page, and no dialog opens.
- The 7 partly covered cards keep their special dialogs. Their ordinary Save also confirms: capture retention, reasoning level, the external API Save (including the empty URL or model that turns it off), OpenRouter routing, memory cleanup (turning it off or raising the days), reranker and profile learning.
- The inline Callout that asks before turning off "Remove private text and secrets" in Skill learning is replaced by the same shared dialog.
- Every new string is in English, Chinese and Arabic. `docs/web-ui-settings.md`, `docs/web-ui-memory.md` and `web/AGENTS.md` describe the rule and its exceptions.

No server, API or config change. The same requests are sent with the same bodies, only after the user confirms.

Out of scope, for a later change: actions that are not settings saves, which the audit also found without the shared dialog. These are memory delete, cleanup and dedup through `window.confirm`, "Analyse waiting prompts", Add memory, pin and unpin, the profile Refresh, skill proposal Apply, Reject and Undo, skill mode and drafts, and the chat folder move. Local-only view preferences (theme, palette, date format, language, sidebar and paging state) stay without a dialog, because they change no server state.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `web-settings`: the shared confirm dialog for settings saves, its content and Cancel behaviour, and the Settings page cards that use it.
- `web-memory`: the shared Memory page cards (memory limits, keyword mode, reranker, profile learning, profile auto cleanup and catch-up, directory maps) confirm before saving.
- `web-memory-hosts`: the host cards and the overview (host model, automatic import off, Use external API, Pause, Resume and Retry, opening context and compaction, ignored folders) confirm before saving.

## Impact

- Web only, in `web/src/lib/components/settings/`, `web/src/lib/components/memory/` and `web/src/lib/components/skills/use-skill-settings.ts`. These use the existing `web/src/hooks/useSettingsConfirm.tsx` and `web/src/lib/components/settings/SettingsConfirmDialog.tsx`, plus one small shared helper that lists the changed settings.
- Translation tables in `web/src/lib/i18n/` (English, Chinese, Arabic).
- Tests in `web/tests/` for each card: no request before confirm, Cancel sends nothing, confirm sends the same body as today, and a server error stays in the dialog. Existing tests that expect an immediate request are updated to confirm first, without weakening what they check.
- Docs: `docs/web-ui-settings.md`, `docs/web-ui-memory.md`, `web/AGENTS.md`.
- Users: one more click per settings save.
