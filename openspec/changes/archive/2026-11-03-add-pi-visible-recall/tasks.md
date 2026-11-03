# Tasks

## 1. Spike in a live Pi 1.4.0 (before module code)

- [x] 1.1 Write a scratch extension outside the repository that sets a factory widget above the editor with 5 lines, then 30 lines, and registers a `/scratch-toggle` command that redraws it. Run it with `pi -ne -e <scratch file>` under a scratch `HOME`, with no prompt sent. Check: `orca terminal read --screen` shows the widget above the editor, the redraw replaces it, and a resize redraws it.
- [x] 1.2 In the same scratch extension, try `await import("@earendil-works/pi-tui")` from a built `.js` file and call `truncateToWidth`. Check: the call works or fails; record which width-cutting path the module uses (design "Spike", point 1).
- [x] 1.3 Fold-state storage: read the extension API types and docs of Pi 1.4.0 and 0.86.1, and try in the scratch extension, for a store that is outside the Pi session file and outside the model context. Check: record whether such a store exists, its name, scope and lifetime. Never use `appendEntry` or a session entry. If none exists, fold state stays in memory only.
- [x] 1.4 Record the findings in a new `docs/tdr/` record and add it to `docs/tdr/README.md`. If a finding changes the plan, update this change with the `openspec-update-change` skill before task 2. Check: the TDR names the Pi version, each result, the chosen width path and the fold-state storage decision.

## 2. Pi recall-rows module

- [x] 2.1 Add `src/adapters/pi/recall-rows.ts`: per-session ring of the latest 20 summaries built with `buildRecallSummary(section, "search", prompt.slice(0, 300))`, a rising `seq`, no record when `ctx.mode !== "tui"`, a log record with mode, count and session id only. Check: `tests/pi-recall-rows.test.ts` covers one record for a section with entries, none for a null section, an entry-free section, and the `rpc`, `json` and `print` modes, the ring limit, and a log record without query or headline text. Break each matching line once and confirm the test fails.
- [x] 2.2 Draw the latest 5 summaries in one widget (`key "omms-recall"`, placement `aboveEditor`) with `callTitle` when folded and `unfoldLines` when open; clear it with `setWidget(key, undefined)` when disabled or empty; cut each line to the render width by the path chosen in task 1.4. Check: tests assert the collapsed text `▸ ● memory [mode=search, query="…", limit=3]`, the unfolded lines, only 5 rows for 7 summaries, and that no line exceeds a width of 20.
- [x] 2.3 Add `toggleAll`: unfold every shown row, or fold all when all are open; a new summary starts folded; `reset` drops summaries and fold state and clears the widget. Check: tests for both toggle directions, a new folded row after unfolding, and reset.
- [x] 2.4 Failure isolation: every `ctx.ui` call sits in `try`/`catch`. Check: a test where `setWidget` and `theme` throw shows no exception from `record`, `toggleAll` or `reset`.
- [x] 2.5 Fold-state storage as decided in task 1.3: if a safe host store exists, keep the set of open row numbers there (numbers only, no memory text) and restore it on redraw; otherwise keep it in memory only. Check: a unit test for the chosen path, and a test that no memory text is written to any store or to the session file.

## 3. Pi extension wiring

- [x] 3.1 In `src/adapters/pi/extension.ts`, call `recallRows.record(ctx, event.prompt, section, CONFIG.visibleRecall !== false)` after a non-null section in `before_agent_start`, keep the returned `systemPrompt` unchanged, call `reset` in `session_shutdown`, and register `/omms-recall`. Check: `tests/pi-extension.test.ts` asserts the same `systemPrompt` with `visibleRecall` on and off, a widget after a recall, no widget in `rpc` mode, and a cleared widget after `session_shutdown`.
- [x] 3.2 `visibleRecall` gate: global `false` and project `false` draw nothing; a config edit applies from the next prompt. Check: tests with the existing config stubs (see `tests/visible-recall-config.test.ts`).
- [x] 3.3 Boundaries and size. Check: `tests/pi-adapter-boundary.test.ts`, `tests/host-neutral-capture-boundary.test.ts`, `tests/plugin-bundle-boundary.test.ts` and `tests/file-size-ceiling.test.ts` pass; `extension.ts` stays under 500 lines; the new module has no static runtime import from `@earendil-works/*`.

## 4. Documentation

- [x] 4.1 `docs/pi-adapter.md`: add a "Recall rows" section after "Footer status" (row format, `/omms-recall` as the only toggle, latest 5, screen only, interactive mode only, summaries lost on restart, where fold state is kept per task 1.3, limits); add the rows to the lifecycle table row for `before_agent_start`; remove the "Pi shows no recall rows" limitation. Check: the guide states the default and both off paths.
- [x] 4.2 `docs/opencode-adapter.md`: rewrite "Host parity" so it records no exception, and remove the "Pi shows no rows yet" limit line under "Recall rows". Check: grep for "Pi shows no" returns no hit in `docs/`.
- [x] 4.3 `docs/configuration.md` "Visible recall": say the setting controls the rows in the OpenCode TUI and in Pi's interactive terminal. Check: the section names both hosts.
- [x] 4.4 `CONTRIBUTING.md`: remove the "One recorded exception" lines from the host-parity step. `AGENTS.md` (`CLAUDE.md` links to it): remove the exception sentence from "Host parity". Check: grep for "recorded exception" returns no hit in `AGENTS.md`, `CONTRIBUTING.md` and `docs/`.

## 5. Verification

- [x] 5.1 Full gate: `bun run ci:local`. Check: the command output shows every test file passing.
- [x] 5.2 Live check in Pi 1.4.0, with user approval first, mirroring the OpenCode check. Setup: build the worktree; use a scratch `HOME` and a scratch OMMS store; seed a few memories with `om-memory-system memory add --directory <scratch cwd>`; start Pi sandboxed in terminal mode (`pi -ne -e <worktree>`) with no model credentials; change nothing in the real `~/.omms` or `~/.pi/agent`. The first run downloads the embedding model once. Drive Pi through an Orca terminal (`orca-cli` skill) and capture the screen text with `orca terminal read --screen`. Run: send one prompt; `before_agent_start` runs before the provider request, so the row appears even though the model call then fails. Check: (a) the capture shows `▸ ● memory [mode=search, query="…", limit=N]` above the editor; (b) `/omms-recall` unfolds it and a second `/omms-recall` folds it; (c) the same checks at a second, narrower terminal width, with every line within the width; (d) `"visibleRecall": false` in the scratch global config removes the row; (e) the scratch session file has no OMMS entry. Tick this task only with the captured screen text for (a) to (e) saved in the TDR notes; without that evidence it stays open.
- [x] 5.3 Run the `openspec-verify-change` skill and `openspec validate add-pi-visible-recall --strict`. Check: both pass.
