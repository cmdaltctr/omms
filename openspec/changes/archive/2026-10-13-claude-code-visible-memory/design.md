# Design

## Context

See proposal.md for why. These facts shape the approach:

- **Plugin source:** Claude Code installs the plugin from the repository's `stable` branch, not from the npm package. Files under `hooks/` reach users without a change to `package.json` `files`.
- **Existing module:** the plugin already loads one module, `hooks/omms-status.jsx`, through `modules` in `hooks/hooks.json`. That module runs the launcher with `$.process.run` and finds it through `$.plugin.root`.
- **One module path:** the module guide for Claude Code 2.1.296 says a plugin's hooks module is one file that `hooks.json` names under `modules`. Files that the module imports from the plugin are loaded with it.
- **Launcher arguments:** the launcher passes any arguments through. `node <root>/bin/omms-launch.mjs --at-least-own-version memory search --query x` therefore runs the newest local copy that is new enough, or else the plugin's version through `npx`.
- **Prototype:** the working prototype (`~/.claude/mods/omms-visible`) has 31 passing `claude plugin test` tests. Two of its assumptions held in a live session on 2.1.296:
  - the hooks' added context reaches modules as a `session.append` row with door `hook-context`;
  - the first block of a reply keeps one `requestId` while it streams.
- **Tool placement:** a plugin tool behind ToolSearch was not used. With `isDeferred: false` and a "use instead of Bash" description, the model used it.
- **Recall formats:** prompt and fresh-session recall use `<memory relevance="N%">` blocks inside `<omms-retrieval>` (`src/services/context.ts`). Restored-session recall uses `### Memory N` headings (`src/core/retrieval.ts`). No spec pins either format. Two Bun tests (`first-message-memories`, `memory-context-budget`) do.
- **Mod tests:** `ci:local` does not run module tests. They run through `scripts/test-claude-mod.sh` (TDR-025).

## Goals / Non-Goals

**Goals:**

- Every plugin user gets the tool and the recall rows on install or update, with no settings change.
- The tool keeps the plugin's rule of no global install, by using the launcher.
- A change to the injected text format fails a Bun test in `ci:local`, rather than silently breaking the cards.

**Non-Goals:**

- A capture row after each reply.
- Changing what is recalled or how much.
- Mouse support beyond what a Claude Code `Button` gives.
- Any change to Pi or OpenCode other than the shared memory id attribute.

## Decisions

### 1. One entry module that composes three parts

`hooks/hooks.json` names `./omms.jsx`. That file calls `registerStatus`, `registerMemoryTool` and `registerRecall`, each exported from its own file. Each part keeps its own hooks and state, except `session.start`.

**Found during task 5.2.** The module loader refuses three patterns:

- a second `on("session.start")` with no matcher, in any file of the plugin;
- keeping the return value of a function that receives `on`;
- passing `$` into a function imported from another file, and writing an atom that another file declares.

A `modules` list with two entries also loads nothing ("names none in modules"). So `omms.jsx` owns the one `session.start` hook. It registers the tool before `next` and starts the status checks after `next`, as the two parts did before. The status file keeps the label drawing and exports its constants and pure helpers. The tool file keeps `tool.call` and exports the tool's name, description and schema. The entry declares the same `{ plugin: "omms", key: "label" }` atom that the status file reads.

Alternative: list three modules. The guide says one path, so this risks a load failure on some versions.

Alternative: put everything in `omms-status.jsx`. That gives one file several jobs.

### 2. The tool runs the launcher, not `om-memory-system` on `PATH`

The argv is `node <plugin root>/bin/omms-launch.mjs --at-least-own-version memory <mode> <flags>`, with the session's working directory and a 60-second limit. That limit is the same as the status module's launcher limit, because a first `npx` run can be slow.

The prototype ran `om-memory-system` from `PATH`. That breaks the plugin spec for users without a global install.

### 3. A fixed list of modes, built as an argv array

The tool builds an argv array and runs no shell, so no input can inject a command. Only the documented flags of each mode are passed. `import`, `export`, `migrate` and `list-shards` are refused, because they write or read whole stores and files.

`forget` stays, as it is in the Pi and OpenCode tool. The skill says to use it only when the user asks.

Alternative: pass any mode through. Rejected, because a model call could export a store to a file path.

### 4. The tool is in the prompt from the start

`isDeferred: false`, and the description says to use the tool instead of the Bash command. In the prototype, a deferred tool was skipped in favour of the skill's Bash route.

The cost is a little more prompt per session. That is the size of the schema, about 300 tokens.

### 5. The cards parse the injected text with a pure parser shared with Bun

`hooks/omms-recall-parse.js` exports `recalledIn(text)`, `headline(body)` and `callTitle(call)`. It has no imports, so the module and Bun can both load it.

A new Bun test, `tests/claude-recall-parse-contract.test.ts`, runs it on real output from the functions that build each recall format. It checks:

- the count;
- the relevance;
- the id;
- the headline.

A format change then fails `ci:local`.

Alternative: copy the regular expressions into a Bun test. The copy would drift from the module.

### 6. Mode and query come from the event order

A `prompt.submit` hook stores the prompt text. The next main-loop `hook-context` row that holds a retrieval section becomes a `search` card with that query, and the stored prompt is then cleared. A section with no stored prompt becomes a `recent` card. That covers the session-start and restored-session cases.

The prototype tests cover the stale-prompt case.

### 7. Memory ids in the shared format

`src/services/context.ts` writes `<memory id="${mem.id}" relevance="${similarity}%">`. The restored-session entries add the id after the heading as `### Memory N (mem_…)`. Both are host-neutral, so Pi and OpenCode get the same text, which keeps host parity.

The packer already measures each entry's bytes, so the budget holds. The two Bun tests that pin the old prefix are updated to the new one. Their size assertions stay as they are.

### 8. Version floor

Task 1.1 runs the module tests and a live check on 2.1.287 if that build can be installed. If `tool.register`, `session.append` or `ui.render` for `AssistantMessage` is missing there, the minimum in the docs, `README`, and the status requirement rises to the lowest version that has them.

**Outcome (task 1.1, 2026-10-13).** The npm builds were installed in a scratch folder. The prototype's 31 tests were run on each with `claude plugin test`:

| Claude Code | Pass | Fail | What fails                                                                               |
| ----------- | ---- | ---- | ---------------------------------------------------------------------------------------- |
| 2.1.287     | 23   | 8    | Every recall-row test that appends hook context: `no implementation for session.append`. |
| 2.1.291     | 23   | 8    | The same.                                                                                |
| 2.1.293     | 26   | 5    | `session.append` is answered, but no recall row draws and no `Button` exists to press.   |
| 2.1.294     | 26   | 5    | The same.                                                                                |
| 2.1.295     | 31   | 0    | None.                                                                                    |
| 2.1.296     | 31   | 0    | None.                                                                                    |

The tool tests (`tool.register`, `tool.call`, `process.run`) pass on every version from 2.1.287. The recall rows need 2.1.295. The minimum therefore rises to **2.1.295** in `docs/claude-code-adapter.md`, `docs/upgrading.md`, `UPDATES.md`, `AGENTS.md` and the status requirement. `README.md` names no Claude Code version, so it does not change. The live check (task 7.1) runs on 2.1.296. No live session was run on 2.1.295.

## Risks / Trade-offs

- [The module API is early access and can change between Claude Code releases] → The module tests pin the shapes used. The docs name the tested version. A refused registration writes one transcript line, and the hooks keep working.
- [Two tools and duplicate cards for users who kept the prototype mod] → The upgrade note in `docs/claude-code-adapter.md` says to remove `~/.claude/mods/omms-visible` from `CLAUDE_CODE_PLUGIN_DIRS`.
- [The ids make each injected memory about 30 bytes longer] → The packer counts them. A full section holds slightly fewer memories, as the spec states.
- [Recall rows show the user's prompt and memory headlines on screen] → They are already in the session's context and are drawn only locally. Nothing new is sent or logged. The debug line holds counts and a reply id only.
- [A tool call through `npx` on first use can take more than 60 seconds] → The tool returns `memory failed:` with the reason, and the next call uses the copy that `npx` cached.

## Migration Plan

1. Ship in a normal release. Release Please bumps `.claude-plugin/plugin.json`, and the `stable` channel picks it up after npm approval.
2. Users update with `claude plugin update omms@omms` or through marketplace auto-update, then start a new session. `/reload-plugins` does not rerun `session.start`, so the tool appears only in a new session.
3. Rollback: revert the commit. The hooks do not depend on the module.

## Open Questions

- Should a later change add the capture row? It needs a way for the module to learn the `Stop` hook's outcome after the reply. That is outside this change and does not affect its tasks.
