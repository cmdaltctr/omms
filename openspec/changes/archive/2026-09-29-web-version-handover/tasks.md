# Tasks

## 1. Version order

- [x] 1.1 Write failing tests in `tests/version-compare.test.ts`: release order, prerelease older than release (`3.5.0-next.33` < `3.5.0`), numeric prerelease parts, and `unknown` or garbage compares as "not older". Verify: the tests fail before the module exists.
- [x] 1.2 Implement `src/services/version-compare.ts` (design decision 2). Verify: the tests pass, and each fails again when its matching code is removed.

## 2. Step-aside route (test first)

- [x] 2.1 Write failing tests for `POST /api/web/step-aside`: `202` for a newer caller with the token from loopback, `401` without the token, refusal from a non-loopback address, and `409` when the caller is not newer. Verify: the tests fail before the route exists.
- [x] 2.2 Write failing tests for what happens after `202`: with a callback set, the callback runs after the reply; without one, the server stops serving, becomes a non-owner, and starts its health loop only after 60 seconds. Verify: the tests fail before the change.
- [x] 2.3 Implement the route, `setOnStepAside`, the hold-off, and the log record (design decisions 3 and 6). Verify: the tests from 2.1 and 2.2 pass, and a log test finds no token.
- [x] 2.4 Register the exit callback in the standalone `web` command. Verify: a test that runs `node dist/cli/index.js web` sends the request and sees the process exit with code `0`.

## 3. `web install` handover (test first)

- [x] 3.1 Write failing tests in `tests/web-command.test.ts` with fake fetch and fake install: older owner steps aside and the item starts after the port is free; `404` prints the "cannot hand it over" message and still installs; same version is left running; newer owner prints the update message; no owner installs as today. Verify: the tests fail before the change.
- [x] 3.2 Implement design decisions 1, 4, and 5 in `src/cli/web-command.ts`. Verify: the tests from 3.1 pass.
- [x] 3.3 Add an end-to-end test: a standalone web app from the current build runs with a lower reported version, `web install` runs with the login item start stubbed, and the old process exits. Verify: the test passes under Node.

## 4. Host parity and boundaries

- [x] 4.1 Add a test that a `WebServer` started as a host would (no callback) keeps its process alive after it steps aside. Verify: the test passes. No adapter change is needed, because both hosts use the shared web server.
- [x] 4.2 Run `bun test tests/host-neutral-capture-boundary.test.ts` and `bun test tests/pi-adapter-boundary.test.ts`. Verify: both pass.

## 5. Docs

- [x] 5.1 Update `docs/cli.md` (`web install` output and handover) and `docs/web-ui.md` (port ownership and step-aside). Verify: `bun run check` passes.

## 6. End-to-end check

- [x] 6.1 Run `bun run ci:local`. Verify: it passes.
- [x] 6.2 On macOS, run a standalone web app from a test build that reports an older version on a spare port. Run `web install` from the current build with that port. Confirm the old process exits and the login item serves the port with the new version. Verify: record the output in the change notes.

## Verification notes (task 6.2)

Run on macOS on 2026-09-29, spare port 62418, temp HOME. A standalone web app from a copy of the build that reports `0.0.1` held the port. `web install` ran from the current build (`3.5.0`). A `launchctl` shim on `PATH` started `web --login-item` in place of the real item, so the developer's own login item and port 4747 stayed untouched.

```
before: {"running":"0.0.1", ...}
OMMS login item: installed
OMMS web app: http://127.0.0.1:62418 (version 3.5.0)
install exit=0
old process alive after install? no
after: {"running":"3.5.0", ...}
log: Web server step-aside request: {"outcome":"stepped_aside","ownVersion":"0.0.1","callerVersion":"3.5.0"}
```
