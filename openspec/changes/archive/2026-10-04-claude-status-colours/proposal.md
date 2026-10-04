# Proposal

## Why

Claude Code draws a plugin's status row with a yellow `⚠` prefix, so a healthy `omms: connected` looks like a warning. The plugin API gives `$.ui.status(text)` no colour or level, so OMMS cannot fix the row it uses now. Users read the yellow sign as a fault and lose trust in the line.

## What Changes

- The OMMS state moves from Claude Code's plugin status row to the prompt footer. It shows at the right, beside Claude Code's own mode labels (`focus`, `memory paused`).
- The label shows a coloured dot by state:
  - green: `omms: connected`
  - yellow: `omms: connecting`. This is a new state. It shows from session start until the first health check answers.
  - red: `omms: web app off` and `omms: not installed`
- The `· <version> available` suffix stays and is dim.
- The plugin stops calling `$.ui.status`. The `⚠` row goes away.
- The update toast does not change.
- The status module becomes a `.jsx` file, so it can draw a tree. Claude Code compiles it. The plugin adds no build step.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `claude-code-adapter`: the "Claude Code shows OMMS status under prompt" requirement changes where the state shows and adds colours and a `connecting` state. The "Claude Code tells user about newer OMMS release" requirement changes where the `· <version> available` suffix shows.

## Impact

- `hooks/omms-status.js` becomes `hooks/omms-status.jsx`. `hooks/hooks.json` `modules` changes with it.
- `hooks/omms-status.test.ts` and `scripts/test-claude-mod.sh` change with it.
- `docs/claude-code-adapter.md` "Status line" section and `docs/upgrading.md`.
- Claude Code 2.1.287 or later stays the minimum. The `SessionMode` render site must exist in that version (task 1 checks).
- OpenCode and Pi do not change. Each host draws its own footer.
