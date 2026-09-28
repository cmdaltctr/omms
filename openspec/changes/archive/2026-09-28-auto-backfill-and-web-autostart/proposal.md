# Proposal

## Why

OMMS only learns from chats it sees live. Past Pi and OpenCode chats become memories and feed the user profile only when someone runs a history import by hand, so a new install, or a move to a new machine, leaves the memory store and the profile empty even when hundreds of past chats sit on disk. The web app has a similar gap: it runs only while an OpenCode session is open, Pi never starts it, and no command starts it on its own.

## What Changes

- **Automatic backfill.** When Pi or OpenCode starts, OMMS checks that host's chat history for chats it has not imported yet and imports them in the background. It runs one exchange at a time, after a short start delay, and never blocks the session. It uses the same importer and ledger as manual imports, so it resumes where it stopped after a restart and never imports an exchange twice. It covers every project whose directory can be resolved, and it builds the user profile from the imported prompts.
- The backfill covers history up to a fixed point: the moment automatic backfill first ran for that host on this store. Live capture handles everything after that point.
- New setting `autoBackfill` (default `true`) turns automatic backfill on or off. New settings `opencodeBackfillModel` and `piBackfillModel` choose the model for each host's backfill: `inherit` (the default) uses the model that host's live capture would use, and `provider/model` picks a specific signed-in model, for example `zai/glm-5-turbo` in Pi.
- Only one backfill per host runs at a time across all processes. A second Pi window does not start a second run.
- Every import, automatic or manual, skips an exchange that live capture already saved as a memory, so an existing store does not get duplicates.
- **The web app at login.** New setting `webServerAutoStart` (default `true`). While it is on, OMMS registers a login item that starts the web app when the user logs in: a LaunchAgent on macOS, a systemd user service on Linux, and a Startup-folder entry on Windows. Turning it off removes the item. The web app then runs without any Pi or OpenCode session open.
- New terminal commands: `om-memory-system web` starts the web app in the foreground, and `om-memory-system web install`, `web uninstall`, and `web status` manage the login item by hand.
- The Settings page gets an **Automatic import** section (the switch, each host's backfill model, and each host's progress: done, pending, failed, and unresolved sessions) and a **Web app** section (the login switch and whether the login item is installed).
- **BREAKING** (behaviour): installs that upgrade start importing past chats automatically on their next start, and register the login item, unless the user turns the settings off. Automatic backfill makes model calls; the first start after the upgrade shows a notice with the setting names.

## Capabilities

### New Capabilities

- `auto-backfill`: background import of past chats on host start, its settings, pacing, cross-process single run, resume, status, and skipping exchanges that live capture already saved.
- `web-autostart`: the login item for the web app, the `web` terminal commands, and the setting that installs or removes the item.

### Modified Capabilities

- `pi-session-history-backfill`: "Backfill is explicit" no longer holds; backfill runs on request or automatically when `autoBackfill` is on. Pi history files stay read-only.
- `web-settings`: the Settings page adds the Automatic import and Web app sections, and the page can save the four new settings.

## Impact

- Importer (`src/importer/`): a new backfill runner shared by both hosts, a status table and cutoff in `import-ledger.db`, a cross-process lock per host, and a live-capture check in `importer.ts` and `opencode-import.ts`.
- Hosts: `src/adapters/pi/extension.ts` and `src/index.ts` start the backfill after start-up and reconcile the login item. Both use host models through the existing bridges (`resolveImportModel`, `createOpencodeImportModels`).
- Web server and CLI: `src/services/web-server.ts` gains a standalone mode; `src/cli/index.ts` gains the `web` command; a new host-neutral `src/services/web-autostart.ts` writes and removes the login item.
- Config (`src/config.ts`, `global-config-writer.ts`, `settings-snapshot.ts`): four new keys with validation and defaults.
- Web (`web/`): two new Settings sections and i18n strings for every supported language.
- Tests must never register a real login item or start a real backfill; `.env.test` sets kill switches for both.
- Docs: `docs/configuration.md`, `docs/cli.md`, `docs/web-ui.md`, both history-import guides, and a new ADR.
