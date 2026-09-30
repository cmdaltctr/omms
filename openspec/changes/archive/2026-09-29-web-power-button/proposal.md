# Proposal: One shared web app, with Restart and Stop buttons

## Why

Today the web app runs in several ways at once. OpenCode runs its own copy inside the session, the login item runs a copy at login, a Claude Code hook starts a copy when none answers, and Pi starts none. These copies compete for the port, which needed takeover and step-aside rules, and Pi users only get the page from the login item. To stop or restart the web app, a user also needs a terminal.

This change makes one standalone web app that every host shares, and adds a power button so a non-technical user can stop or restart it. It ships in the same release as `web-version-handover` (PR #50), so every user who upgrades to that release gets both.

## What Changes

- **One shared web app.** A new shared module `src/services/web-ensure.ts` makes sure one standalone web app runs. OpenCode, Pi, and the Claude Code hook each call it at start with one line and no host logic.
  - If an OMMS web app answers on the configured port, the host uses it.
  - If none answers, the host starts one detached `om-memory-system web`. A start lock makes sure only one host starts it when several start at the same time.
  - If a program that is not OMMS holds the port, the host starts nothing.
  - The check never blocks or fails a host session.
- **OpenCode stops running a web server inside its session.** It uses the shared web app. Profile learning and daily cleanup used to run only in the OpenCode process that owned the web port. That owner no longer exists, so both now run on `session.idle` in every OpenCode session, as profile learning already does in Pi and Claude Code.
- **Pi now starts the web app** when it is not running.
- **Claude Code** uses the shared module in place of its own start code.
- **Power button** in the sidebar footer. Green means on. It opens a dialog with **Restart** (main action) and **Stop**.
  - New routes `POST /api/web/restart`, `POST /api/web/stop`, and `GET /api/web/status`. Loopback caller and local API token only.
  - Stop exits the web app. The next OpenCode start, Pi start, Claude Code prompt, `web install`, or login starts it again.
  - Restart starts a fresh copy, through the service manager for the login item.
- **Web page changes for the features that need OpenCode's own models:** the Import section offers only the external API, the Health page skips the OpenCode model test with a reason, and the Run now and Retry now messages stay as they are.
- **ADR-014** records the decision. The docs describe the new behaviour.

## Capabilities

### New Capabilities

- `web-power-control`: stop and restart the web app from its page.

### Modified Capabilities

- `web-autostart`: every host start makes sure one shared web app runs, and OpenCode no longer runs one inside its session.
- `claude-code-adapter`: the hook follows the shared start rule.

## Impact

- **Code:**
  - New `src/services/web-ensure.ts`.
  - `src/index.ts` (OpenCode calls the module and drops its in-process server), `src/adapters/pi/extension.ts` (one call), `src/adapters/claude-code/hook-client.ts` (uses the module).
  - `src/services/web-server.ts` (three routes), `src/cli/web-command.ts` (Stop and Restart), `src/services/web-autostart.ts` (login-item restart).
  - Web page: power button and dialog, Import and Health changes, text in English, Chinese, and Arabic.
- **Lost for OpenCode users:** the web page can no longer start an import, a backfill, or a model test with OpenCode's signed-in models, and **Retry now** cannot retry OpenCode's queued turns. Most users already lose these today, because the login item (on by default) holds the port before OpenCode starts. Live capture, profile learning, daily cleanup, automatic backfill, terminal imports, and `/import` in OpenCode keep working. Profile learning and cleanup now run in every OpenCode window, not only in the first one. A later change can add a standalone OpenCode import reader, like the existing model-list reader.
- **Mixed versions:** an OpenCode session with an older plugin still runs its own server. `web install` can ask it to step aside (`web-version-handover`), so that code path stays.
- **Compatibility:** OMMS 3.5.0 and earlier have no power button.
- **Docs:** ADR-014, `docs/web-ui.md`, `docs/web-ui-settings.md`, `docs/opencode-adapter.md`, `docs/pi-adapter.md`, `docs/claude-code-adapter.md`, and `docs/cli.md`.
- **CI:** `bun run ci:local` also runs the web page specs in `web/tests/`, which it skipped before.
- **Release:** hold the release-please PR until this change merges, so it ships with `web-version-handover`.
