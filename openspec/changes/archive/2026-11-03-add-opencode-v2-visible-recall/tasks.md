# Tasks

## 1. Spikes (before rendering code)

- [x] 1.1 Run opencode 2.2.5 terminal TUI with a scratch plugin that has both `server` and `tui` entrypoints: prove the `tui` entrypoint loads, `ctx.rpc` handler calls work from the TUI side, and `data.on` fires for message events. Record findings (and any 2.0.16 → 2.2.5 API drift) in `docs/tdr/`. Check: scratch run log shows both entrypoints alive and a handler round-trip.
- [x] 1.2 In the same scratch plugin, test inline placement via `renderer: CliRenderer` against the session panel via `ui.panel`. Pick the placement per the design's decision rule and note it in the TDR. Check: a rendered fold row is visible and pressable in the real TUI.

## 2. Core recall-summary builder

- [x] 2.1 Add `src/core/recall-summary.ts`: parse `<memory relevance="N%">` entries from a formatted section, headline extraction (`## Request` first line, else first line, 140-char cut), `{ mode, query, items }` summary type, and a pure `callTitle` formatter (60-char query cut, `memory [mode=…, query="…", limit=N]`). Check: new unit tests pass, ported from the mod's `recall.test.ts` cases, and fail when the parser is broken.
- [x] 2.2 Boundary check: no TUI or adapter imports in the new module. Check: `tests/host-neutral-capture-boundary.test.ts` and lint pass.

## 3. V2 adapter reporting

- [x] 3.1 Record summaries: at the per-prompt retrieval site in `src/v2/` (v2 has no opening recent-memories site), build a summary and store it in a bounded per-session ring (latest N). Check: adapter unit test asserts one summary with the right mode for a yielded section, and none for empty, failed, or subagent retrieval.
- [x] 3.2 Expose the ring over plugin RPC with a `list(sessionID)` handler using `ctx.rpc.register`. Check: unit test round-trips the handler against a stub registration; summaries for other sessions are not returned.

## 4. TUI entrypoint

- [x] 4.1 Add the `tui` entrypoint module: subscribe via `data.on`, pull summaries through the RPC handler on message events and session switch, keep per-session state, gate on the `visibleRecall` setting (global default on, project off-only). Check: unit tests cover the gate and the refresh trigger logic against stub contexts.
- [x] 4.2 Render fold rows in the `session.composer.top` slot (spike result, TDR-060): collapsed title from the core `callTitle`, unfold showing mode, query (300 chars), limit, and each item's relevance, id and headline; fold state persists via `ctx.storage.store`. Check: title/unfold formatting covered by unit tests on the pure formatter; manual TUI check shows the row and both fold states.
- [x] 4.3 Failure isolation: when the RPC handler is missing or the entrypoint errors, the TUI keeps working and nothing is thrown into the host. Check: unit test with an unreachable handler; manual TUI run shows no crash.

## 5. Package, build and config

- [x] 5.1 Add the `visibleRecall` setting to `src/config.ts` (global, default true; project off-only) and wire it through the entrypoint gate. Check: config unit tests for both off paths pass; docs grep for the default finds no stale value.
- [x] 5.2 Extend the existing `./tui` export (`opencode/tui.tsx`, the footer entry) to load the recall rows from `dist/`; no second `tui` entrypoint (spike result, TDR-060). Check: `bun run build` emits the new module; `bun run check:package` passes; `tests/plugin-v2-loader-contract.test.ts` extended and green.
- [x] 5.3 File-size ceiling: keep every touched file within its allowance, new files under 500 lines. Check: `tests/file-size-ceiling.test.ts` passes.

## 6. Docs and verification

- [x] 6.1 Update the OpenCode guide (`docs/`) with the visible-recall rows, the `visibleRecall` setting, and the OpenChamber limitation; add the guide entry to `docs/README.md` index if a new file is created. Check: docs mention the default and both off paths.
- [x] 6.2 Full gate: `bun run ci:local` green. Check: command output shows every file passing.
- [x] 6.3 Live check in the real terminal TUI (2.2.5): a prompt shows a `▸ ● memory [mode=search, query="…", limit=N]` row (no `recent` row at open, since v2 has none); folding works; turning the setting off removes the rows. OpenChamber is not run live: it does not load the TUI entry (proposal non-goal), and the unchanged injection is pinned by the `v2-recall-reporting` test. Check: notes recorded in TDR-060 ("Live check of the finished change").
- [x] 6.4 Host-parity note: the summary builder is shared in `src/core/`; record in the docs that Pi rendering is a future change. Check: `CONTRIBUTING.md` host-parity wording still holds or is updated in the same change.
