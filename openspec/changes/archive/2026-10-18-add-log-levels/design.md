## Context

`src/services/logger.ts` exports one function, `log(message, data?)`. Pi, OpenCode, Claude Code hooks, the CLI and the web app all write through it to `~/.omms/omms.log`. `src/services/settings-log.ts` reads the last 256 KB and returns raw lines to `GET /api/settings/log`. The Settings `LogSection.tsx` shows them in a `<pre>` box.

64 test files replace the logger with `mock.module("../src/services/logger.js", () => ({ log: ... }))`. Those stubs export `log` only.

OMRG's `web/src/settings/LogSection.tsx` and `LogPanel.tsx` are the visual model: level chips, a `Badge` per record, Pause and Resume, follow-at-bottom scrolling, and a copy action for the visible lines. OMRG streams records over server-sent events from an in-memory buffer. OMMS has a file shared by several processes instead.

## Goals / Non-Goals

**Goals:**

- Every new line carries a level, and the existing call sites get the right one.
- Older lines still show, with a guessed level.
- The Settings log matches OMRG's layout and behaviour within the OMMS design system.

**Non-Goals:**

- No `debug` level and no level threshold setting. Nothing writes below `info` today.
- No change to rotation, retention, file location or the capture trace.
- No server-sent events stream.
- No change to the `console.warn`/`console.error` calls that hooks send to stderr.

## Decisions

### A level is the optional third argument of `log`

`log(message, data?, level?: "warn" | "error")`. The alternatives were `log.warn()` methods or new `logWarn`/`logError` exports. Both break the 64 test stubs: a stub without the export fails the import, and a stub without the method throws at the call. A third argument passes through every stub unchanged. A call with no data and a level passes `undefined` as data.

### Line format `[time] LEVEL message: {data}`

The level token sits right after the timestamp, in upper case, so `grep ERROR` works in a terminal. `INFO` is written as well, so a reader can tell a new `info` line from a legacy line. No code outside the logger parses the line format today.

### Guessing reads the message only

A legacy line splits at the first `: {` or `: [`. Only the part before that is matched, because data such as `{"error":null}` would turn routine records into false errors. A guessed record carries `guessed: true`, and the badge says so. The guess lives in `settings-log.ts` as a pure function with its own tests.

### Call sites are tagged by reviewed rule, not by blind rewrite

An `ast-grep` scan lists every `log(...)` call whose message matches the error or warn words from the guessing rule. Each match is reviewed before it gets a level, because some messages describe a normal outcome, for example `Capture attempt` with a failure count of 0. The scan output goes in the task notes, so the reviewer can see each decision.

The scan found 324 calls and tagged 187 (147 `error`, 40 `warn`). A second scan for `$OBJ.log(...)` covers modules that receive the logger as a dependency, such as `web-update.ts` and `web-power.ts`. Their dependency type takes the same optional level. It tagged two more calls as `error`, for 189 in total. The list with a decision per call is in `call-sites.md`.

### Eight over-ceiling files get a higher ceiling

A third argument makes Prettier put each argument of a long `log(...)` call on its own line. Eight files that are already over 500 lines grew by 4 to 29 lines each, 124 lines in total, and `tests/file-size-ceiling.test.ts` forbids growth. The decision is to raise those eight entries by exactly the growth: `src/index.ts` 813, `src/adapters/opencode/profile-learning.ts` 832, `src/services/web-server.ts` 1837, `src/services/user-profile/user-profile-manager.ts` 1947, `src/importer/claude-hook-api.ts` 552, `src/services/ai/providers/openai-chat-completion.ts` 548, `src/services/turso/shard-manager.ts` 624 and `src/services/api-handlers.ts` 1351. The growth is formatting only. Splitting those files is a separate change.

### The API returns records and filters on the server

`GET /api/settings/log?lines=200&filter=capture&level=warn` returns `{ path, records: [{ seq, time, level, guessed, message, data }] }`. `seq` is the record's line number within the tail that was read, so the panel can keep React keys stable. Server-side filtering keeps the 200-record limit meaningful: **Error** shows the last 200 errors, not the errors among the last 200 lines. The web-server handler stays three lines, because `web-server.ts` is over the size ceiling.

### Polling every 5 seconds

The panel re-reads the tail every 5 seconds while it is on screen (an `IntersectionObserver`), the tab is visible and the user has not paused. A file read of at most 256 KB on loopback is cheap, and several processes write to the file, so an in-memory stream like OMRG's would miss lines from other hosts.

### Badge colours come from existing tokens

`badge.tsx` gains `info` and `warning` variants built on `--status-info` and `--status-warning`. `error` uses the existing `destructive` variant. The badge text spells the level, so colour is never the only signal (WCAG 2.2 AA, 1.4.1).

### Shared panel component

`LogPanel.tsx` holds the record list and the follow-at-bottom scrolling, as in OMRG. `LogSection.tsx` keeps the controls. Both stay well under 500 lines.

## Risks / Trade-offs

- [A wrong level on a call site] → each tagged call is reviewed, and the spec's example scenarios have tests.
- [A guessed level is wrong for an old line] → the badge says "guessed". Old lines leave the 30-day retention window anyway.
- [Polling costs CPU while the page stays open] → the panel polls only while it is visible and not paused.
- [External scripts that grep for `] Capture attempt`] → the message text does not change, so `grep "Capture attempt"` still works. A pattern anchored on `] Capture` will miss. Note this in the changelog.

## Migration Plan

No data migration. Old lines stay as they are and read with a guessed level. A rollback restores the old reader, which still reads both formats as raw text.

## Open Questions

None.
