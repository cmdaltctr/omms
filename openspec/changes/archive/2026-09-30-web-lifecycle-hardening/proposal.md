# Proposal

## Why

PR #51 made every host share one standalone web app and added Restart and Stop to the page. A review found two gaps in that work. Two hosts that recover the same dead start lock can both start a web app. A Restart whose replacement copy cannot start leaves no web app running, and the page cannot tell the user. The same review asked for docstrings on the functions that PR #51 added.

## What Changes

- Take over a stale start lock in one atomic step. When several callers find the same stale lock, exactly one of them gets the lock. The 20-second staleness rule and the pid-match release stay.
- Write the start lock during Restart by atomic replace, so the lock never disappears between two writes.
- Restart starts the replacement copy before the old process stops serving. When the copy cannot start, the old process keeps serving and logs a code.
- After the old process stops serving, it waits for the copy to answer. When the copy exits or never answers, the old process serves again.
- The login-item path gets the same recovery when the service manager command fails and the detached fallback copy cannot start.
- `GET /api/web/status` also returns an opaque `instance` value that changes with each web app process. The page uses it to tell a new process from the old one. After Restart, the page reloads only for a new instance, and says that the restart failed when the old instance still answers.
- Add short docstrings (why, not what) to the exported functions that PR #51 added or changed in `src/services/web-ensure.ts`, `src/cli/web-power.ts`, `web/src/lib/power.ts`, `web/src/lib/components/explorer/PowerButton.tsx`, and the power routes in `src/services/web-server.ts`.

No breaking changes. The status route only gains a field.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `web-autostart`: the shared start rule states that one caller wins when several recover the same stale start marker.
- `web-power-control`: Restart keeps a web app running when the replacement copy cannot start, the status route reports a process instance, and the page reports a failed restart.

## Impact

- Code: `src/services/web-ensure.ts` (lock takeover, new `LockFs` operations), `src/cli/web-power.ts` (restart order, handoff watch), `src/cli/web-command.ts` (resume callback), `src/services/web-server.ts` (`instance` in status, docstrings), `web/src/lib/power.ts` and `PowerButton.tsx` (instance check, failure message), locale strings for the new message.
- Tests: `tests/web-ensure.test.ts`, `tests/web-ensure-real-process.test.ts`, `tests/web-power-action.test.ts`, `tests/web-power-restart.test.ts`, `tests/web-power-control.test.ts`, `web/tests/power-api.spec.ts`, `web/tests/power-button.spec.tsx`.
- Docs: `docs/web-ui.md` (Restart behaviour and the time it takes).
- Restart takes up to about 6 seconds longer, because the copy takes the port through the 5-second takeover loop. The page already waits 20 seconds.
- No config, data, or dependency changes.
