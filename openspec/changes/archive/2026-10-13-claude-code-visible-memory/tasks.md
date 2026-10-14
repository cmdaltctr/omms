# Tasks

## 1. Version floor and module entry

- [x] 1.1 Check the minimum version. If Claude Code 2.1.287 can be installed in a scratch folder, run the prototype's tests there with `claude plugin test`, and record whether `tool.register`, `session.append` with door `hook-context`, and `ui.render` for `AssistantMessage` exist. If any is missing, raise the minimum to the lowest version that has them, in `docs/claude-code-adapter.md`, `README.md` and the status requirement text. Verify: the outcome is written in design.md Decision 8.
- [x] 1.2 Add `hooks/omms.jsx` that calls `registerStatus` from `hooks/omms-status.jsx`. Change `omms-status.jsx` to export `registerStatus` with no behaviour change. Point `hooks/hooks.json` `modules` at `./omms.jsx`. Verify: update `tests/claude-plugin-assets.test.ts` to expect `["./omms.jsx"]` and every imported file to exist, and `hooks/omms-status.test.ts` still passes.
- [x] 1.3 Change `scripts/test-claude-mod.sh` to copy every `hooks/*.jsx`, `hooks/*.js` and `hooks/*.test.ts` file, and to write `modules: ["./omms.jsx"]`. Verify: `bash scripts/test-claude-mod.sh` runs the status tests and the new test files.

## 2. Memory ids in injected context

- [x] 2.1 Update `tests/first-message-memories.test.ts` and `tests/memory-context-budget.test.ts` to expect `<memory id="…" relevance="N%">`. Add a restored-session case that expects `### Memory N (mem_…)`. Verify: run each with `bash scripts/run-tests-isolated.sh tests/<file>.test.ts` and confirm they fail on current code.
- [x] 2.2 Write the id in `src/services/context.ts` and in `formatMemoriesForCompaction` in `src/core/retrieval.ts`. Verify: both tests from 2.1 pass, and the budget assertions are unchanged.

## 3. Recall parser shared with Bun

- [x] 3.1 Write `tests/claude-recall-parse-contract.test.ts`. It builds a prompt section, a fresh-session section and a restored-session section with the real OMMS functions, then checks the count, relevance, id and headline that `recalledIn` returns. It also checks that hook context with no OMMS section and a section cut short still parse. Verify: it fails while `hooks/omms-recall-parse.js` is missing.
- [x] 3.2 Add `hooks/omms-recall-parse.js` (no imports), ported from the prototype's `recall.ts`. It reads the id attribute and the `### Memory N (id)` headings, and exports `recalledIn`, `headline`, `queryLine` and `callTitle`. Verify: the test from 3.1 passes. Then break the id regular expression, confirm the test fails, and restore it.

## 4. Recall rows in the reply

- [x] 4.1 Port the prototype's `register.test.ts` to `hooks/omms-recall.test.ts`. Add cases that unfolded rows show ids, and that a restored-session section draws as `mode=recent`. Verify: it fails while `hooks/omms-recall.jsx` is missing.
- [x] 4.2 Add `hooks/omms-recall.jsx`, which exports `registerRecall` and is ported from the prototype's `register.tsx` minus the tool. Call it from `hooks/omms.jsx`. Verify: `bash scripts/test-claude-mod.sh` passes. Then repeat the prototype's mutation checks (no clearing of a claimed recall, no door filter, press ignored, stale prompt kept) in a scratch copy. Each must fail one test.

## 5. Memory tool through the launcher

- [x] 5.1 Port the prototype's `memory-tool.test.ts` to `hooks/omms-memory-tool.test.ts`. Change the argv expectations to `node <root>/bin/omms-launch.mjs --at-least-own-version memory …` with the session working directory. Add a test that the tool is registered with `isDeferred: false`, and that its description names the Bash command it replaces. Verify: it fails while `hooks/omms-memory-tool.jsx` is missing.
- [x] 5.2 Add `hooks/omms-memory-tool.jsx`, which exports `registerMemoryTool`. It covers mode validation, argv building, running through `$.process.run` with a 60-second limit, reading the outcome, and the one-line transcript message when registration fails. Call it from `hooks/omms.jsx`. Verify: `bash scripts/test-claude-mod.sh` passes. Then repeat the prototype's mutation checks (any mode allowed, failure read as success, every tool answered) in a scratch copy. Each must fail one test.

## 6. Skill and docs

- [x] 6.1 Add assertions to `tests/claude-plugin-assets.test.ts`. The skill must name `mcp__omms__memory` in "How to call OMMS". It must have a "Using OMMS in Claude Code" heading whose section names `mcp__omms__memory`, the four refused modes, the `om-memory-system memory` fallback, ids for `forget`, and the note about not saving a captured turn twice. Verify: the test fails on the current skill.
- [x] 6.2 Update `skills/omms-memory/SKILL.md`:
  - "How to call OMMS": a `memory` tool in Pi and OpenCode, `mcp__omms__memory` in Claude Code with the plugin, and the command only when no `memory` tool is listed;
  - add the short "Using OMMS in Claude Code" section that the omms-skill spec requires, in plain English with no Pi or OpenCode steps.

  Verify: the test from 6.1 passes. Load the skill with `/omms:omms-memory` in the live check (7.1) and read it on screen.

- [x] 6.3 Add a "Memory tool and recall rows" section to `docs/claude-code-adapter.md`. It covers what the user sees, the modes and refused modes, the launcher route, the new-session note, and the upgrade note to remove the prototype mod from `CLAUDE_CODE_PLUGIN_DIRS`. Note in `docs/using-memory.md` that injected memories now show their ids. Verify: `bun run check` passes its Markdown format check.
- [x] 6.4 Write `docs/adr/026-claude-code-memory-tool-from-plugin-module.md`. It records why Claude Code gets a tool from a plugin module rather than an MCP server or the Bash-only route, and how this narrows ADR-016. Add it to `docs/adr/ADR_README.md`. Verify: the index lists it.
- [x] 6.5 Write `docs/tdr/045-claude-code-module-loading-and-tool-placement.md` from `docs/tdr/TEMPLATE.md`. It records three findings:
  - a mod folder in `~/.claude/mods` loads only when listed in `CLAUDE_CODE_PLUGIN_DIRS`, while a plugin's own `modules` entry needs no setting;
  - `/reload-plugins` does not rerun `session.start`, so a registered tool appears only in a new session;
  - a tool behind ToolSearch lost to the skill's Bash route, while `isDeferred: false` plus a "use instead of Bash" description won. The live screen reads are the evidence.

  Add it to `docs/tdr/README.md`. Verify: the index lists it.

- [x] 6.6 Check `docs/configuration.md`, `README.md` and `CONTRIBUTING.md` for text that says Claude Code has no `memory` tool or must use Bash, and correct it. Verify: `grep -rn "no memory tool\|has no .memory. tool" docs README.md CONTRIBUTING.md skills` returns nothing stale.

## 7. Live check and gate

- [x] 7.1 Live check with a local plugin copy. Remove `omms-visible` from `CLAUDE_CODE_PLUGIN_DIRS` for the test. Start `claude --plugin-dir <worktree>` in an Orca terminal in this worktree and ask "how did we handle om-pi-todo". Confirm:
  - (a) `mcp__omms__memory` calls show as fold rows and no Bash runs `om-memory-system`;
  - (b) the reply starts with `mode=recent` and `mode=search` rows that unfold to show ids;
  - (c) the footer still shows `● omms: connected`.

  Verify: screen reads from `orca terminal read`, quoted in the PR description.

  Result (2026-10-13, Claude Code 2.1.296): (a) and (c) pass. For (b), both rows show and unfold. They show no ids, because the running OMMS web server is the 4.14.1 release, which writes no ids. `tests/claude-recall-parse-contract.test.ts` covers the ids. They show live after the release.

- [x] 7.2 Run `bash scripts/test-claude-mod.sh` and `bun run ci:local`. Verify: both pass, with the output summary recorded in the PR description.
