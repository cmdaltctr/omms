# Design

## Context

Recall today, per host:

| Behaviour                   | OpenCode V2                       | Pi                                   | Claude Code                                                  |
| --------------------------- | --------------------------------- | ------------------------------------ | ------------------------------------------------------------ |
| Before the first prompt     | nothing                           | nothing                              | project's recent memories (`SessionStart` `startup`/`clear`) |
| Each prompt                 | relevant recall                   | relevant recall                      | relevant recall (`UserPromptSubmit`)                         |
| After compaction            | session's own memories            | nothing                              | session's own memories (`SessionStart` `compact`)            |
| After resume                | nothing                           | nothing                              | session's own memories (`SessionStart` `resume`)             |
| Subagent injection          | yes, per prompt (no parent check) | none (OMMS not loaded in children)   | none (no `SubagentStart` hook)                               |
| Rows honour `visibleRecall` | yes                               | yes (change `add-pi-visible-recall`) | no                                                           |
| Subagent rows               | none (parent-session rule)        | none (non-interactive child)         | none (static analysis, see D4)                               |

Code facts this design relies on:

- `retrievalSection` in `src/importer/claude-hook-api.ts:206-246` picks the text. `session-start` with source `compact` or `resume` returns `formatMemoriesForCompaction`. Any other source returns `buildRecentMemoriesSection`. `user-prompt-submit` returns `buildRetrievalSection`.
- `handleClaudeRetrieve` (`claude-hook-api.ts:254-282`) calls `refreshConfigIfChanged(request.cwd)` first, so `CONFIG` there holds the effective global-plus-project values (`src/services/visible-recall-config.ts:37-48` for `visibleRecall`). It runs in the long-lived web app process, which a new session's `SessionStart` can replace with a newer version (`hook-client.ts:355`).
- The Claude hook client knows three events (`src/adapters/claude-code/hook-client.ts:9`), with per-event time budgets (`:23-27`), and forwards `transcript_path` for every event (`:172`). The capture path already checks the path (`checkedTranscriptPath`, `claude-hook-api.ts:148`) and parses it (`parseClaudeTranscript`).
- The hook command can reach the module only through `additionalContext` (`hook-client.ts:303-313`). The module reads it at `session.append`, door `hook-context` (`hooks/omms-recall.jsx:45-46`), and drops sections that carry `agentId`.
- The module sets the mode at `hooks/omms-recall.jsx:48`: `lastPrompt ? "search" : "recent"`.
- `stripRetrievalSections` (`src/core/retrieval.ts:118-126`) removes everything between `<omms-retrieval>` and `</omms-retrieval>`. The parser's `SECTION` regex (`hooks/omms-recall-parse.js:9`) also needs the bare opening tag.
- `buildRetrievalSection(prompt, directory, sessionId, budget)` (`src/core/retrieval.ts:16-46`) runs `memoryClient.searchMemories`, which applies the result limit and relevance threshold, filters the current session when `chatMessage.excludeCurrentSession` is on, and packs with `formatContextForPrompt` inside the budget.
- OpenCode V2 (`src/v2/adapter.ts`): the `prompt` hook (`:205-231`) starts the retrieval for every session, child sessions included, and stores it in a bounded map. The `context` hook (`:233-265`) pushes the section into `event.system`, records the row with `recall.record`, then pushes the restored section from the `restored` map on every later request. The `compaction` hook (`:268-285`) fills `restored`. There is no resume hook. The recall reporter has a cached parent lookup (`src/v2/recall-reporter.ts:70-85`, `ctx.session.get` and `parentID`).
- Pi (`src/adapters/pi/extension.ts:288-320`): `before_agent_start` runs per prompt in every mode, returns the section inside `systemPrompt`, and records the row with `recallRows.record`. Rows draw only when `ctx.mode` is `tui` (`recall-rows.ts:134`). `ctx.sessionManager.getBranch()` returns the session's entries.
- Pi 1.4.0 events (`@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts`): `session_start` has `reason: "startup" | "reload" | "new" | "resume" | "fork"` (`:575-581`); `session_compact` carries the `compactionEntry` after a compaction (`:613-621`); `session_before_compact` can replace the summary (`:602`, docs `compaction.md:297`). `docs/extensions.md:127-145` shows `/resume` as `session_before_switch`, `session_shutdown`, then `session_start` in a new runtime.
- om-pi-subagents 0.10.0 starts children with `--mode rpc --no-session --no-extensions`, plus `-e` paths for mapped extensions, and sets `OMPS_CHILD=1` (`openspec/changes/add-pi-visible-recall/design.md:52`). OMMS loads in a child only when the agent maps it.
- Claude Code `SubagentStart` (hooks reference, `code.claude.com/docs/en/hooks`, through Context7): input is the common fields (`session_id`, `transcript_path` of the parent session, `cwd`, `hook_event_name`) plus `agent_id` and `agent_type`. It carries **no task prompt and no description**. It cannot block, and it can return `hookSpecificOutput.additionalContext`, which goes into the subagent's context before its first prompt. The `Agent` tool input (alias `Task`) holds `description`, `prompt` and `subagent_type`.
- `compaction.enabled` (default `true`) and `compaction.memoryLimit` (default `10`) live in the config file only (`src/config.ts:307-310`, read at `:723-726`). `settings-snapshot.ts`, `global-config-writer.ts`, `src/utils/memory-limits.ts` and `web/src/lib/settings-api.ts` have no compaction entry, so the web app cannot show or change them. Claude Code already honours `compaction.enabled` at `SessionStart` `compact`/`resume` (`claude-hook-api.ts:223`, `docs/claude-code-adapter.md:181`); OpenCode V2 checks `isCompactionEnabled()` in its `compaction` hook (`src/v2/adapter.ts:270`).
- Project rule for `compaction` today: `src/config.ts` does not remove `compaction` from the project overrides (`:835-876`), and merges with `{ ...globalConfig, ...projectOverrides }` (`:876`). So a project config can turn the restore **on or off**. The merge is shallow: a project `compaction` object replaces the global one, and a key it leaves out falls back to the built-in default (`:724-725`), not to the global value.
- `src/utils/memory-limits.ts` holds the validation, unit and default of each web-editable limit, including the nested `chatMessage.maxMemories` (`:62-69`). The settings snapshot and the writer read it (`settings-snapshot.ts:50`, `global-config-writer.ts:103-104,173`). The Memory card draws its own list from `web/src/lib/memory-controls.ts`.
- `src/config.ts` sits at its size-ceiling entry (927 lines, `tests/file-size-ceiling.test.ts:18`). `claude-hook-api.ts` has 519 lines against a ceiling entry of 552. `src/adapters/pi/extension.ts` has 436 lines and `src/v2/adapter.ts` 316 lines, against the 500-line limit.

## Goals / Non-Goals

**Goals:**

- By default, every host adds only the recall for the current prompt. Nothing is added before the first prompt.
- An opt-in opening context adds the memories that match a user-editable query to the first prompt, the same way on OpenCode V2, Pi and Claude Code.
- Subagent sessions get the memories that match their task, on by default, with one switch on every host.
- Memories restore after compaction and after resume on every host.
- All the settings can be changed in the config file and in the Memory injection section of the web Memory page.
- Claude Code rows honour `visibleRecall` per prompt, for global and project values.
- Every row label says what the section is.
- Subagent sessions draw no rows on any host.
- One table explains each remaining host difference and its reason.

**Non-Goals:**

- OpenCode V1 (`chat.message` in `src/index.ts:601`). It keeps its first-message recent list and ignores the new settings. AGENTS.md says OpenCode work is V2 only. V1 stays a known remaining difference, listed in the host-differences table.
- The om-pi-subagents change (open question 1).
- New capture paths for subagent turns.
- Removing the `recent` mode from `src/core/recall-summary.ts` or the `opencode-visible-recall` spec.

## Decisions

### D1. The opening context is optional, off by default, query-driven, and delivered with the first prompt

The user calls this option "injection at session start". It has one behaviour and one setting pair on all three hosts, and it travels with the first model request of a new session. Plainly: OpenCode V2 and Pi have no model request before the first prompt, so the injection can only go with the first prompt. Claude Code could deliver it at `SessionStart`, but it uses the first `UserPromptSubmit` instead, so the three hosts behave the same. In the web app, "session start" means "the first message of a new session", and the label says so.

Claude Code's `SessionStart` with source `startup` or `clear` adds nothing, whatever the settings say. `retrievalSection` returns `null` for `session-start` unless the source is `compact` or `resume`. The `SessionStart` hook and its `POST /api/claude/retrieve` request stay, because that request starts the backfill, and the hook starts or replaces the web app and runs the plugin self-update check. The answer is `{ "additionalContext": "" }`.

| Setting               | Type    | Default                                                      | Rule                                                                      |
| --------------------- | ------- | ------------------------------------------------------------ | ------------------------------------------------------------------------- |
| `openingContext`      | boolean | `false`                                                      | A project config can set `false`. A project `true` is ignored and logged. |
| `openingContextQuery` | text    | `project architecture, setup, conventions and key decisions` | Global only. Trimmed. 500 characters at most. Empty means no search.      |

When `openingContext` is `true` and the query is not empty, the first prompt of a main session (D1d) runs one extra search with the query. The matching memories go into that prompt's injected context as a second retrieval section, after the prompt's own section. A project with no matching memory adds nothing. The opening search runs only when the per-prompt recall runs for that prompt: injection on, prompt not empty and not fully private. Subagent sessions never get it.

Why an option and not a default: a recency list adds general context to every session, including sessions where none of it is needed. The hook should act as an intermediary that adds only what the prompt needs. Some users want a short project briefing when they start, so the option stays, off by default.

Why a query and not recency or fixed text: a query passes the same relevance filter as the per-prompt recall, so only memories that match the topic arrive, and the user chooses the topic. Fixed text would be a second instructions file, which `AGENTS.md` and `CLAUDE.md` already are.

After this change Claude Code no longer reads `chatMessage.maxMemories`, `chatMessage.maxAgeDays`, or `chatMessage.excludeCurrentSession` for an opening list. `chatMessage.enabled` still turns per-prompt retrieval on or off, and the opening search with it. `buildRecentMemoriesSection` stays in `src/core/retrieval.ts`, because OpenCode V1 still calls it. Remove its import from `claude-hook-api.ts` if it becomes unused there.

Alternatives considered: stop sending the request at `startup` (rejected: the backfill start depends on it); deliver at `SessionStart` on Claude Code only (rejected: two behaviours behind one setting); keep the Claude Code opening list as the default (rejected: the user chose default off on all three hosts).

### D1a. Which rows still read `mode=recent`, and the new labels

With D1 in place and today's rule (`lastPrompt ? "search" : "recent"`), these sections would still be labelled `recent`:

1. The restored-session section after `compact` or `resume` (`## Restored Session Memory`, `formatMemoriesForCompaction`). The parser already reads it (`omms-recall-parse.js:14-16`, relevance `null`).
2. A per-prompt section that arrives with no `prompt.submit` before it, for example the background-subagent report-back that fires `UserPromptSubmit` (cc-findings Q1 point 7, not verified live).

The label is wrong for both. Decision: the module takes the mode from the section content. A section with the `## Restored Session Memory` heading is `mode=restore`, with no query. A section with the opening marker (D1e) is `mode=opening`. Any other section is `mode=search`, with the last prompt as the query when there is one. Only a `search` section uses up `lastPrompt`. After this change, Claude Code draws no `mode=recent` row.

Why `restore`: it names what the section does, it matches the docs' own word ("restoration after compaction or resume"), and it fits the pseudo tool-call form `memory [mode=…]`. Alternatives: keep `recent` (misleading), or `list` (clashes with the real `memory` tool mode `list`).

Side effect: when compaction happens between a prompt and its reply, the restored section no longer takes the prompt as its query.

### D1b. Settings, config file and validation

- New module `src/services/injection-options-config.ts`, shaped like `visible-recall-config.ts`: the file-config type, `injectionOptionsFromFile(fileConfig)` and `applyProjectInjectionOptions(projectConfig, overrides, directory, log)`. It holds the three settings, the default query and the 500-character limit as exported constants, so the writer and the web app use the same values.
- Load rules: a non-boolean `openingContext` reads as `false`; a non-boolean `subagentMemory` reads as `true`. A non-string query reads as the default. The query is trimmed. A hand-edited query over 500 characters is cut to 500 and logged with its length, never its text.
- Project rules: a project `false` wins for `openingContext` and `subagentMemory`. A project `true` is removed and logged ("Project config cannot turn on <key>; the value was ignored"), as `skillLearning` does. A project `openingContextQuery` is removed and logged: the query is global only.
- `src/config.ts` is at its ceiling (927 lines). It gets the settings through the new module at the call sites `visibleRecall` uses (type, `...fromFile`, project apply). Offset the added lines inside `config.ts` so the file does not grow.
- `src/config-template.ts` gets a commented block next to `visibleRecall`: the three keys with defaults, "applies to OpenCode V2, Pi and Claude Code", "the opening context goes with the first message of a new session", and "a project config can only turn these off".
- `src/services/global-config-writer.ts` allowlist: `openingContext` and `subagentMemory` accept a boolean. `openingContextQuery` accepts a string whose trimmed length is 0 to 500, and `null`, which removes the key (reset to default), as the memory limits do. Rejection messages name the key and the rule, for example "openingContextQuery must be text of 500 characters or fewer". They never echo the submitted value.
- `src/services/settings-snapshot.ts`: the three keys join the global-only key list, with their values and defaults, so the web app can show and reset them.

### D1c. Shared search and budget, no new limit setting

New core module `src/core/opening-context.ts` with one function for the first prompt:

```ts
buildFirstPromptSections({ prompt, openingQuery, directory, sessionId, budget, openingReserveBytes })
  -> Promise<{ promptSection: string | null; openingSection: string | null }>
```

- `src/core/retrieval.ts` gives up its search step as a shared helper (`searchMemories`, then the `excludeCurrentSession` filter). `buildRetrievalSection` and the new function both call it, so the relevance threshold, result limit and current-session rule are the same code.
- The two searches run in parallel. Opening results whose memory id is in the prompt results are dropped.
- The prompt section is packed first with the full budget. The opening section is packed with what is left: the budget minus the wrapped prompt section and minus `openingReserveBytes` (Claude Code's marker bytes, D1e). When the prompt section fills the budget, the opening section is empty.
- Hosts read `CONFIG` and pass the query. The core module does not import `CONFIG`. A pure helper `openingQueryFor({ openingContext, openingContextQuery })` returns the trimmed query, or `null` when the option is off or the query is empty.
- Later prompts keep calling `buildRetrievalSection` as today.

Why no `openingContextMaxMemories`: the shared search already caps the number of results and drops weak matches, and the shared budget caps the total size of both sections. A separate cap adds a setting and a web control that nobody asked for.

### D1d. "First prompt of a session" and "resumed session" per host

One rule on every host. The first prompt that this process sees for a session is:

- the **first prompt of the session** when the session history holds no earlier user prompt;
- a **resumed session** when the history already holds an earlier user prompt.

Each host keeps a bounded in-memory set of seen session ids (500 entries, oldest dropped), so the history check runs once per session per process. The set survives no restart. After a restart, the history check gives the answer again, so a resumed or compacted session never gets an opening section, and it gets one resume restore (D5).

| Host        | Where                                                                | History check                                                                                                                                                       | Also marked seen                                        |
| ----------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| OpenCode V2 | `src/v2/adapter.ts`: `prompt` hook starts it, `context` hook decides | `event.messages` holds no user message before the current one; the session has no `parentID`                                                                        | `compaction` hook                                       |
| Pi          | `src/adapters/pi/extension.ts`, `before_agent_start`                 | `ctx.sessionManager.getBranch()` holds no user message entry before the current prompt; not a child (`OMPS_CHILD` unset)                                            | `session_compact`; `session_start` with reason `resume` |
| Claude Code | `handleClaudeRetrieve`, `user-prompt-submit` only                    | the checked `transcript_path` holds no user prompt before the current one; a missing transcript file counts as first; a missing or invalid path counts as not first | `session-start` with source `compact` or `resume`       |

- OpenCode V2: for a session not in the set, the `prompt` hook starts `buildFirstPromptSections` in place of the plain retrieval, through a new memory-bridge method. The `context` hook pushes the opening section only when the history check passes. The retrieval record holds both sections, so every model request of that first turn carries them, and the next `prompt` hook drops them, as it drops the per-prompt section today. `forgetSession` also removes the id from the set. V2 only: V1 `chat.message` does not change.
- Pi: the opening section is appended to `systemPrompt` after the prompt's section. Pi sets the system prompt per agent run, so the opening section reaches the model for the first run only.
- Claude Code: `parseRetrieveRequest` accepts `transcript_path` for `user-prompt-submit` and checks it with `checkedTranscriptPath`. Claude Code keeps `additionalContext` in its transcript, so the opening section stays in the model context until compaction. Nothing runs at `SessionStart` `startup` or `clear`.
- Implementation checks, each pinned by a test: whether the current prompt is already in `event.messages`, the Pi branch, and the Claude transcript when the hook runs; and the role field each host uses for user messages.

Time: on the first prompt only, two searches run in parallel and Claude Code reads one transcript file. The Claude `user-prompt-submit` request limit is 3,000 ms (`hook-client.ts:25`). If the request times out, Claude Code gets no added context for that prompt, as today.

### D1e. Row labels: `mode=opening` and `mode=restore` on every host

```text
▸ ● memory [mode=search, query="how do I run the tests", limit=2]
▸ ● memory [mode=opening, query="project architecture, setup, conventions…", limit=3]
▸ ● memory [mode=restore, limit=4]
```

Why `opening` and not `search` with the configured query: a `search` row with words the user never typed reads as if the user asked for them, and the user cannot tell which memories came from the option. `opening` names when and why the search ran, and the query shows which setting text was used. `recent` is rejected: it is a search, not a recency list.

Core change, kept small: `RecallSummary.mode` in `src/core/recall-summary.ts` gains `"opening"` and `"restore"`. `buildRecallSummary` keeps the query for `opening` and drops it for `restore` and `recent`. The relevance of a restored memory is `null`, as the Claude parser already reads it. `callTitle` and `unfoldLines` already print the mode and query as given.

Per host:

- OpenCode V2: `recall.record` takes the mode. The opening section records an `opening` summary with the query. The restored section records one `restore` summary on the first request that carries it after each compaction or resume, not on every request. `src/v2/recall-reporter.ts` passes the mode through.
- Pi: `recallRows.record` takes the mode, for the opening and restored sections.
- Claude Code: the hook command reaches the module only through `additionalContext`, so the opening section carries one marker line right after its opening tag: `<!--omms:opening query="<query>"-->`. The query is put on one line, cut to 300 characters, with `"`, `<` and `>` removed and `--` folded to `-`, so it cannot end the comment early. The marker bytes count in the budget as `openingReserveBytes`. `omms-recall-parse.js` gains `openingQuery(text)`. `omms-recall.jsx` sets `mode=opening` with that query and leaves `lastPrompt` for the `search` section.

Trade-off: on Claude Code the configured query reaches the model inside the marker, once per session and only when the user turned the option on. It is the user's own setting text, not memory text. On OpenCode V2 and Pi the rows are recorded on the host side, so no marker reaches the model.

`visibleRecall` gates every row. On Claude Code, when rows are off, the opening section carries the rows-off marker (D2) and no opening marker.

### D2. Claude Code honours `visibleRecall` with a marker in the injected text

When `CONFIG.visibleRecall === false`, `handleClaudeRetrieve` puts one marker line first inside each section:

```text
<omms-retrieval>
<!--omms:rows-off-->
…section…
</omms-retrieval>
```

- Marker: `<!--omms:rows-off-->` plus a newline, 21 bytes. An HTML comment, so the model reads it as inert markup. It carries no memory text.
- Placement: right after the opening tag. `truncateContext` (`hook-client.ts:127-135`) cuts from the end, so the cut never removes the marker. The tag itself stays bare, so `stripRetrievalSections` still removes the whole section before capture and the parser still finds it.
- Budget: when rows are off, the marker's bytes are added to `wrapperBytes` in the budget, so each packed section plus marker stays within `retrievalMaxTokens`.
- Where: in `claude-hook-api.ts` only, by prefixing the section before `wrapRetrievalSection`. The shared `wrapRetrievalSection` in `src/core/retrieval.ts` does not change, so OpenCode and Pi output does not change.
- Module: `omms-recall-parse.js` gains `rowsOff(text)`. `omms-recall.jsx:46` becomes `e.agentId || rowsOff(text) ? [] : recalledIn(text)`. Gating at L46 keeps the section from becoming pending, so a later "on" state cannot draw it (cc-findings, "Where the module decides").
- Covers every injected section: prompt recall, opening section, restore, and subagent sections (D4, always marked). Global and project values apply from the next request, with no restart.

Trade-off, stated plainly: while rows are off, the injected text carries this one short marker line per section. With the defaults, a main-session prompt's injected text is byte-for-byte the same as today. The OpenCode spec forbids rows from changing model context (`opencode-visible-recall`, "Visible recall does not change model context or the transcript"). Claude Code accepts this small exception because `additionalContext` is the only channel from the hook command to the module.

Option 2 (rejected): the status command returns `visibleRecall`, the status module stores it in an atom, and `omms-recall.jsx` checks the atom. The status command reads only the global config and refreshes at session start and every 6 hours, so a project `false` needs extra plumbing and any edit can take up to 6 hours to apply.

Also rejected: an attribute on the tag (`<omms-retrieval rows="off">`). The tag regexes in `stripRetrievalSections` and the parser need the bare tag. Option C (the module reads the config files itself) copies the config rules into a second runtime, where they can drift without warning.

Version skew: the module comes from the installed plugin, and the hook command can come from a newer local copy. An older module ignores both markers: it draws rows for every main-session section and labels the opening section `search` or `recent`. An older web app sends no marker and no opening section, and an older plugin registers no `SubagentStart` hook. No case is worse than today.

### D3. Host differences that stay, and why

These are documented and not changed. The single home is a new "Host differences" section in `docs/using-memory.md`, the host-neutral user guide. The three adapter guides and `README.md` link to it.

| Capability                         | OpenCode V2                             | Pi                                               | Claude Code                                      | Why                                                                                                                                                         |
| ---------------------------------- | --------------------------------------- | ------------------------------------------------ | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fold or unfold rows                | click the row, or `/omms-recall`        | `/omms-recall`                                   | press the row                                    | Claude Code draws each row inside its reply, and the module handles the press there. OMMS has no in-session command surface on Claude Code.                 |
| In-session history import          | `/memory-import-opencode-history`       | `/memory-import-pi-history`                      | none: automatic backfill or the terminal command | The import uses the session model. Claude Code hooks cannot call it, and there is no in-session command surface.                                            |
| Fold state after a restart         | kept (TUI storage)                      | lost                                             | lost                                             | OpenCode offers a TUI store. Pi has no safe extension store (TDR-062). Claude Code holds the fold atom for the session only.                                |
| Injection at session start         | first message, when on                  | first message, when on                           | first message, when on                           | Same on all three (ADR-040). OpenCode V2 and Pi have no earlier channel. OpenCode V1 still adds a recent list to the first message and ignores the setting. |
| How long an injected section stays | that prompt's model requests            | that prompt's agent run                          | in the transcript until compaction               | Each host offers a different channel: V2 system context per request, Pi system prompt per run, Claude Code `additionalContext` in the transcript.           |
| Subagent memory                    | child sessions, per prompt              | only when om-pi-subagents loads OMMS in children | once, when the subagent starts                   | V2 runs the prompt hook in child sessions. Pi children start with `--no-extensions`. Claude Code has only `SubagentStart`, which carries no task prompt.    |
| Subagent rows                      | none                                    | none                                             | none                                             | Rows are for the user's main conversation.                                                                                                                  |
| Capture and profile model          | host model, external API, session model | host model, external API, session model          | external API only                                | Claude Code hooks cannot call the session model.                                                                                                            |

ADR-040 records D1, D4 and D3.

### D4. Subagent memory: on by default, no rows, capture unchanged

New global setting `subagentMemory` (boolean, default `true`). When it is on, a subagent session gets the retrieval section for its task prompt, built by `buildRetrievalSection` with the same relevance filter, result limit and budget as a main-session prompt. A project config can turn it off, never on (D1b). Subagent sessions never get the opening context, and never draw rows, whatever `visibleRecall` says. This change adds no capture path for subagent turns.

Cost of default on: every subagent session gets up to one retrieval budget of extra context (`retrievalMaxTokens`), and one search per subagent prompt. A project with no matching memory adds nothing. The docs and the release note say so.

Per host:

- **OpenCode V2.** Evidence: the `prompt` hook (`src/v2/adapter.ts:205-231`) has no parent check, so child sessions get the per-prompt recall today. Change: move the cached parent lookup from `recall-reporter.ts:70-85` into a new `src/v2/session-parent.ts` that both the reporter and the adapter use. In the `prompt` hook, when `subagentMemory` is `false` and the session has a `parentID`, start no retrieval. A failed lookup counts as a root session, as the reporter does today. Rows: the reporter already records nothing for a session with a parent. Capture: the existing V2 capture rules apply unchanged.
- **Claude Code.** Evidence: `SubagentStart` input carries `agent_id`, `agent_type`, `session_id`, the parent `transcript_path` and `cwd`, but no task prompt (Context). It can return `additionalContext`. Change: register `SubagentStart` in `hooks/hooks.json` (timeout 10), add `subagent-start` to `CLAUDE_HOOK_EVENTS` and `BUDGETS` in `hook-client.ts` (`startMs: 5_000`, `requestMs: 3_000`), and add a `subagent-start` request to `handleClaudeRetrieve`. Query: read the checked parent transcript and take the `prompt` of the oldest `Agent` or `Task` tool call whose `subagent_type` matches `agent_type` (`general-purpose` when absent), that has no tool result yet and that has not fed a subagent already (the web app keeps a bounded set of used call ids per parent session, so parallel subagents of one type each get their own call, and a background call is used once). Review finding F1, 2026-11-03. With no match, add nothing: `agent_type` alone ("Explore") is too weak a query to match memories. Every subagent section carries the rows-off marker (D2), and the module also drops it by `agentId`, so no row draws. Capture: the plugin registers no `SubagentStop`, and `Stop` capture reads only the main transcript, so subagent turns are not captured on their own, as today.
- **Pi.** Evidence: om-pi-subagents starts children with `--mode rpc --no-session --no-extensions` and loads OMMS only when an agent maps it with `-e` (Context). So OMMS is not loaded in children today, and no OMMS-side change can inject there. This is a **cross-repository dependency**: the injection needs om-pi-subagents to load the OMMS extension in children. OMMS side, ready first: a child is a session with `OMPS_CHILD=1`. In a child, `before_agent_start` injects the prompt's recall only when `subagentMemory` is on, adds no opening section and no restore, and records no rows (`ctx.mode` is `rpc`, `recall-rows.ts:134`). Capture follows the existing Pi capture rules. A task pins what they do in a `--no-session` child today; this change does not alter them.

Claude Code query alternatives: (a) `agent_type` only, rejected as above; (b) a `PreToolUse` hook with matcher `Agent|Task` that stores `tool_input.prompt` in the web app for the next `SubagentStart`, kept as the fallback if the parent transcript does not hold the tool call when `SubagentStart` fires; (c) `PreToolUse` `updatedInput` that appends memories to the task prompt, rejected because it rewrites Claude's tool input and the memories would then be captured as task text. Live check 9.5 found that a background agent (`run_in_background`, common in the interactive terminal) gets an "Async agent launched" receipt as its tool result, so the matcher does not count that receipt as an answer. Task 4.0 checks (a fact the docs do not state) that the parent transcript holds the tool call at `SubagentStart` time, before the implementation picks the primary path.

Rows evidence (cc-findings Q1): `omms-recall.jsx:46` drops any section that carries `agentId`, pinned by `hooks/omms-recall.test.ts:157-164`. A live check (task 9.5) runs only with the user's approval. Its proof outputs: (a) the scratch OMMS log holds one `Claude Code hook` record with `event: user-prompt-submit` and one with `event: subagent-start` for the prompt; (b) with `subagentMemory` on and a matching memory, `grep -c omms-retrieval <session dir>/subagents/agent-*.jsonl` prints 1 or more, and with it off prints 0; (c) the debug log holds `omms: reply <id> claimed N recalls` with N > 0 once, for the main reply; (d) the subagent transcript view shows no `● memory` row.

Proposed issue (not a task, score below 5): **"Claude Code recall row can be claimed by a subagent transcript block."** Likelihood 2, impact 2, product 4. Trigger: the main reply opens with an Agent tool call and no text block, and the user opens the subagent transcript before the first main text block draws. `pending` is claimed by the first `isFirstOfReply` block drawn (`omms-recall.jsx:58-61`), and `AssistantMessage` props carry no `agentId`, so the row can show in the subagent view and not on the main reply. Cosmetic only. Do not create the issue until the user says yes.

### D5. Restore after compaction and resume on every host

One setting controls the restore after compaction and after resume on all three hosts: the existing `compaction.enabled` (default `true`, unchanged). `compaction.memoryLimit` (default `10`, unchanged) caps the count, and the shared `formatMemoriesForCompaction` formats it within the retrieval budget. When `compaction.enabled` is `false`, no host restores after compaction or resume, Claude Code included at `SessionStart` `compact` and `resume` (it already checks the value, `claude-hook-api.ts:223`). Only memories from the same session and the same host are restored, as Claude Code does today. The restored section draws a `mode=restore` row that honours `visibleRecall`.

Why reuse and not a new key: the existing key already means "restore after compaction" on every host that restores, its default already matches the wanted behaviour, and a second key would let two switches disagree. The name says "compaction" while it also covers resume; the config template, the docs and the web label say "after compaction or resume" to make that plain.

Project rule, kept as it is today (no silent change): a project config can set `compaction.enabled` to `true` or `false`, because `src/config.ts` does not strip `compaction` from project overrides. This differs from the off-only rule of `visibleRecall`, `openingContext` and `subagentMemory`. The note in the Memory injection section says so. Changing it would be a separate decision.

Proposed issue (not a task, score below 5): **"A project `compaction` object resets `compaction.memoryLimit` to the built-in default."** Likelihood 2 (a project must set only `compaction.enabled`), impact 2 (the restore count uses 10, not the global value; no data loss), product 4. Trigger: the global file sets `memoryLimit: 20` and a project sets `"compaction": { "enabled": true }`; the shallow merge at `src/config.ts:876` drops the global limit. Do not create the issue until the user says yes.

| Host        | After compaction                                                   | After resume                                                                                                                        | Can it detect resume?                                                                                                  |
| ----------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Claude Code | `SessionStart` source `compact` (keep, pin with a test)            | `SessionStart` source `resume` (keep, pin with a test)                                                                              | Yes: Claude Code sends source `resume`.                                                                                |
| OpenCode V2 | `compaction` hook fills `restored` (keep)                          | new: the D1d history check finds a resumed session on its first prompt and fills `restored` the same way                            | No resume hook or event in the V2 adapter. The history check is the signal; it also fires after a restart.             |
| Pi          | new: `session_compact` loads the memories into a per-session store | new: `session_start` with reason `resume` (`types.d.ts:578`), and the D1d history check for a start that continues an older session | Yes for `/resume` (reason `resume`). Whether `pi -c` reports `startup` is not documented; the history check covers it. |

- OpenCode V2 and Pi keep the full history on resume. The resume restore adds the session's own memories once more as a short reminder, for parity. The cost is one restored section per resume.
- Pi delivery: the next `before_agent_start` appends the restored section after the prompt's section, within what the prompt's section left of the budget, as V2 does in its `context` hook. Pi keeps it for every later run until the next compaction replaces it or the session ends, as V2 keeps `restored`. The store is bounded and cleared on `session_shutdown`.
- Pi uses `session_compact`, not `session_before_compact`: OMMS does not replace Pi's native compaction summary (`docs/pi-adapter.md`, "Compaction").
- Pi children (`OMPS_CHILD=1`, `--no-session`) get no restore.

### D6. Web Memory page: the Memory injection section

- Location (user decision N11): the Memory page, route `/memory`, not the Settings page. `MemoryOverview.tsx` draws the four host cards (Pi, OpenCode, Claude Code, Shared) and then the "Import all hosts" row (`web/src/lib/components/memory/MemoryOverview.tsx:45-62`). The new section goes below that row, as the last block of the overview, with the heading "Memory injection" and the anchor `id="memory-injection"`. The `web-memory-hosts` capability owns this page (archived change `2026-10-18-memory-host-cards`), so its spec gets the delta.
- New component `web/src/lib/components/memory/MemoryInjectionSection.tsx`. It follows the patterns of the Shared view sections (`MemorySection.tsx`, `RerankerSection.tsx`) and the `omms-design` skill.
- Shared view: `/memory/shared` ("Settings for every host", `SharedView.tsx`) gets one row "Memory injection" whose summary shows the three switch states and which links to `/memory#memory-injection`. It does not repeat the controls. Recommendation, and the default: one editing surface on the overview, and a link from the Shared view, so the two can never show different unsaved values. The Settings page does not change.
- Contents: a switch labelled "Inject memories at session start", with the help text "Added to the first message of a new session. OMMS searches with the query below and adds only matching memories."; a text area for `openingContextQuery` with a 500-character limit and a counter; a "Subagent memory" switch, with the help text "Subagents get memories that match their task. No rows are shown for them."; a "Restore memories after compaction or resume" switch for `compaction.enabled`, with a number field for `compaction.memoryLimit` ("Most memories to restore"); Save; Reset to default (opening off, query removed, subagent memory on, restore on, limit 10); a host note "Applies to OpenCode V2, Pi and Claude Code. OpenCode V1 is not covered. On Pi, subagent memory needs om-pi-subagents to load OMMS."; and a project note "A project config can turn the session-start and subagent options off. It can turn the restore on or off."
- Restore limit, memory-limits pattern: `compaction.memoryLimit` becomes a rule in `src/utils/memory-limits.ts` (path `["compaction", "memoryLimit"]`, default 10, unit "memories", positive safe integers), like `chatMessage.maxMemories`. The settings snapshot and the writer then validate, show and reset it (`null` removes the key) with no new code paths. The Memory limits section in the Shared view keeps its list in `web/src/lib/memory-controls.ts` and does not show it; only the Memory injection section does. Update the "six settings" doc comment and any test that counts the rules.
- Restore switch: `compaction.enabled` joins the writer allowlist as a boolean and the settings snapshot with its value and default. The writer writes it at the JSONC path `["compaction", "enabled"]`, as it writes nested memory limits, so the rest of the `compaction` object stays.
- Save goes through the existing settings API and `global-config-writer.ts` (D1b). A rejected value shows the writer's message, which names the key and the rule and does not repeat the submitted value.
- Strings in `web/src/lib/i18n/settings.ts` (the file that holds the Memory page strings, such as "Import all hosts") with English, Chinese and Arabic.

## Risks / Trade-offs

- [Claude Code users lose the opening list by default] → The same memories arrive when a prompt matches them. "Inject memories at session start" brings a query-driven version back. The docs and the release note say so.
- [Every subagent gets extra context by default] → Same relevance filter and budget as a prompt. One switch turns it off. Stated in the docs and the release note.
- [Claude `SubagentStart` has no task prompt] → The parent-transcript read is not documented behaviour. Task 4.0 checks it first; the `PreToolUse` stash is the fallback.
- [Off-state marker reaches the model] → 21 bytes per section, only while rows are off or in a subagent section, no memory text, counted in the budget.
- [Opening marker reaches the model on Claude Code] → Up to about 330 bytes, once per session, only when the option is on. It holds the user's own query. Counted in the budget.
- [First prompt and subagent start are slower] → Two parallel searches on the first prompt when the option is on; one search per subagent start on Claude Code, within the 3,000 ms request limit.
- [History checks read host data] → One read per session. A wrong history shape fails safe: no opening section and no resume restore. Tests pin the shapes.
- [`hooks/omms-recall.test.ts` is not part of `ci:local`] → Task 9.2 runs `scripts/test-claude-mod.sh`, which needs `claude` 2.1.295 or later.
- [Docs drift for `chatMessage.*`] → Task 8.2 greps `docs/` and `README.md` for "Claude Code" next to those settings.
- [Background-subagent report-back draws a `mode=search` row with the notification text as the query] → Not verified. Look for it during the live check (task 9.5). No code for it in this change.
- [Change ordering with `add-pi-visible-recall`] → That active change says the Pi adapter records `search` summaries only and no opening recall. Archive it before this change; this change's `opening-context` and `pi-agent-adapter` deltas then extend it.
- [Change size] → About 47 files. See "Delivery order".

## Delivery order

Apply this change in a new session in this worktree (`omms-feat-host-parity`, branch `feat/recall-host-parity`). The branch already holds the Pi rows work and its ADR and TDR, so everything goes out as one pull request. First archive `add-pi-visible-recall` (task 0.1), then implement in the order below.

One pull request is still workable if the commits follow the task groups, so each commit builds and passes its own tests:

1. Core and config: settings module, writer, snapshot, template, recall-summary modes, shared search and `opening-context.ts` (task groups 1 and 2).
2. Claude Code: no opening list, labels, `visibleRecall` marker, opening section, `SubagentStart`, restore pins (group 3 and 4).
3. OpenCode V2: opening section, subagent gate, resume restore, rows (group 5).
4. Pi: opening section, child gate, compaction and resume restore, rows (group 6).
5. Web Memory page section (group 7).
6. Docs, ADR and host-differences table (group 8).
7. Gate and live checks (group 9).

If review finds the pull request too large, the natural cut is after step 2 (Claude Code parity on its own) and after step 4, in the same branch.

## Migration Plan

No data migration. The new settings are absent from existing config files, so the opening context starts off and subagent memory starts on. `compaction.enabled` and `compaction.memoryLimit` keep their current values and defaults; the web section only makes them editable. Rollback is a revert: the old module and the old server each work alone (see version skew in D2), and an old version ignores the new keys.

## Follow-ups

- om-pi-subagents: load the OMMS extension in child sessions so `subagentMemory` reaches Pi subagents (open question 1). This is the future `recall-for-subagents` work for Pi.
- Remove the unused `recent` mode once OpenCode V1 support ends.

## Decisions from the user (2026-11-03)

- **Restore label:** `mode=restore` for restored-session rows. Taken as accepted after the plain-English explanation (a label only; it does not change what is injected).
- **Release type:** `feat:` (minor), with a clear changelog note that Claude Code no longer adds recent memories at session start.
- **Live checks:** approved (tasks 4.0 and 9.5), to run when implementation reaches them, with a scratch `HOME`, their own port and store, and `--model haiku`. If Claude Code login fails under a scratch `HOME`, stop and ask for a second approval before touching the real config.
- **Session start wording:** one `openingContext` option on all three hosts, delivered with the first message of a new session.
- **Subagent memory:** `subagentMemory`, on by default. The om-pi-subagents side is a separate change in that repository.
- **Restore after compaction and resume:** on all three hosts, controlled by one setting, `compaction.enabled` (with `compaction.memoryLimit`), editable in the web Memory injection section and in the config file (D5, D6). The current project rule (a project can turn it on or off) stays.
- **OpenCode:** V2 only (AGENTS.md rule added in this branch).
- **Opening label:** `mode=opening` accepted (D1e).
- **Default query:** `project architecture, setup, conventions and key decisions` accepted, because it stays editable in the web app (D6).
- **Claude Code subagent query fallback:** if spike 4.0 shows the parent transcript does not hold the `Agent` tool call at `SubagentStart` time, use the `PreToolUse` stash (matcher `Agent|Task`) (D4). Accepted.
- **Location of the settings:** the Memory page (`/memory`), in a "Memory injection" section below the host cards and the "Import all hosts" row, not the Settings page (D6).
- **Apply:** in a new session in this worktree, as one pull request; archive `add-pi-visible-recall` first (Delivery order).

## Open Questions

1. om-pi-subagents: recommendation is a separate change in that repository, after this OMMS release ships the child gate (see D4). Kept as a recommendation.
2. The active change `add-pi-visible-recall` says Pi records `search` rows only. It must be archived before this change is applied (task 0.1).
