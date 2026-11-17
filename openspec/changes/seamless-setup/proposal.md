# Proposal

## Why

A first-run audit (2026-11-16) counted the steps from nothing to working memory on each host. Pi needs 2 actions, OpenCode 4, and Claude Code 6 to 8. On Claude Code, capture stays off until the user sets an external API key, and nothing in the session says so: the status label shows a green `omms: ✔`, and the only message is one log line (`src/importer/claude-hook-api.ts:310-314`). There is no command that installs OMMS into each host, and no command that checks an install. The health rows exist only on the Settings page, and they show a red Claude Code row to users who do not have Claude Code (`src/importer/settings-health.ts:51,137`).

Smaller gaps add to this:

- A busy port is reported as `server-unreachable` by the Claude Code hook (`src/adapters/claude-code/hook-client.ts:382-383`), and the troubleshooting table tells the user to install Node.
- Pi drops the web-start result (`src/adapters/pi/extension.ts:186-214`), so a busy port or a missing runtime is silent. OpenCode already logs a notice (`src/v2/startup.ts:124-130`).
- OpenCode auto-update runs `opencode plugin update om-memory-system`, and the docs ask the user to add the same entry to `~/.config/opencode/cli.json` by hand.
- Nothing tells the user at first run that OMMS imports past history with model calls, installs a login item (OpenCode and Pi), and downloads an embedding model.
- An empty Memory page shows only "No memories found".
- The docs give Claude-only users commands they do not have (`om-memory-system web install`), and some lines are stale.

## What Changes

- **New `setup` terminal command.** `npx om-memory-system@latest setup` finds OpenCode, Pi and Claude Code on the computer, prints a plan, asks once, and installs OMMS into each host it found through that host's own command: `opencode plugin add om-memory-system`, `pi install npm:om-memory-system`, and `claude plugin marketplace add …` plus `claude plugin install omms@omms`. A host that already has OMMS is skipped. A host that is absent is not touched. It prints the next step for each host. `--yes` runs without the question; `--dry-run` prints the plan only. In a terminal that cannot answer, it prints the plan and stops unless `--yes` is given.
- **New `doctor` terminal command.** One table, one row per check, with a plain status and a fix for each row that is not green: Node version, each host found with its version and minimum version, plugin registered, OpenCode `cli.json` entry, web app reachable and its port, embedding model ready, external API configured and reachable, capture ready per host. It reuses the Settings health rows through the web app and skips the rows of absent hosts. `--json` prints the rows as JSON. `--skip-model-test` skips the one short external API call.
- **OpenCode `cli.json`.** Checked in OpenCode 2.1.2: `opencode plugin add` writes only the global `opencode.json(c)` for a package with a server entry, so it never writes `cli.json` for OMMS. `setup` adds `"om-memory-system"` to the `plugins` array of an existing `cli.json` (other keys and entries kept, comments and formatting kept). It never creates `cli.json`, because OpenCode uses an absent file as the signal to migrate old `tui.json` settings. When the file is absent, `setup` and `doctor` report the manual step.
- **Claude Code capture-off is visible.** The web app's health answer carries the Claude Code capture state. The status label shows an amber `omms: ✔ capture off` when capture is on but the external API is not set. The first `SessionStart` after that shows one short line to the user that says what to set and where.
- **Separate `port-busy` result.** The Claude Code hook logs `port-busy` when another program holds the web app port. The troubleshooting table gets the right advice.
- **Every host reports a web app that cannot start.** Pi shows a notice for a busy port and for a missing runtime, as OpenCode does. Claude Code shows the same line once, at `SessionStart`. The wording is shared.
- **One first-run notice per host.** At the first session of each host, OMMS states what it does on its own and how to turn each part off: the automatic history import that makes model calls, the login item (OpenCode and Pi only), and the one-time embedding model download. `setup` prints the same text before it asks.
- **Welcome panel.** When the active memory space has no memories, the Memory page shows a welcome panel with each host's capture readiness and a link to the External API card on the Settings page.
- **Docs.** README install per host with minimum versions and a "check it works" step, `npx` forms where the global command may be missing, uninstall sections for OpenCode and Pi, and the stale lines the audit found (package description, `UPDATES.md`, `docs/configuration.md:59-60`, `docs/web-ui.md:12`, the Claude Code reload step).

No breaking change. No config key is added, removed, or given a new default.

## Capabilities

### New Capabilities

- `host-setup`: the `setup` and `doctor` terminal commands, the OpenCode `cli.json` entry, and the first-run notice on each host.

### Modified Capabilities

- `claude-code-adapter`: the status label gains the `capture off` state; the hook reports `port-busy` and shows the setup line and web-start failures to the user.
- `web-autostart`: every host tells the user when the web app cannot start.
- `web-memory`: the welcome panel on an empty memory space.

## Out of scope

- The Settings cards (External API, embeddings, keys). The `friendly-settings` change owns them. This change only links to the External API card.
- The import page. The `simpler-import` change owns it.
- The host registry and the boundary ratchet. The `modular-boundaries` change owns them. The host-specific setup code lives in the adapters, so it adds no host branch outside `src/adapters/`.
- Hiding absent hosts on the Settings page Health section. The rows gain a `host` field that the Settings page can use later.
- A login item for Claude Code.
- Uninstall through `setup`.

## Known small issues

Each scored 3 or below (Likelihood × Impact). The code is left as it is; the owner decides.

- **`claimNotice` race.** It reads, changes and writes the record with no lock. If two hosts start at the same moment, one claim is lost and that notice shows once more. Likelihood 2, Impact 1, score 2. Trigger: two hosts start their first session within the same few milliseconds.
- **Setup link on a non-loopback host.** The `setup` settings link uses raw `webServerHost`, so `0.0.0.0` gives an address that cannot be opened. The hook already maps it to 127.0.0.1. Likelihood 1, Impact 2, score 2. Trigger: `webServerHost` set to `0.0.0.0` and Claude Code capture not ready.
- **Capture off on purpose.** The `Claude Code model` row fails, so `doctor` exits 1, when `autoCaptureEnabled` is false. Likelihood 1, Impact 2, score 2. Trigger: Claude Code installed, `autoCaptureEnabled: false`, no external API.

## Follow-up changes

- `setup --only <hosts>` to install into some of the hosts found. About 4 files.
- A `setup` question that turns off the automatic history import before the first session (writes `"autoBackfill": false`). About 5 files.
- Hide absent hosts in the Settings page Health section with the new `host` field. About 4 files; belongs with `friendly-settings`.
- `om-memory-system uninstall` that removes the plugin from each host and the login item. About 8 files.

## Impact

- New: `src/cli/setup-command.ts`, `src/cli/doctor-command.ts`, `src/cli/doctor-rows.ts`, `src/cli/host-setups.ts`, `src/adapters/opencode/setup.ts`, `src/adapters/pi/setup.ts`, `src/adapters/claude-code/setup.ts`, `src/core/host-setup.ts` (types only), `src/services/find-program.ts`, `src/services/first-run-notice.ts`, `src/services/web-start-notice.ts`, `src/services/claude-capture-state.ts`, `src/services/health-body.ts`, `web/src/lib/components/explorer/WelcomePanel.tsx`, `web/src/lib/i18n/welcome.ts`, `src/adapters/opencode/first-run.ts`, `src/adapters/pi/start-notices.ts`, `src/importer/claude-hook-notices.ts`, `src/importer/claude-hook-request.ts`, and tests.
- Changed: `src/cli/index.ts`, `src/adapters/claude-code/hook-client.ts`, `src/importer/claude-hook-api.ts`, `src/importer/settings-health.ts`, `src/services/web-server.ts` (health body moved to a helper; the file shrinks), `src/v2/startup.ts`, `src/adapters/pi/extension.ts`, `src/adapters/opencode/tui-status.ts`, `src/adapters/pi/self-update.ts` (export the settings reader), `hooks/omms.jsx`, `hooks/omms-status.jsx`, `hooks/omms-status-glyphs.js`, `src/services/status-glyphs.ts`, `web/src/lib/components/explorer/MemoryList.tsx`, `web/src/App.tsx` (one line), `web/src/lib/i18n/translations.ts`.
- Package: one new `bin` subcommand pair inside the existing `om-memory-system` bin. No new entry point and no `files` change. `bun run check:package` runs in the verification group anyway.
- Docs: `README.md`, `UPDATES.md`, `package.json` description, `docs/cli.md`, `docs/claude-code-adapter.md`, `docs/opencode-adapter.md`, `docs/pi-adapter.md`, `docs/web-ui.md`, `docs/web-ui-memory.md`, `docs/configuration.md`.
- Hosts: OpenCode, Pi and Claude Code all get `setup`, `doctor`, the first-run notice and the web-start failure report.
- About 60 files including tests.
