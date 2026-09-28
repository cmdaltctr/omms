# Proposal: List OpenCode models in the standalone web app

## Why

The login web app and `om-memory-system web` run without an OpenCode session. On those servers the OpenCode model card says "Model list unavailable", while the Pi card lists Pi's signed-in models. Users read this as a bug. The page also hides the server's reason for a missing list, so the user cannot tell what to do next.

Tests on 2026-09-28 against OpenCode v2.0.18 showed a working path. OMMS can start a private `opencode serve` process, read its model list over HTTP, and stop it. The server was listening in about 100 ms and returned the full list (419 models) in about 1 s.

## What Changes

- When no OpenCode session serves the web app, the Settings model list for OpenCode starts a private, short-lived `opencode serve` process and reads its signed-in models. Inside an OpenCode session the current path stays unchanged.
- OMMS finds the `opencode` program in OpenCode's install folder and on the search path. It does not need the user's shell profile.
- OMMS keeps only the provider, model ID, and name from OpenCode's reply. The reply contains provider API keys. OMMS never stores, logs, or returns them.
- OMMS keeps a successful list for a short time, so reloading Settings does not start a new OpenCode process each time. Requests that arrive together share one process.
- When no list is available, the server gives a plain reason with a next step for each case: OpenCode not found, OpenCode did not start in time, OpenCode has no signed-in models, or OpenCode sent a reply OMMS cannot read.
- The Pi list gives reasons in the same style.
- The model cards and the Automatic import section show the server's reason in place of the fixed "Model list unavailable" line. The reasons are translated like other Settings text.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `web-autostart`: the web app without a host session lists OpenCode's signed-in models. It stops reporting that list as unavailable by rule.
- `web-settings`: when a host's model list is not available, the model card and the Automatic import section show the reason and the next step.

## Impact

- **Code:** `src/importer/settings-models.ts` and a new module in `src/importer/` that starts `opencode serve` and reads its model list. `web/src/lib/components/settings/ModelsSection.tsx`, `AutoImportSection.tsx`, and `web/src/lib/i18n/settings.ts`.
- **API:** `GET /api/settings/models?host=opencode|pi` keeps its shape (`available`, `models`, `reason`). The `reason` text changes.
- **Processes:** the standalone web app can start a child `opencode serve` process on `127.0.0.1` with a random port and a random password. OMMS stops it after each read.
- **Dependencies:** none. The installed `@opencode-ai/sdk` 1.18 cannot start or query an OpenCode v2 server, so OMMS uses `node:child_process` and `fetch`.
- **Security:** the provider API keys in OpenCode's reply must not reach logs, errors, the cache, or the browser.
- **Not in scope:** Health checks, test calls, and history imports in the standalone web app still need an OpenCode session. They keep their current reasons.
- **Docs:** `docs/web-ui-settings.md` and a TDR about the OpenCode v2 server API.
