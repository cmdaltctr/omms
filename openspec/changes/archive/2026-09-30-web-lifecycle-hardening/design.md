# Design

## Context

See proposal.md for the motivation. The earlier design is in `openspec/changes/archive/2026-09-29-web-power-button/design.md`.

Current state:

- **Start lock** (`src/services/web-ensure.ts`). `takeLock` creates `~/.omms/web-start.lock` with exclusive create. When the file exists and is stale (dead pid, or older than 20 seconds), it reads the lock again, removes it, and creates it again. Each step is a separate file operation. Two callers A and B that both read the same stale lock can run in this order: A re-reads, B re-reads, A removes, A creates, B removes A's new lock, B creates. Both return `true` and both spawn a web app.
- **Lock release** (`removeStartLockFor`). It reads the lock and removes it when the pid matches. The web server calls it once it owns the port.
- **Restart, detached path** (`src/cli/web-power.ts`). Order: write lock (own pid), stop server, spawn copy, write lock (copy pid), exit. If the spawn throws, the process logs and exits with nothing serving. If the spawn fails asynchronously (`error` event), nothing notices.
- **Restart, login-item path.** Order: stop server, `restartWebAutostart` (`launchctl kickstart -k` or `systemctl --user restart`). If that returns false, fall back to the detached path above, with the server already stopped.
- **Production `writeStartLock`** removes the lock and then creates it. For a moment no lock exists.
- **Non-owner copy.** A copy that starts while the port is held becomes a non-owner. Its health loop runs every 5 seconds. When no answer comes, it waits 0.5 to 1.5 seconds of jitter and binds the port. Its `_start` then calls `removeStartLockFor(process.pid)`.
- **Page** (`web/src/lib/power.ts`). After Restart, `waitForWebApp` waits up to 3 seconds for `/api/health` to stop answering, then polls it for up to 20 seconds. It cannot tell the old process from a new one.
- **`WebServer.stop()`** does not reset `startPromise`, so `start()` after `stop()` does nothing. The step-aside path resets it by hand.

## Goals / Non-Goals

**Goals:**

- Exactly one winner when callers replace the same stale lock.
- A restart never ends with no OMMS web app on the port because the copy could not start.
- The page can tell a restarted web app from the old one.

**Non-Goals:**

- Faster takeover by the restarted copy. The 5-second health loop stays.
- Recovery when the service manager accepts the restart command and then fails to start the login item. The service manager owns that process.
- A Linux fix for a detached fallback copy that systemd kills with the login item's control group. That behaviour exists today and is unchanged (see Risks).
- Changing `removeStartLockFor`. The pid-match release stays as it is.

## Decisions

### 1. Stale-lock takeover through an exclusive tombstone link

To replace a stale lock, a caller does these steps:

1. Read the lock text `seen` and confirm it is stale (the 20-second rule is unchanged).
2. Create a hard link from the lock to a tombstone path derived from `seen`: `web-start.lock.<hash of seen>.stale`. `link` fails with `EEXIST` when the tombstone exists. A failed link means another caller is replacing the same lock, so return `false`.
3. Read the tombstone. If its text is not `seen`, the lock changed after step 1. Remove the tombstone (the lock itself is untouched) and return `false`.
4. Remove the lock, then create the new lock with exclusive create. Return the result of the create.
5. Remove the tombstone.

Why this is safe: while the tombstone exists, every other caller that saw the same stale text fails at step 2. A slow caller that arrives after step 5 links the new lock, fails the text check at step 3, and removes only its own tombstone. A `link` never removes the lock, so a caller that loses never destroys another caller's lock. The lock file keeps its name, so `removeStartLockFor` and every reader are unchanged.

A crash between steps 2 and 5 leaves a tombstone that would block the takeover of that stale text for ever. The tombstone text is the stale lock text, so its `at` field cannot show its age. Its link time can: `link` updates the file's change time (`ctime`). When step 2 fails with `EEXIST` and the tombstone's change time is more than 20 seconds old, the caller removes the tombstone and returns `false`. It does not continue in the same call, so the next caller does the takeover. A live takeover holds its tombstone for microseconds, so it never reaches 20 seconds.

`LockFs` gains `link(from, to): boolean` (false on `EEXIST` or `ENOENT`) and `ageMs(path): number | null` (time since the change time, null when the file is missing). `takeLock` is exported as `takeStartLock` so a test can drive two callers step by step.

Alternatives:

- **Rename the stale lock to a unique name, then exclusive create** (suggested in the review). Rename is atomic, so only one caller moves a given file. But rename works on the path, not the content. A slow caller B renames whatever the path holds when it runs, which can be A's new lock. B then creates its own lock, and both hold one. Putting A's lock back needs a second step that can race with a third caller. Rejected.
- **A separate takeover guard file.** Only the guard holder may remove a stale lock. A crashed guard holder leaves a stale guard, and removing that guard has the same race one level up. Rejected.
- **Advisory file locks (`flock`).** Node has no built-in API, and Windows differs. Rejected.
- **Bind the port as the lock.** Already rejected in the earlier design.

### 2. Atomic replace for the restart lock

`writeStartLock` in production writes the text to `web-start.lock.<pid>.tmp` and renames it over the lock. Rename replaces the target in one step, so a host never sees a moment with no lock during Restart. `LockFs` gains `replace(path, text)`.

### 3. Restart starts the copy first, then hands over, then watches

New order for the detached path:

1. Replace the lock with one that names the old process.
2. Spawn the copy. The copy is a non-owner while the old process holds the port.
3. **Spawn check.** Fail when `spawn` throws, when the child has no pid, or when it emits `error` or `exit` within 1 second.
4. On failure: remove the lock through `removeStartLockFor(own pid)`, log `Web app restart failed` with a code, and keep serving. The process does not exit.
5. On success: replace the lock with one that names the copy, stop serving, and start the **handoff watch**.
6. **Handoff watch.** Probe `/api/health` on the old server's URL every 250 ms for up to 15 seconds.
   - An OMMS answer means some web app serves the port. Exit with code `0`.
   - A child `exit` event before an answer means the copy died. Serve again at once.
   - No answer after 15 seconds: send `SIGTERM` to the copy (it would otherwise wait as a non-owner forever), then serve again.
7. Serving again calls a new `resumeServer` callback, logs `Web app restart failed` with the code `handoff`, and leaves the process running.

Timing: the copy's health loop notices the stopped server within 5 seconds, adds up to 1.5 seconds of jitter, then binds. Node or Bun start-up adds about 1 second. 15 seconds leaves room for a slow machine.

Login-item path:

1. Stop serving, then call `restartWebAutostart`, as today. `launchctl kickstart -k` kills this process, so a start-first order is not possible here. When the command succeeds, exit with code `0`.
2. When it returns false, spawn a detached copy and run the spawn check. On failure, serve again at once. On success, run the handoff watch.

Both paths share one internal `handOff` function, with a flag that says whether the server already stopped.

`createPowerAction` takes `resumeServer` and `baseUrl` next to `stopServer`, because the web command owns the server. `PowerDeps` gains `removeStartLock`, `probe`, `sleep`, and `now`. `SpawnedChild` gains `kill`, and its `on` accepts `exit` as well as `error`.

`src/cli/web-command.ts` passes `resumeServer`. It re-adds the keep-alive timer and the `SIGINT`/`SIGTERM` handlers that `stopServer` removed, then calls `server.start()`. `WebServer.stop()` sets `startPromise` to `null`, so `start()` runs again. The step-aside path already does this by hand, so its behaviour is unchanged.

Alternatives:

- **Keep stop-then-spawn, and serve again only when the spawn throws.** It misses an asynchronous `error` and a copy that exits at once (for example, a removed package script). Rejected.
- **Check only before the stop, no watch.** A copy that passes the 1-second check and then crashes before it binds leaves nothing running. The watch costs a few lines, so keep it.
- **Tell the copy to bind as soon as the port frees (an environment flag and a fast retry loop).** It would make Restart faster, but it adds a second takeover path to the web server. Rejected for this change.

### 4. Instance value on the status route

`GET /api/web/status` returns `{ version, canControl, instance }`. `instance` is a random UUID made once per process. It is opaque and is not the pid, so the route tells a remote caller nothing about local processes.

`waitForWebApp(previousInstance)` in `web/src/lib/power.ts` replaces the health polling. It polls `/api/web/status` every 500 ms for up to 30 seconds and returns:

- `"restarted"` when a different instance answers. The page reloads.
- `"unchanged"` when the old instance still answers at the end. The page shows a new message: the restart failed and the web app still runs. The page stays usable.
- `"down"` when nothing answers at the end. The page shows the stopped screen, as today.

`PowerButton` keeps the instance from its last status call and passes it in. The old "wait for the old process to go quiet" loop goes away, because the instance check covers it.

The page wait is 30 seconds so that it outlasts the 15-second handoff watch plus the copy's start.

### 5. Docstrings

Add one short docstring to each exported function, type, and constant that PR #51 added or changed and that has none, in the five files the proposal names. Each docstring says why the item exists or a rule a caller must know. Code outside PR #51 gets no new comments. Find the set with `git diff 2a8dd86 91f7457 -- <file>` for each file.

## Risks / Trade-offs

- [Restart is slower: the page waits up to about 7 seconds instead of about 1] → The page shows its restarting state, and the wait is 30 seconds.
- [A tombstone from a crashed takeover] → Removed after 20 seconds by its change time. Two callers that remove the same old tombstone at the same moment can reopen the race once. That needs a crash inside a microsecond window and then a second race, so it is accepted.
- [`link` not supported on a file system] → `link` returns false, the caller waits, and the lock goes stale after 20 seconds. A later caller then replaces it. On a file system without hard links, a stale lock blocks starts until someone removes it. APFS, ext4, and NTFS all support hard links.
- [Linux login item: when `systemctl --user restart` fails, the detached fallback copy lives in the unit's control group. systemd kills it when the old process exits.] → Unchanged from today. The fallback runs only when systemd already failed. The handoff watch sees the copy answer, so it cannot catch this.
- [The service manager accepts the restart and then fails to start the item] → Out of scope. The page reports `down` and shows the start command.
- [`WebServer.stop()` now resets `startPromise`] → Only the step-aside path and the new resume path call `start()` after `stop()`. The step-aside path already reset it.
- [A slow reader keeps a stale view of the lock] → The text check at step 3 of Decision 1 stops it from acting on that view.

## Migration Plan

No data or config changes. Old and new versions share the lock path. An old version that still uses remove-and-create can race with a new version during one upgrade window. The takeover rule in the web server still leaves one owner. Roll back by reverting the change.

## Open Questions

None.
