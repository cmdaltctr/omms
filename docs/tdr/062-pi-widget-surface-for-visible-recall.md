# TDR-062: Pi 1.4.0 widget surface for visible recall

- **ID:** TDR-062
- **Date:** 2026-11-03
- **Status:** Accepted
- **Deciders:** Aizat Hawari
- **Tags:** pi, tui, widget, extension, visible-recall

## Context

The change `add-pi-visible-recall` draws OMMS recall fold rows in Pi's interactive terminal with `ctx.ui.setWidget(key, factory, { placement: "aboveEditor" })`. The repository builds against `@earendil-works/pi-coding-agent` 0.86.1. The user runs Pi 1.4.0. The design left three points open (design "Spike"):

1. Can the extension cut lines to the terminal width without a runtime Pi dependency?
2. Does a second `setWidget` call with the same key replace the widget, and does a terminal resize run `render` again?
3. Does Pi offer an extension store outside the session file and outside the model context, for the fold state?

## Method

- A scratch extension (`spike.js`, plain ESM, outside the repository) drew a factory widget above the editor with 5 lines. A `/scratch-toggle` command redrew it with 30 lines and back to 5. `render(width)` wrote one log line per call to a scratch file. On `session_start` it logged `ctx.mode`, the keys of `ctx`, `ctx.ui` and `pi`, and tried `await import("@earendil-works/pi-tui")`.
- Pi 1.4.0 ran in an Orca terminal: `pi -ne --no-mcp -ns -nc -np -e spike.js`, with a scratch `HOME`, a scratch `PI_CODING_AGENT_DIR` and `PI_CODING_AGENT_SESSION_DIR`, `PI_OFFLINE=1` and no credentials. No prompt was sent and no model was called. The user's `~/.pi/agent` was not read.
- Input came from `orca terminal send`. Output came from `orca terminal read --screen` and the log file. Orca has no resize command, so `stty -f /dev/ttys004 cols 40` changed the pty size from outside. The kernel then sends `SIGWINCH` to Pi.
- The Pi 1.4.0 documentation was read through Context7 (`/earendil-works/pi/v1.4.0`). The 0.86.1 types and documentation were read in `node_modules`.

## Findings

| #   | Question                                                                    | Result on Pi 1.4.0                                                                                                                                                                                                                                                                                                     |
| --- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Does a factory widget draw above the editor?                                | Yes. The screen showed `gen1 line 1/5 w=103 xxx...` to `gen1 line 5/5 ...` directly above the editor rule. The log showed `mode=tui hasUI=true`.                                                                                                                                                                       |
| 2   | Does a redraw replace the widget?                                           | Yes. After `/scratch-toggle` the screen showed `gen2 line 1/30` to `gen2 line 30/30` and no `gen1` line. A second toggle showed `gen3 line 1/5` to `gen3 line 5/5` and no `gen2` line. No flicker was visible in the captures.                                                                                         |
| 3   | Does a resize run `render` again?                                           | Yes. After `stty ... cols 40` the log showed `render gen=2 width=40` and the screen showed `gen2 line 1/30 w=40 xxxxxxxxxxxxxxxxx...`. The longest captured widget line was 40 columns.                                                                                                                                |
| 4   | Is a factory widget capped at 10 lines?                                     | No. All 30 lines drew. `InteractiveMode.MAX_WIDGET_LINES = 10` applies only to a string-array widget, which adds `... (widget truncated)`.                                                                                                                                                                             |
| 5   | How often does `render` run?                                                | On every frame Pi paints, not only on `setWidget`: 4 calls at startup, 22 by the end of the run. `render` must stay cheap.                                                                                                                                                                                             |
| 6   | Does `import("@earendil-works/pi-tui")` work from a built `.js`?            | Yes, from a folder with no `node_modules`: `pi-tui import ok; truncateToWidth=function; visibleWidth=function`. Pi resolves its own packages for an extension. `truncateToWidth("abcdefghijklmnop", 8)` returned `"abcde\u001b[0m...\u001b[0m"`.                                                                       |
| 7   | Is there an extension store outside the session file and the model context? | No. `pi` exposes `appendEntry` (a `custom` entry in the session `.jsonl`) and `getSettings` (read only, absent in 0.86.1). `ctx` and `ctx.ui` hold no store. The 1.4.0 docs (`extensions.md`, "State") map "Data outside one session" to "External storage", and the `codemode` `store()` also writes session entries. |
| 8   | Does a widget reach the session file?                                       | No. The scratch session folder stayed empty after the run.                                                                                                                                                                                                                                                             |

No finding contradicts the design.

## Decision

1. Draw the rows as one factory widget, key `omms-recall`, placement `aboveEditor`. A redraw calls `setWidget` again with the same key. Clearing calls `setWidget("omms-recall", undefined)`.
2. Build the row text once per redraw and let `render(width)` only cut and colour it, because Pi calls `render` on every frame.
3. Cut each line with `truncateToWidth` from `await import("@earendil-works/pi-tui")`, loaded once. The import stays dynamic, so the extension has no static Pi runtime import. If the import fails, a plain code-point cut is the fallback. Cut the plain text first, then colour it with `theme.fg("muted", ...)`.
4. Do not cap the unfolded rows. A factory widget has no 10-line limit, and at most 5 rows show.
5. Keep the fold state in memory only. Pi offers no safe extension store, and a session entry would write row data into the session file. A restart or `session_shutdown` folds every row.

## Consequences

### Positive

- Rows use a supported Pi surface that stays on the screen and out of the session file and the model context.
- No new dependency: Pi supplies `pi-tui` at run time.

### Negative

- Fold state is lost on restart. The docs say so.
- Five unfolded rows with many memories make a tall widget. Pi still draws it, but it pushes the transcript up.

### Neutral

- Outside Pi (for example in a unit test without `pi-tui`), the fallback cut counts code points, so a wide character can make a line wider than the width.

## Alternatives Considered

| Option                                  | Rejected Because                                                                            |
| --------------------------------------- | ------------------------------------------------------------------------------------------- |
| String-array widget                     | Capped at 10 lines, and the host cannot cut lines to the width.                             |
| `pi.appendEntry` for fold state         | Writes to the Pi session file, which the rules forbid.                                      |
| Static `import { truncateToWidth }`     | `tests/pi-adapter-boundary.test.ts` forbids a static runtime import from `@earendil-works`. |
| Own width code with an East Asian table | More code for a case Pi's own helper already handles.                                       |

## How to Recognise / Handle This Again

1. Symptom: a recall row overflows the terminal or breaks the layout after a resize.
2. Check that `render(width)` cuts every line with the `pi-tui` helper, and that the import did not fall back to the plain cut.
3. Re-run the spike: a scratch extension, `pi -ne -e <file>` under a scratch `HOME` and `PI_CODING_AGENT_DIR`, and `stty -f <tty> cols <n>` to resize.

## Revisit Triggers

- Pi adds an extension store outside the session file: move the fold state there (sequence numbers only).
- Pi changes how it resolves `@earendil-works/pi-tui` for extensions, or caps factory widgets.
- Pi adds an event for `ctrl+o` that reaches widgets.

## Live check of the finished change (2026-11-03)

Pi 1.4.0 in an Orca terminal, with a scratch `HOME`, a scratch OMMS store (3 seeded memories), a scratch agent folder with a local Ollama model (`qwen3:0.6b`, no credentials, no network) and `pi -ne --no-mcp -ns -nc -np -e <worktree>`. Your real `~/.omms` and `~/.pi/agent` were not used.

- **Finding that changed the plan:** with no model configured, Pi stops at "No API key found" before `before_agent_start`, so no row can appear. The check therefore needs a model. A local one costs nothing.
- **(a) Row above the editor.** After the prompt "how did we handle om-pi-todo", the screen showed `▸ ● memory [mode=search, query="how did we handle om-pi-todo", limit=3]` above the editor rule. The log recorded one summary (mode `search`, count 3).
- **(b) Fold and unfold.** `/omms-recall` showed `▾ ● memory [...]` with `mode: search`, `query: how did we handle om-pi-todo`, `limit: 3` and 3 memories with relevance and id. A second `/omms-recall` folded it back to `▸`.
- **(c) Width.** At 103 columns the long headlines ended in `...` at exactly 103 characters. In a second Pi in an 80-column pane, every row line was at most 80 characters, with the headlines cut by `...`.
- **(d) Setting off.** `"visibleRecall": false` in the scratch global config removed the row on the next prompt. The summary was still recorded.
- **(e) Session file.** The scratch session file held 6 entries (`session`, `model_change`, `thinking_level_change`, 3 `message`). It had no custom entry, no row text and no memory text.
- **Not run:** a real mouse (the design has no click handling), Pi RPC or print mode, and the project-level `visibleRecall: false` path.
- **Trust prompt:** Pi asks about project extensions when it starts in a project folder. "Trust" was saved in the scratch agent folder only.

## Limits of the method

- No prompt ran, so the real OMMS row was not drawn here. The live check in task 5.2 covers that.
- One terminal (Orca, 103 by 51, then 40 columns). Other terminals were not tried.

## References

- `openspec/changes/add-pi-visible-recall/design.md`
- `src/adapters/pi/recall-rows.ts`
- [TDR-060](./060-opencode-tui-plugin-surface-for-visible-recall.md)
- Pi 1.4.0 `docs/extensions.md` "State", `docs/session-format.md` "CustomEntry"
