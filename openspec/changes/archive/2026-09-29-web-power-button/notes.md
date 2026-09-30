# Change notes

## 3.4 Tests that expected the OpenCode plugin to start a web server

Four tests mocked `src/services/web-server.js` only to keep the plugin from starting a server. The plugin no longer imports that module, so the mock is removed from each. No assertion changed.

- `tests/opencode-trace-startup.test.ts`
- `tests/compaction-agent-preservation.test.ts`
- `tests/memory-portability-tool.test.ts`
- `tests/tool-scope.test.ts`

`tests/opencode-backfill-startup.test.ts` and `tests/profile-tool-runtime.test.ts` set `webServerEnabled: false` and needed no change.

New: `tests/opencode-web-ensure.test.ts` covers the shared start call, no in-process server, the toasts, and profile learning and cleanup on idle without a server.

## Decision: profile learning and cleanup in OpenCode

OpenCode ran profile learning and daily cleanup only while it owned the web port. With no in-process server that check can never be true. The owner check is removed. Both run on `session.idle`, as Pi and Claude Code already run profile learning in every session. Cleanup keeps its daily in-process limit.

## 4.2 Health status for the OpenCode model test

Chosen status: `warn`. `HealthRow` has only `pass`, `warn`, and `fail`, and the Pi model test already uses `warn` for "needs an active session". The row reads "Skipped: an OpenCode signed-in model can be tested only inside OpenCode. Run a capture in OpenCode, or set the external API as the capture model." It shows when the capture model is an OpenCode signed-in model (a named provider/model or `inherit`) and the web app has no OpenCode host models. No new status and no change to the Health view.

## 7.4 Browser check (2026-09-29)

Standalone build in a temp HOME on port 48991, driven in Chrome. Seen:

- Footer button "Web app power" is green (`data-power="on"`, colour `oklch(0.696 0.17 162.48)`).
- Dialog opens with the title, body, the "next host start brings it back" note, and Cancel, Stop, Restart. Restart has focus.
- Restart: log record `restart / restarting`, a new pid answered on the same port, and the page reloaded.
- Stop (in Arabic): full-page stopped screen with `om-memory-system web` and the note. The process exited and the port refused connections. Starting the command again brought the app back.
- Settings, Import: shows "An import with an OpenCode signed-in model runs from the terminal or with /import in OpenCode."
- Health: "OpenCode model test" is `warn` with the "Skipped: ..." reason.
- `en`, `zh`, and `ar` all render the button and dialog. `ar` sets `dir="rtl"` on the page and the dialog.

## 9.2 Release check on macOS (2026-09-29)

Temp HOME, port 48992, built package. The real login item was not touched.

```
1. three callers at once
   opencode:started exit 0
   pi:started exit 0
   hook:ok spawned=false exit 0
   listeners: 1 54722
2. Restart
   POST /api/web/restart -> 202
   listeners: 1 54787 new pid: true
3. Stop
   POST /api/web/stop -> 202
   port free: true
4. host start again (pi style)
   pi:started
   back up: true listeners: 1
5. cleanup
   port free: true
```

One process listened for three concurrent callers. The Pi-style caller (`wait: false`) reports `started` at once even when another caller holds the lock, as designed. No start lock file remained afterwards.
