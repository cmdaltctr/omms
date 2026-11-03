# Proposal

## Why

OpenCode V2 now shows each OMMS recall as a fold row (`▸ ● memory [mode=search, query="…", limit=N]`). Pi runs the same per-prompt retrieval but shows nothing, so a Pi user cannot see whether OMMS recalled anything or which memories it added. The repository rule says Pi and OpenCode must offer the same user capabilities, and the docs record Pi rows as the one open exception. This change closes it.

## What Changes

- The Pi extension builds a recall summary each time `before_agent_start` adds an `<omms-retrieval>` section. It reuses the host-neutral builder in `src/core/recall-summary.ts` (`buildRecallSummary`, `callTitle`, `unfoldLines`).
- A thin Pi module beside the retrieval keeps the latest 20 summaries for the current session in memory and draws the latest 5 as fold rows in a Pi editor widget (`ctx.ui.setWidget`, placement `aboveEditor`). This is the same place as the OpenCode rows: above the prompt box.
- A `/omms-recall` slash command unfolds all rows, or folds them all when every row is already open. It is the only toggle (no click handling). It is the same command as on OpenCode.
- Rows are drawn only in Pi's interactive terminal mode (`ctx.mode === "tui"`), as OpenCode draws rows only where the host's interactive UI exists. RPC, JSON and print runs, which include om-pi-subagents child sessions, record and draw nothing.
- The existing `visibleRecall` setting gates the rows (global default `true`, a project config can only turn it off). No new setting.
- Memory injection does not change. The section stays in the system prompt, no second retrieval runs, and nothing is added to the session file or the model context.
- The docs remove the recorded host-parity exception.

### Non-goals

- Rows in Pi RPC, JSON or print modes (for example a desktop frontend that drives Pi over `--mode rpc`). They keep today's behaviour, like OpenChamber on OpenCode.
- Click-to-fold on a row. `/omms-recall` is enough.
- A `mode=recent` row. Pi has no opening recent-memories injection, so every Pi row is `mode=search`.
- Rows that survive a Pi restart or a session switch. Summaries live in memory only (lost on restart), as on OpenCode. Fold state is kept only where Pi offers a safe extension store (see the design); it is never written to the Pi session file or the model context.
- Fixing the `before_agent_start` custom-message case (Pi 1.4.0 sends no `prompt` for a run that a custom message starts). It is a separate retrieval bug, reported outside this change.

## Capabilities

### New Capabilities

- `pi-visible-recall`: OMMS recalls made for Pi are kept as structured summaries and shown as fold rows in Pi's interactive terminal, without changing the model context or the session file.

### Modified Capabilities

- None. The `pi-agent-adapter` retrieval and injection requirements stay as they are. The summary format requirements in `opencode-visible-recall` are reused through the shared builder and are not changed.

## Impact

- New: `src/adapters/pi/recall-rows.ts` (ring, fold state, widget drawing, `/omms-recall` command).
- Changed: `src/adapters/pi/extension.ts` (about 10 lines: record after retrieval, clear on `session_shutdown`, register the command).
- Tests: a new `tests/pi-recall-rows.test.ts`, and additions to `tests/pi-extension.test.ts`.
- Live check: a sandboxed Pi run with a scratch `HOME` and store, no model credentials (see tasks 5.2).
- Docs: `docs/pi-adapter.md`, `docs/opencode-adapter.md`, `docs/configuration.md`, `CONTRIBUTING.md`, `AGENTS.md`.
- No new dependency, no `package.json` change, no new export.
