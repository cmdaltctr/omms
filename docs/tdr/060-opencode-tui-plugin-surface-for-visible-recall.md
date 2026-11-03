# TDR-060: OpenCode 2.2.5 TUI plugin surface for visible recall

- **ID:** TDR-060
- **Date:** 2026-11-03
- **Status:** Accepted
- **Deciders:** Aizat Hawari
- **Tags:** opencode, tui, rpc, plugin, visible-recall

## Context

The change `add-opencode-v2-visible-recall` draws one fold row per OMMS recall in the OpenCode terminal TUI. The design assumed three unproven points: a `tui` entrypoint can pull data from the server entrypoint, the TUI sees message events, and a row can sit inline or in a panel. The repo builds against `@opencode/plugin` 2.0.16. The installed OpenCode is 2.2.5. Tasks 1.1 and 1.2 test the three points on 2.2.5 before any rendering code exists.

## Method

- A scratch plugin (not in the repo) has three entrypoints: `rpc.js` (shared definition), `server.js` and `tui.js`. It writes one log line per step to a file.
- The server registers an RPC `list` handler with `ctx.rpc.register`, records a summary in the `prompt` hook, and calls `events.emit`.
- The TUI pulls through `ctx.client.rpc(definition)`, listens with `ctx.data.listen`, and claims the slots `session.composer.top`, `session.panel` and `sidebar.content`.
- It ran in a real terminal TUI (`opencode --standalone`, version 2.2.5) inside an Orca terminal, with its own `OPENCODE_CONFIG_DIR`. The user's config, plugins and background service were not used.
- Input came from `orca terminal send`: typed text, control keys and a synthetic SGR mouse click. Output came from `orca terminal read` and the log file.
- The model call hit the free-message limit, so no tokens were spent. The `context` hook and `session.message.*` events were therefore not exercised.

## Findings

| #   | Question                        | Result on 2.2.5                                                                                                                                                                                                                                                                                                               |
| --- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Do both entrypoints load?       | Yes. The host resolves `server` (or `index`), `tui` and `rpc` from a plugin folder or package. The server setup and the TUI setup both ran, and `ctx.client.rpc` was present in the TUI.                                                                                                                                      |
| 2   | Does an RPC call work from TUI? | Yes. `client.rpc(definition).list({ sessionID })` returned the server's ring. The call ran at slot render and on each session event.                                                                                                                                                                                          |
| 3   | Does server push reach the TUI? | Yes. `registration.events.emit("recall", data)` (name first, then data) arrived in `client.rpc(definition).events.on("recall", ...)`. A first try with one argument failed: `Unknown RPC event`.                                                                                                                              |
| 4   | Which events does the TUI see?  | `ctx.data.listen` saw `session.created`, `session.inbox.enqueued`, `session.inbox.delivered`, `session.execution.started`, `session.execution.failed`, `session.instructions.updated`, `session.step.started`, `session.step.failed`, `session.viewed`, `model.updated`, `provider.updated` and the pushed `rpc.<id>.recall`. |
| 5   | Where can a row go?             | `ui.slot({ append: "session.composer.top" })` draws in the session view, above the prompt box. A mouse click toggled the row between `▸` and `▾`.                                                                                                                                                                             |
| 6   | Can a keyboard fold it?         | Yes. `ctx.keymap.layer(() => ({ mode: "global", commands: [{ id, title, palette: true, slash: { name } }] }))` listed the command in the slash menu and toggled the row. Without `mode: "global"` the command is missing (the default mode is `base`).                                                                        |
| 7   | Does `ui.panel` fit?            | No. `ui.panel.open(name)` rendered the `session.panel` slot as a full-screen view that hid the session. It is not a place for a few rows.                                                                                                                                                                                     |
| 8   | Is `CliRenderer` needed?        | No. Slots give a supported placement, so the unsupported inline route is not worth the risk.                                                                                                                                                                                                                                  |
| 9   | Does the plugin reload on edit? | Yes. Editing the plugin files reloaded both entrypoints (cleanup, then setup) without restarting OpenCode.                                                                                                                                                                                                                    |
| 10  | Is the exit error ours?         | No. `ClientError: Transport: ECONNRESET` on `/api/event` prints at exit with the plugin and without it (control run with an empty config). It is host noise.                                                                                                                                                                  |

### Drift from the design

- **A `./tui` export already exists.** `package.json` exports `./tui` as `./opencode/tui.tsx`, the footer status entry (`id: "omms.tui"`). OpenCode compiles that source file itself, and it imports the host's `solid-js` and JSX runtime through the `opentui:runtime-module:*` virtual modules (no JSX, see anomalyco/opencode#39986). The design planned a new `dist/tui.js`. The change extends the existing entry instead.
- **The TUI `Context` has no `rpc` domain, but `ctx.client` does.** The design said the TUI could not call plugin RPC. It can, and push works as well as pull.
- **The types in the repo already match 2.2.5 for this surface.** The 2.0.16 declarations list `ui.slot`, the `session.composer.top` slot and `client.rpc`. No other drift appeared in the points tested.

## Decision

1. Draw rows with `ui.slot({ append: "session.composer.top" })`. This replaces both candidates in the design (`renderer: CliRenderer` and `ui.panel`).
2. Use pull as the base and push as the refresh signal: the TUI calls the RPC `list` handler at render, on session events and on a pushed `recall` event. Missing push never breaks the rows.
3. Fold by mouse click and by a global slash command, so the keyboard can reach it.
4. Extend `opencode/tui.tsx` and `dist/adapters/opencode/` instead of adding `dist/tui.js`.
5. Keep the TUI code free of JSX and use the `opentui:runtime-module:*` imports, as the footer entry does.

## Consequences

- The row sits above the prompt box, not above the reply text as in Claude Code. The spec stays valid because it names no location.
- The package keeps one TUI entry. Tasks 4.1, 4.2 and 5.2 change accordingly.
- Slot rows draw only in frontends that load the TUI entry. OpenChamber shows nothing new.

## Live check of the finished change (2026-11-03)

Run in an Orca terminal on opencode 2.2.5 with this worktree's built plugin (`dist/`), a scratch `HOME` and OMMS store (three seeded memories), the local Ollama model `qwen3:0.6b`, and `visibleRecall` at its default.

- A prompt "how did we handle om-pi-todo" drew `▸ ● memory [mode=search, query="how did we handle om-pi-todo", limit=3]` above the prompt box. The server log recorded one summary (mode `search`, count 3).
- `/omms-recall` appeared in the slash menu and unfolded the row to `mode`, `query`, `limit` and three memories with relevance, id and headline.
- A synthetic mouse click on the row folded it. The first attempts missed because the row sat at another line than I guessed; clicking the line the row reported (`y=35`) worked.
- `"visibleRecall": false` in the global config removed the rows on the next prompt. The `list` reply carried `enabled: false` and the server still recorded summaries. Removing the line brought the rows back.
- A new session showed no rows. Going back to the first session via `/sessions` showed its two rows again.
- With the server push disabled in a copy of the built file, the row still appeared, so the pull path alone is enough.
- The injected section is unchanged: the model request and transcript carry the same text as before, which the unit test `v2-recall-reporting` (g) pins.
- Not run: OpenChamber (the spec expects no change, because it does not load the TUI entry), a real mouse, and a second terminal width.

## Review findings fixed

An independent read-only review found six items. Fixed with tests that fail on the old code: stale rows after a session switch, a memory quoting `<memory ` creating a phantom item, subagent sessions recording summaries, the `/omms-recall` command vanishing after a slot remount. The review also showed that a refresh on every `session.*` event caused about 40 `list` calls per reply; the TUI now refreshes on six event types only (`session.created`, `session.viewed`, `session.execution.started`, `session.execution.succeeded`, `session.step.started`, `session.step.ended`). The sixth item (no `recent` producer on v2) changed the spec instead of the code.

## Limits of the method

- The model call failed, so a reply never started. A run with a working model should confirm that a recall summary appears for the same prompt that the `context` hook injects (task 6.3).
- Mouse input was a synthetic SGR click. A real mouse was not used.
- The spike covered one session and one terminal width (98 by 51).

## Revisit Triggers

- OpenCode removes or renames the `session.composer.top` slot, `client.rpc` or the `rpc` entrypoint.
- OpenCode adds a per-message render hook. Rows could then sit above the reply.

## References

- `openspec/changes/add-opencode-v2-visible-recall/design.md`
- `opencode/tui.tsx`
- `node_modules/@opencode/plugin/dist/tui/context.d.ts`
- anomalyco/opencode#39986
