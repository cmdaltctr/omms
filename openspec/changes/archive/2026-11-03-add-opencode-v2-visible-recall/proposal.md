# Proposal

## Why

On Claude Code, every OMMS recall is visible: the `omms-visible` mod draws a fold row (`▸ ● memory [mode=search, query="…", limit=4]`) on each reply, so the user can see that OMMS ran, what it searched with, and which memories it injected. On OpenCode v2 the same recall is silent. Retrieval runs per prompt (`prompt`/`context` hooks) and is added to model system context, so nothing appears in the transcript. The user cannot tell whether OMMS recalled anything, which hides both its value and its failures, and leaves OpenCode behind Claude Code on host parity for visibility.

## What Changes

- The V2 plugin reports each recall it performs (mode, query, item count, and per-memory relevance, id and headline) as a structured recall summary, emitted from the server entrypoint over the plugin RPC channel.
- A new `tui` entrypoint in the published package renders those summaries in the OpenCode terminal TUI as fold rows styled like tool calls, following the Claude Code mod's row format: collapsed `▸ ● memory [mode=…, query=…, limit=N]`, press to fold out mode, query, limit and the recalled memories.
- The recall-summary builder (mode/query/headline extraction from a retrieval section) is host-neutral code in the shared layers, mirroring the logic the Claude Code mod carries in its own `recall.ts`.
- A global configuration toggle turns the visible rows off.
- Package shape gains a `./tui` export; the loader contract and `check:package` cover it.
- Memory injection itself does not change: retrieval stays in system context, the transcript gains no message, and no second retrieval runs to draw a row.

### Non-goals

- Rendering rows in OpenChamber or any non-TUI frontend: the `tui` entrypoint loads in the terminal TUI only. OpenChamber keeps today's behaviour (silent system-context injection). Recorded as a known limitation, not solved here.
- Adding rows for Pi: the shared summary builder lands in core so a Pi surface can adopt it, but Pi renders nothing in this change.
- A visible `memory` tool: OpenCode v2 already exposes the `memory` tool as a direct tool, so tool-call rows already render natively.
- Restoring auto-capture and profile-learning toasts on v2 (separate concern; the server `Context` cannot toast).

## Capabilities

### New Capabilities

- `opencode-visible-recall`: OMMS recalls performed for OpenCode v2 are reported as structured summaries and shown as fold rows in the terminal TUI, without changing model context or the session transcript.

### Modified Capabilities

- None. The `opencode-v2-adapter` injection requirements (system-context injection, no impersonation) are untouched; this change is purely additive reporting and rendering.
