## Why

The history import on the Memory page takes about 9 clicks, 5 required decisions and 15 terms before anything runs. Automatic and manual import sit side by side with no word on how they differ, and the host header says "Automatic import is on" even when the user turned it off. The owner asked for an easier flow.

## What Changes

- Each host view opens with a status card: history imported up to a date, how many exchanges wait, and whether automatic import is on or off. It says in one line how automatic import and **Import new chats** differ.
- Fix: the status header and the host card follow the **Import past chats automatically** switch. With the switch off and no run active, the state reads **Off**, the main action reads **Turn on**, and the card line no longer reads **Running**.
- A readiness checklist sits above the import button: model ready and tested, memories saving, history found. The import button stays disabled while a check fails, and each failed row says what to do.
- One primary button: **Import new chats** on a host view, **Import all hosts** on the overview. It lists the sessions, runs the preview by itself with these defaults: all projects, project memories and profile (plus skill turns while recording is on), every session not yet imported, and the saved import model. It tests the model with one short call first, when the model has not been tested on this page yet.
- One confirm dialog built on the shared dialog replaces `window.confirm`. It shows the number of sessions, an estimate of model calls and time, and says that chats already imported are skipped. A preview that finds nothing to import shows **Nothing new to import** and opens no dialog.
- Progress shows time left. The finish dialog shows three plain lines (memories saved, profile updated from N prompts, failed), a **Retry failed** button, and a **Details** section with today's counters.
- A **Customise** section, closed by default, holds today's options, session list, preview and start buttons, and the import model choice. An OpenCode session row shows the session title next to its id.
- One path for missing project folders: the existing folder list on the host view. The page notice links to it. **BREAKING** (web page only): the **Directory maps (old=new)** text box is removed from the import options. Saved maps, Smart resolve and the `--map` flag stay.
- One model line with a **Change** link replaces the import model picker in the main flow. The picker moves into Customise.
- Small fixes: the web import defaults to **All projects** (the web app runs from the home folder, so "Current project" listed the home folder); **Re-analyse chat history** opens the import panel it lands on; the help text names `/memory-import-opencode-history`, not `/import`.
- Correct the stale baseline specs: `import-progress` (Run now), `web-autostart` (Run now, Settings page, `/import`) and `web-settings` (Automatic import section).

Out of scope:

- An all-hosts terminal command. It does not fit in about 100 lines on the existing grouped job path (see Follow-up changes).
- Session titles for Pi and Claude Code, and first prompts for any host.
- Pause for a manual web import, and keeping a web job across a server restart.
- Changes to the Settings page cards, the welcome panel, the `doctor` command and the host-name type lists. Other changes own them.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `web-memory-hosts`: status card and the Off state, readiness checklist, one-button import with automatic preview and confirm dialog, one model line, one path for missing folders, Re-analyse opens the panel.
- `import-progress`: time left on the manual progress bar, three-line finish summary with Retry failed and Details; Run now replaced by Pause, Resume and Retry.
- `web-settings`: the session list requirement (All projects default in the web app, Customise, no map text box, OpenCode titles, tested model); the stale automatic import requirements.
- `web-autostart`: stale wording (Run now, Settings page, `/import`).

## Impact

- Web: `web/src/lib/components/memory/` (import section split into a job hook, quick import, checklist, confirm dialog and summary; host status; overview; host view), three new tables (`web/src/lib/i18n/import-status.ts`, `import-flow.ts`, `import-result.ts`) merged into the settings text, and specs in `web/tests/`.
- Server: OpenCode session title in the session list (`src/importer/opencode-reader.ts`, `src/importer/import-sessions.ts`), corrected help text in `src/importer/import-readiness.ts`. Every route stays as it is.
- Docs: `docs/web-ui-memory.md`.
- Hosts: the change is on the web page, which serves Pi, OpenCode and Claude Code alike. Terminal and in-session commands do not change.
- No new dependency, no config key, no stored data change.

## Follow-up changes

- **All-hosts terminal command** (`om-memory-system import-all-history`): generalise `recordPastTurnsRequest` to take outputs, start a `SettingsImportJobs` group from the CLI, wait for it, print a grouped report, add a confirmation for paid runs and a `--yes` flag. About 150 to 200 lines with tests and docs, 6 to 8 files.
- **Titles for Pi and Claude Code sessions**: read a `custom-title` or `ai-title` entry within the bounded header read for Claude Code; Pi stores no title. About 60 lines, 4 files.
- **Pause and restart-safe manual web imports**: about 200 lines, server and page.
