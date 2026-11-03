# Design

## Decisions from the user

Recorded on 2026-11-03. They answer the open questions of the first draft.

1. **Toggle.** `/omms-recall` (fold or unfold all rows) is enough. No click-to-fold, no mouse spike item.
2. **Non-terminal modes.** Pi RPC, JSON and print modes show no rows. This follows OpenCode, which draws rows only where the host's interactive UI exists. The rule "record and draw only when `ctx.mode` is `tui`" stays and also covers om-pi-subagents children. There is no plain-text row for RPC.
3. **Live check.** Mirror the OpenCode check: scratch `HOME`, scratch OMMS store with a few seeded memories (`om-memory-system memory add --directory <scratch cwd>`), Pi started sandboxed in terminal mode (`pi -ne -e <worktree>`), no model credentials, no change to the real `~/.omms` or `~/.pi/agent`. Send one prompt and check that the row appears (retrieval runs before the model request), then fold and unfold with `/omms-recall`. The first run downloads the embedding model once. Drive it through an Orca terminal and capture the screen text, at two terminal widths. The live check task is ticked only with that evidence.
4. **State.** Summaries are in memory only and are lost on restart, as on OpenCode. Fold state goes in a host-provided place only if that place is neither the Pi session file nor the model context. Whether Pi's extension API offers such a store is a spike question. If it does not, fold state is in memory only and the docs say so. Memory text is never written to Pi session files.

## Context

- Pi retrieves memory once per user prompt. `before_agent_start` in `src/adapters/pi/extension.ts` (lines 285 to 317) calls `buildRetrievalSection` from `src/core/retrieval.ts` and returns `systemPrompt: event.systemPrompt + "\n\n" + wrapRetrievalSection(section)`. Nothing appears in the transcript.
- Pi has no opening recall. `session_start` only loads config, warms storage and starts background jobs. So every Pi summary is `mode=search`.
- `before_agent_start` fires once for each run, not for each model step. One prompt gives at most one retrieval, so the OpenCode "token" de-duplication is not needed.
- The host-neutral builder exists: `buildRecallSummary(section, "search", query)`, `callTitle(summary)` and `unfoldLines(summary)` in `src/core/recall-summary.ts`.
- Pi runs in four modes (`tui`, `rpc`, `json`, `print`). Only `tui` has the interactive UI that draws widgets.
- The footer glyph is drawn with `ctx.ui.setStatus("omms", ommsStatusLabel(...))`, guarded by `ctx.hasUI` (extension.ts lines 97 to 115).
- The repository builds against `@earendil-works/pi-coding-agent` 0.86.1. The user runs Pi 1.4.0 (`~/.pi/agent/install/current-version`). Every API below exists with the same signature in both versions' `dist/core/extensions/types.d.ts`.

## Pi UI surfaces checked

| Surface                                                        | Screen only?                                                                                                                                    | Foldable?                                                                      | Verdict                                      |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------- |
| `ctx.ui.setWidget(key, content, { placement: "aboveEditor" })` | Yes. Kept in the interactive mode's widget maps, never written to the session file.                                                             | Yes, by redrawing with new content. A command or shortcut toggles it.          | **Chosen**                                   |
| `pi.appendEntry` + `pi.registerEntryRenderer`                  | Not in the model context (types.d.ts: "Custom entries do not participate in LLM context"). Written to the session `.jsonl` as a `custom` entry. | Yes, follows Pi's `ctrl+o` expansion (`setExpanded(this.toolOutputExpanded)`). | Rejected, see below                          |
| `pi.sendMessage` + `pi.registerMessageRenderer`                | No. Custom messages "participate in LLM context" (extensions.md).                                                                               | Yes                                                                            | Rejected: changes the model context          |
| `BeforeAgentStartEventResult.message`                          | No. It is a `CustomMessage`, so it reaches the model.                                                                                           | Yes                                                                            | Rejected                                     |
| `ctx.ui.notify`                                                | Yes                                                                                                                                             | No, transient                                                                  | Rejected, as on OpenCode                     |
| `ctx.ui.setStatus`                                             | Yes                                                                                                                                             | No, one footer line                                                            | Rejected: the footer already holds the glyph |

Evidence (Pi 1.4.0 install, read-only):

- `dist/core/extensions/types.d.ts`: `WidgetPlacement = "aboveEditor" | "belowEditor"`, `setWidget(key, string[] | factory, options)`, `registerCommand`, `registerShortcut`, `ExtensionMode = "tui" | "rpc" | "json" | "print"`, `ctx.mode`.
- `dist/modes/interactive/interactive-mode.js`: `setExtensionWidget` stores the component in `extensionWidgetsAbove`/`Below`; a string array becomes `Text` components and is cut at `MAX_WIDGET_LINES = 10` with "... (widget truncated)"; a factory component has no line cap. `resetExtensionUI()` clears widgets when the session is invalidated (new, resume, fork, reload).
- `docs/tui.md` "Pattern 5: Widgets Above/Below Editor" and "Line Width": each line from `render(width)` must not exceed `width`.
- `docs/rpc.md`: in RPC mode `setWidget` is a fire-and-forget `extension_ui_request`; only string arrays are sent, factories are ignored.
- Context7 `/earendil-works/pi/v1.4.0`, `docs/extensions.md` "State": "Durable data excluded from model context: `pi.appendEntry()`"; `docs/session-format.md` "CustomEntry: Does NOT participate in LLM context".

## Decision: an editor widget, drawn by a thin Pi module

1. **Recording (`src/adapters/pi/recall-rows.ts`, new).** `createPiRecallRows()` returns `record(ctx, prompt, section)`, `toggleAll(ctx)`, `redraw(ctx)` and `reset(ctx)`. `record` returns at once when `ctx.mode !== "tui"` (user decision 2). Otherwise it calls `buildRecallSummary(section, "search", prompt.slice(0, 300))`, gives it the next `seq`, and keeps the latest 20 (same limits as `src/v2/recall-reporter.ts`). It logs `{ sessionID, mode, count }` only. Every host call sits in `try`/`catch` and never throws into Pi.
2. **Wiring (`extension.ts`).** In `before_agent_start`, after `finishStatus(...)` and only when `section` is non-null, call `recallRows.record(ctx, event.prompt, section)` and then return the same `systemPrompt` as today. `session_shutdown` calls `recallRows.reset(ctx)`. `pi.registerCommand("omms-recall", ...)` calls `refreshConfigIfChanged(ctx.cwd)` and then `toggleAll`. About 10 added lines keep `extension.ts` under 500.
3. **Drawing.** `extension.ts` passes `enabled: CONFIG.visibleRecall !== false` into `record`, `toggleAll` and `redraw`, so the new module does not import `CONFIG` (the partial config stubs in tests stay valid). The extension already calls `refreshConfigIfChanged(ctx.cwd)` at the start of `before_agent_start`, so a config edit applies from the next prompt. When off, or with no summary, it calls `ctx.ui.setWidget("omms-recall", undefined)`. Otherwise it sets a factory widget with placement `aboveEditor`. Its `render(width)` returns, for each of the latest 5 summaries, `▸ ` or `▾ ` plus `● ` plus `callTitle(summary)` when folded, and the indented `unfoldLines(summary)` when open. Each line is cut to `width` before colour is added. Colours come from `ctx.ui.theme` (for example `accent` for the bullet and `muted` for the body; the spike picks names that match Pi's own tool rows).
4. **Fold state.** A `Set` of open `seq` numbers, per session, in memory. `/omms-recall` opens all shown rows, or closes them all when all are open, then redraws. It is the only toggle (user decision 1). A new summary starts folded. Fold state goes with its summary on `session_shutdown`. OpenCode keeps fold state through `ctx.storage`. If the spike (point 3) finds a Pi extension store that is not the session file and not the model context, the module may keep fold state there. Otherwise fold state stays in memory only and `docs/pi-adapter.md` says so. Pi session entries (`appendEntry`) are not such a store. Summaries stay in memory only in every case.
5. **Configuration.** Reuse `visibleRecall` (`src/services/visible-recall-config.ts`). No new key. Summaries are still recorded when the setting is off, as on OpenCode, so turning it back on shows them from the next redraw.

## Child and subagent sessions

- OpenCode skips a session with a `parentID`. Pi has no such field for agent children. `SessionHeader.parentSession` exists, but Pi sets it for `/fork`, `/clone` and `newSession({ parentSession })`. Those are the user's own interactive sessions and must show rows.
- om-pi-subagents 0.10.0 (`src/runner.ts`) starts each child with `--mode rpc --no-session --no-extensions`, plus `-e` paths for mapped extensions. OMMS loads in a child only when an agent maps it, and the child gets `OMPS_CHILD=1`, `OMMS_DISABLE_WEB_AUTOSTART=1` and `OMMS_DISABLE_AUTO_BACKFILL=1`.
- Pi's own subagent example starts children with `--mode json -p --no-session`.
- So the rule is `ctx.mode === "tui"`. It covers both child launchers without reading an environment variable that one extension owns. It also keeps RPC frontends unchanged, which matches the OpenChamber non-goal on OpenCode.

## Spike (task 1, before any code)

The API is typed, but three points are unproven in a live Pi 1.4.0:

1. **Width cutting without a runtime Pi dependency.** The extension imports Pi types only, and `@earendil-works/pi-tui` is not a dependency or a peer dependency. The spike checks whether a dynamic `import("@earendil-works/pi-tui")` (`truncateToWidth`, `visibleWidth`) resolves through Pi's extension loader for the built `dist/` file. If it does not, the module cuts plain text by code points before colouring and treats East Asian wide characters as 2 columns. If neither is reliable, the module falls back to the string-array form, which Pi wraps itself, and accepts the 10-line cap (5 folded rows fit; an unfolded view shows what fits).
2. **Redraw.** Confirm that calling `setWidget` again with the same key replaces the old widget without flicker, and that the factory `render` reruns on terminal resize.
3. **Fold-state storage.** Does Pi's extension API offer extension storage that lies outside the session file and outside the model context (for example a per-extension key-value store or a file path the host provides)? Read the types and docs of Pi 1.4.0 and 0.86.1 and try it in the scratch run. If yes, record its name, its scope (session or global) and its lifetime. If no, fold state stays in memory and the docs say so. Never use `appendEntry` or any session entry for it.

Record the findings in a new `docs/tdr/` record and add it to the index.

## Rejected alternatives

- **Custom entry with an entry renderer.** It would sit inline in the transcript and follow `ctrl+o`, which is the closest match to a tool row. But `appendEntry` writes memory headlines into the Pi session `.jsonl`. The repository rules say "Never write ... to Pi session files", and OMMS's own Pi history importer and live capture read those files. It would also put memory text into files that users share or export. Revisit only if the user accepts that trade.
- **Custom message.** Reaches the model. Forbidden by the "does not change model context" rule.
- **Rows in RPC, JSON or print mode (string widgets or plain text).** This would also put rows into om-pi-subagents children, whose supervisor reads RPC output. Left out on purpose (user decision 2), as OpenCode draws rows only where the host's interactive UI exists.
- **Click-to-fold.** Not wanted (user decision 1). `/omms-recall` is the only toggle.
- **Following `ctrl+o`.** `setToolsExpanded` updates only the header and chat container children, not widgets, and no extension event reports the change. A widget `render` could read `ctx.ui.getToolsExpanded()`, but no redraw is guaranteed. Not used unless the spike proves it.

## Security and privacy

Rows carry memory headlines to the user's screen, the same exposure as the OpenCode rows and the web UI. Nothing is logged except mode, count and session id. Summaries are written nowhere. Fold state goes to disk only if the spike finds a safe host store, and then it holds sequence numbers only, never memory text. The widget is not sent in RPC mode because the adapter does not record there.

## Testing

- `tests/pi-recall-rows.test.ts`: records one summary for a section with entries; none for a null section, a section with no entries, or `ctx.mode` of `rpc`, `json` or `print`; ring keeps 20; widget shows the latest 5; `/omms-recall` toggles all and keeps a new row folded; `visibleRecall` false (global and project) clears the widget; a throwing `setWidget` does not throw; every rendered line fits a narrow width; the log record has no query or headline. Each test must fail when the matching line of the module is broken.
- `tests/pi-extension.test.ts`: the returned `systemPrompt` is the same with rows on and off; `session_shutdown` clears the widget; the stub `ctx.ui` gains `setWidget` and `theme`.
- `tests/pi-adapter-boundary.test.ts` and `tests/host-neutral-capture-boundary.test.ts` stay green: the new module is in `src/adapters/pi/` and imports only `src/core/recall-summary.ts`, the logger and Pi types.
