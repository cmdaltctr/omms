# Design

## Context

- OpenCode v2 retrieves per prompt (`prompt` hook starts `memory.retrieve`, `context` hook awaits it) and pushes the section into `event.system`. The spec forbids adding it as a user message, synthetic message, or durable history (`opencode-v2-adapter`: "memory injection does not impersonate the user").
- Claude Code's `omms-visible` mod reads the injected `<omms-retrieval>` context from a hidden channel (`session.append`, door `hook-context`) and draws fold rows by intercepting the reply render (`ui.render`, `AssistantMessage`). Rows are screen-only; nothing new reaches the model.
- OpenCode v2 has no hidden-context render hook. What it does have: a server plugin `Context` with `rpc.register` (returns `events.emit`), and a separate `tui` entrypoint (`@opencode/plugin/tui`) running inside the terminal TUI with a SolidJS/opentui `Context` (`ui.toast`, `ui.panel`, `ui.router`, `markdown.registerCodeBlockRenderer`, `storage`, `data.on(event)`, `client: OpenCodeClient`).

The asymmetry drives the design: keep the injection exactly as specified, and carry recall facts to the screen through a separate channel.

## Decision: report summaries from the server, render them in a `tui` entrypoint

1. **Recall summary builder (host-neutral, `src/core/`)** — a port of the mod's `recall.ts` logic: parse `<memory relevance="N%">` entries out of a formatted section, extract headlines (first line under `## Request`, else first line, cut to 140), and produce `{ mode: "search" | "recent", query: string | null, items: { relevance, id?, headline }[] }`. The same builder can later serve Pi or the web UI.
2. **Emission (`src/v2/adapter.ts`)** — where a section is produced today (per-prompt retrieval in the `context` hook; OpenCode v2 has no opening recent-memories recall, so only `search` summaries are produced), build a summary and record it in a bounded per-session ring of the latest 20. A session with a parent session (a subagent) records nothing; the parent is read once per session with `ctx.session.get` and cached, and a failed lookup records anyway so a lookup error never hides a row. The server entrypoint exposes the ring over plugin RPC (`rpc.register` with a `list` handler keyed by session). Emitting `events.emit` as well is allowed, but the TUI must not depend on it (see spike).
3. **Rendering (existing package export `./tui`, `opencode/tui.tsx`)** — the existing `tui` entrypoint (the footer status entry, which loads its logic from `dist/`) also draws the rows; it does not add a second entrypoint (TDR-060). It keeps summaries per session, refreshes on `data.on(...)` session/message events by calling the RPC `list` handler through its `client`, and draws one fold row per summary (the latest 5) in the `session.composer.top` slot using opentui elements. A global slash command `/omms-recall` folds and unfolds the rows from the keyboard. Fold-open state persists via `ctx.storage.store`. The row format mirrors the Claude Code mod exactly: collapsed `▸ ● memory [mode=…, query="…" (60 chars), limit=N]`; unfolded lists mode, query (300 chars), limit, and each memory's relevance, id and headline.
4. **Configuration** — `visibleRecall` in the global config, default `true`; a project config may turn it off but not on (the same off-only rule `captureTrace` and `skillLearning` follow). The gate applies in the `tui` entrypoint; summaries are still recorded when off.

## Placement spike (inline rows vs session panel)

The mod puts rows at the top of the reply. The TUI `Context` has no per-message render hook. Two candidate placements:

- **Inline, via `renderer: CliRenderer`** — opentui renderables placed with the transcript region. Closest to Claude Code, but the API surface for inserting into the transcript layout is undocumented in the SDK types; risky.
- **Session panel, via `ui.panel`** — a supported slot; rows live in a panel the user opens, foldable and persistent, but not above the reply text.

Implementation starts with the spike against the real terminal TUI (opencode 2.2.5): if CliRenderer placement proves stable, ship inline; otherwise ship the session panel and record the gap. The spec is placement-agnostic on purpose: it requires one visible, foldable row per summary, not a specific location.

### Spike result (TDR-060, opencode 2.2.5)

Neither candidate is used. The supported slot `ui.slot({ append: "session.composer.top" })` draws a pressable, foldable row in the session view above the prompt box. `ui.panel` opens full screen and hides the session. `CliRenderer` is not needed. The row sits above the prompt, not above the reply text; the spec names no location, so it stands.

## Server-to-TUI channel spike

Whether `rpc.register(...).events.emit` reaches a TUI plugin was unproven from the 2.0.16 types (the TUI `Context` has no `rpc` domain). The spike proved that `ctx.client.rpc(definition)` gives the TUI both `list` calls and `events.on`. The design therefore commits to a **pull model**: the server records summaries and serves them from an RPC handler; the TUI pulls on `data.on` events (message/part updates) and on session switch. `events.emit` push is an optimisation the spike may confirm, never a dependency.

## Rejected alternatives

- **Marker message in the transcript (synthetic message or fenced block the TUI restyles)**: the only way to get a row truly inline in every frontend, but it violates the existing "does not impersonate the user" requirement, adds durable history to shared transcripts, and either doubles the model context or moves injection out of system context. Revisit only if the user decides visibility in non-TUI frontends outweighs transcript cleanliness; that would be a spec modification, not part of this change.
- **Toast per recall**: `ui.toast.show` exists in the TUI context, but toasts are transient and cannot fold; they also cannot list results.
- **Adding an opening recent recall to v2 so `mode=recent` rows appear**: it would change model context, which this change forbids. The `recent` mode stays in the shared builder for hosts that inject recent memories.
- **Doing it in the V1 plugin (`src/index.ts`) instead**: the V1 `chat.message` path only injects recent memories; the per-prompt retrieval is a V2 hook. Reporting belongs beside the V2 retrieval.

## Package and build

- `package.json` gains a `./tui` export pointing at `dist/tui.js`; the build emits it. `plugin-v2-loader-contract` and `check:package` are extended to cover the new entrypoint. OpenCode resolves a plugin's `tui` entrypoint as the module named `tui` (verified in `@opencode/plugin` `host.js`: `entry(["tui"])`).
- The `tui` entrypoint must stay thin: it imports the summary types and RPC definition, never storage or capture code. Layer boundary tests keep `src/core/` free of TUI imports.

## SDK version caveat

The repo builds against `@opencode/plugin` 2.0.16; the user's opencode is 2.2.5. The spike runs against 2.2.5 before any rendering code is written. If the TUI plugin surface has moved, record the delta in a TDR before continuing.

## Security and privacy

Summaries carry memory headlines (memory content) to the user's screen — the same exposure class as the Claude Code mod and the memory rows in the web UI. Headlines are never logged: the log records mode, count and session id only. The RPC handler serves summaries only within the plugin's own RPC namespace.

## Testing

- Unit tests for the summary builder (parsing, headline rules, truncation, empty cases) — port the mod's `recall.test.ts` cases.
- Adapter test: a retrieval that yields a section records exactly one summary with the right mode; empty/failed/subagent retrieval records none.
- Config test: global off and project-off gates.
- Loader/package tests: `./tui` export exists, contract holds, `check:package` passes.
- Rendering is verified manually in the terminal TUI during the spike and final check; the fold-row formatting logic (title line, truncation) lives in a pure function covered by unit tests, mirroring the mod's `callTitle`.
