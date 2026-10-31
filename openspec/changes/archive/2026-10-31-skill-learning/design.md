# Design: Skill learning

## Context

See `proposal.md` for the reasons. Observed facts that shape the design:

- Each host builds a host-neutral `CaptureConversation` at turn end: `textResponses` (full text) and `toolCalls` (`name`, bounded `input`). OpenCode builds it in `src/adapters/opencode/conversation.ts` (live) and `src/importer/opencode-reader.ts` (import). Pi uses `src/importer/pi-conversation.ts` and Claude Code uses `src/importer/claude-conversation.ts` for both. No reader keeps tool results today.
- Each host's tool results carry an outcome. OpenCode tool parts have `state.status` (`completed` or `error`) and `state.error`. Claude Code `tool_result` blocks have `is_error` and `tool_use_id`. Pi writes tool results as separate entries with `toolCallId` and `isError`.
- Memory capture runs through `captureConversation` from four call sites: `src/services/auto-capture.ts` (OpenCode), `src/adapters/pi/capture.ts` (Pi), `src/importer/claude-hook-api.ts` (Claude Code, inside the web app) and the import loop in `importHistorySource` (`src/importer/importer.ts`).
- Imports already pick their outputs with `skipMemories` and `skipProfile`, parsed once in `import-args.ts`. With `skipMemories`, the host imports (`importPiHistory`, `importClaudeHistory`, `opencode-import.ts`) skip `importHistorySource` and only feed the profile. Automatic backfill passes both as `false`. The Memory page form maps its checkboxes in `web/src/lib/components/memory/import-draft.ts`.
- The memory import ledger (`import-ledger.db`) skips a turn once it is `imported` or `skipped`, unless `--force` is passed.
- Profile learning's failure wait (`profileBackoff` in `src/core/profile-backoff.ts`) is one process-wide object. The catch-up lease (`CatchUpLease`) is a table in `user-prompts.db`.
- `chats.db` (ADR-032) is the pattern for a separate libSQL store in the storage path with its own `*_meta` schema version.
- The memory chat uses only the external API model (ADR-033). Hooks cannot call the session model on Claude Code.
- `redactTraceText` in `src/services/capture-diagnostics.ts` and `stripPrivateContent`/`isFullyPrivate` in `src/services/privacy.ts` already implement the redaction rules.
- The `memory` tool runs in-process on Pi and OpenCode. On Claude Code, `hooks/omms-memory-tool.jsx` runs `om-memory-system memory <mode>`.
- Size limits: `AppSidebar.tsx` is at 555 of its 571-line ceiling and `src/config.ts` is at 924 of 927. Neither can take much new code.

## Goals / Non-Goals

**Goals:**

- Turn recording costs no model call and never changes memory capture.
- One shared turn path for live capture and history import. Skill turns are one more output of it. Adapters and importers only hand over a finished turn and the outputs that are on.
- No unattended write can destroy a user's manual edit.

**Non-Goals:**

- Feeding tool calls or skill use into project memories or the profile.
- Moving profile prompt recording onto the turn path. It runs when the prompt is sent on live hosts and in its own import pass. Both stay as they are.
- Editing supporting files in a skill folder (`references/`, `scripts/`).
- Scoring proposals with an evaluation set (GEPA-style).
- Sync of `skills.db` between computers.

## Decisions

### 1. A new store, `skills.db`, beside `chats.db`

Tables:

| Table                | Holds                                                                                                                                                                   |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `skill_meta`         | `schema_version`                                                                                                                                                        |
| `turns`              | `turn_key` (unique), host, session id, project tag and name, provider, model, time, prompt, replies (JSON), `redacted` flag                                             |
| `tool_calls`         | `turn_id` (cascade), order, name, input, outcome, error                                                                                                                 |
| `skill_uses`         | `turn_id` (cascade), skill name, skill path or null, method (`tool`, `read`, `command`), `position`                                                                     |
| `skill_settings`     | skill path, mode, last review time, use count at last review                                                                                                            |
| `skill_proposals`    | id, kind (`improve`, `new`), skill name, path, base hash, proposed content, diff, summary, evidence turn ids, state, applied by, drafted by (`model` or `agent`), times |
| `skill_versions`     | proposal id, path, previous content or null, written content hash, saved time                                                                                           |
| `skill_review_lease` | the automatic review lease (§6)                                                                                                                                         |

It opens through `TursoConnectionManager` like the other stores. `turn_key` is `<host>:<session id>:<user message id>`, and an `INSERT OR IGNORE` makes a repeated turn a no-op. **Delete recorded turns** runs `VACUUM` after the delete, so the text leaves the file. The libSQL client opens a fresh handle after each transaction, so the store applies its pragmas (`busy_timeout`) again before such a step. Older dev files get `skill_uses.position` and `skill_proposals.drafted_by` through a guarded `ALTER TABLE`.

`skills.db` always uses the global `storagePath`. A project `storagePath` moves memories only: `initConfig` keeps the global path in `CONFIG.skillStoragePath`, `skill-folders.ts` `skillStoragePath()` reads it for every caller, and the connection manager allows both roots.

- Alternative: new tables in `user-prompts.db`. Rejected. ADR-012 limits what that file holds, and the user asked for no mixing with memory or profile data.
- Alternative: one JSONL file for each day. Rejected. Ranking needs indexed counts, and undo needs transactions.

### 2. Full turns stored by choice, with redaction as a switch

The user decided that full replies are worth keeping because the data stays on their computer. Redaction stays on by default and can be turned off in the settings card. The callouts in `web-skills` state what is stored and what drafting sends out. ADR-036 records this as the second exception to the Security rule, after ADR-012. `AGENTS.md` gets a matching bullet.

Tool output bodies are not stored. A `Read` of a large file would multiply the store size, and the outcome and error text carry the learning signal.

- Alternative: structured events only. Rejected by the user. It loses the replies that show how the agent worked.

### 3. One turn path with outputs

`handleFinishedTurn(unit, outputs, deps)` in `src/core/turn-outputs.ts` takes a `CaptureWorkUnit` and the outputs that are on, `{ memories, skills }`:

1. When `skills` is on, it calls the skill-turn output, `recordSkillTurn(unit, settings)` in `src/services/skill-learning/turn-output.ts`. This applies redaction, detects skill use and writes one transaction. The `try`/`catch` around it is in `turn-outputs.ts`, so a failure only logs `skill-record-failed`.
2. When `memories` is on, it calls `captureConversation` and returns its result unchanged.

All four call sites (three live, one import loop) call `handleFinishedTurn` in place of `captureConversation`. The memory path keeps its errors, retries and results. `deps` passes the skill-turn output in, so `src/core/` imports nothing from `skill-learning`. The settings come from `settings-for.ts`, the one place that reads `CONFIG` for a turn; `turn-output.ts` takes them as an argument, so test stubs of `src/config.ts` keep working.

- Claude Code records from a raw copy of the window, taken before memory capture trims it.
- OpenCode keys a live skill turn by the user message id.
- The capture retry drain still calls `captureConversation` directly: a retry is for memories only, and the turn was recorded on the first attempt.
- The import loop calls the path for skills first, then for memories.

Live sites set `skills` from `skillLearning` and the project override. They set `memories` as they do today. Where a live handler returns before capture because capture is off, it calls the path with `memories: false` (task 3.4). A capture retry calls the path again, and the unique `turn_key` drops the copy.

- Alternative: a separate recorder called beside each capture site. Rejected. It runs parallel to the import pipeline, so history import, backfill, progress and dedupe would each need a second copy.
- Alternative: call the recorder inside `captureConversation`. Rejected. Imports with `--skip-memories` never reach it, and recording would depend on memory capture.

### 4. Tool outcomes as optional work-unit fields

`CaptureToolCall` gains `outcome?: "ok" | "error" | "unknown"`, `error?: string` (at most 2,000 characters) and `path?: string`, the full path of a read. Memory capture ignores `path`, and `input` is still cut at 100 characters, so detection reads `path` for a long `SKILL.md` path. The live and import readers match results to calls by id. Memory capture formats tool calls as before. Task 2.6 locks the capture prompt text with a test, so memory output stays the same. The capture retry queue stores the new fields without any change.

### 5. Skill use detection

| Method    | Rule                                                                                                                                                                                              |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tool`    | Claude Code `Skill` with input `skill`; OpenCode `skill` with input `name`. A `plugin:skill` name uses the part after the colon when it names a watched skill, and keeps its full name otherwise. |
| `read`    | Any read-type tool call whose path input ends in `/SKILL.md` and resolves inside a watched folder                                                                                                 |
| `command` | The prompt starts with `/name`, `/skill:name` (Pi) or holds Claude Code's `<command-name>/name</command-name>`, and `name` is a known skill                                                       |

Detection runs at record time against the current skill index. The index lists `SKILL.md` files in watched folders, is cached for 60 seconds, and rebuilds when `skillFolders` changes.

Linked folders are watched once. `watchedSkillFolders()` in `skill-folders.ts` drops a folder whose real path matches an earlier one and keeps the first spelling, so `~/.claude/skills` linked to `~/.agents/skills` is not a second folder. The index also drops a `SKILL.md` whose real path it already holds, and a read through the linked spelling matches the indexed file by real path.

Ranking attributes failures. Each `skill_uses` row has a nullable `position`: the index of the tool call that loaded the skill (`tool`, `read`), or -1 for a slash command. A NULL position counts as -1, so older rows count every failure. A failed tool call counts against a skill only when its order is above the earliest use position of that skill in the turn.

The attention score is (F + 1) / (U + 2), with F the attributed failed turns and U the turns that used the skill. It is a smoothed failure rate: few uses keep it near 0.5. **Suggested** needs a watched folder, U of 5 or more, attention of at least `SUGGEST_MIN_ATTENTION` (0.3) and a failed turn since the later of the last proposal and last review. The default order stays uses then name. The optional `attention` order sorts by attention, then uses, then name. An older dev `skills.db` gets the `position` column through a guarded `ALTER TABLE`; `SKILL_SCHEMA_VERSION` stays 1.

### 6. Drafting and automatic review run where the external API runs

Drafting, ideas and automatic review use the external API model through the same client the chat uses. This follows ADR-033, because Claude Code has no session model. The web app runs the automatic review every 10 minutes while it is up. `web-jobs.ts` passes a getter for `CONFIG`, and each tick reads it first, because a config reload replaces the object. When the web app is down, automatic skills wait. The terminal command and the in-process tool call the same service, so a draft from Pi does not need the web app.

Each draft step is one function-tool call (`propose_skill_update`, `suggest_skills`, `write_skill`), and a Zod schema checks the arguments. The model names evidence by turn labels (`T12`); only labels of turns that were sent are kept. An invalid reply saves nothing and reports `invalid-reply`. Turn text sent to the model is cut to 4,000 characters for each turn and 60,000 in total. The newest turns go first.

Drafting reuses profile learning's protections, with its own keys:

- `profile-backoff.ts` gains `createBackoff(waitMs)`. `profileBackoff` becomes one instance and keeps its behaviour, and `skillDraftBackoff` is a second instance. A failure in one never pauses the other.
- The automatic review takes a lease of its own in `skills.db`, with the same expiry and takeover rules as `CatchUpLease`. The shared lease logic moves into one helper that takes a table name, so both leases use the same code.
- Failure reason codes come from the same mapper the profile uses (`profile-failure.ts`).

### 7. Apply is a guarded, atomic write

1. Resolve real paths, then check that the folder holds the file and the name is `SKILL.md`.
2. Hash the file on disk and compare it with `base_hash`. On a mismatch, set the state to `stale`.
3. Save the previous content (or null) in `skill_versions`.
4. Write `<file>.omms-tmp` and rename it over the file. A new skill is placed with a hard link, so it never overwrites a file that appeared since the draft.
5. Record the written content hash and set the state to `applied`. The applied-by value is `person`, `agent` or `automatic`.

Undo first checks the written hash, then restores the file or deletes it. For a new skill, undo also removes the folder when it is empty. No `.bak` files are left in skill folders.

### 8. Agent tool and terminal command share one operations module

`src/core/skill-operations.ts` holds the mode handlers and the text replies, the way `memory-tool-text.ts` serves the `memory` tool. Pi and OpenCode register a `skills` tool next to `memory`. Claude Code gets `hooks/omms-skills-tool.jsx`, which runs `om-memory-system skills <mode>`, tested by `hooks/*.test.ts` through `scripts/test-claude-mod.sh`. It passes the hidden `--applied-by agent` on apply, so its applies record `agent` as the in-process tools do.

The agent can also fix a skill with no external API call (`src/core/skill-agent-modes.ts`, `services/skill-learning/agent-proposals.ts`):

- `evidence` (skill, limit 1 to 20, default 10) returns the current `SKILL.md`, the 30-day numbers and the newest turns that used it, failed ones first, as stored, within the drafting budget (4,000 characters per turn, 60,000 in total).
- `propose` (skill, or idea with folder; content, summary, evidence) saves a pending proposal with `drafted_by = agent`. The server reads the file and computes the base hash and the diff. The same content gives `no-change` and counts as a review. Content over 100 KB is refused. A new skill gets the name and front matter checks of `draftNewSkill`.
- `undo` (id) runs `undoProposal`, the same path as the web route.
- Apply still waits for the user's request. The turn text enters the agent's own session. The CLI reads `propose` content from `--content-file` (`-` is standard input, which the Claude Code tool uses).

### 9. Web UI

- `routes.ts` gains view `skills` at `/skills`.
- The sidebar's main nav list moves into its own module first, so `AppSidebar.tsx` stays under its ceiling. The Skills entry then goes there.
- `web/src/lib/components/skills/` holds the page, the skill view, the proposal diff, the folder list and `Callout.tsx`. The diff is a line diff computed on the server and rendered as text, so no new dependency is needed.
- The Skills page lists **Pending proposals**, then **Recent proposals**: the 20 most recently changed proposals that are not pending, folded, with their state and **Undo** where it applies. A rejected or undone new skill has no watched path, so this is where it stays visible.
- `SETTINGS_SECTIONS` gains `settings-section-skill-learning`. The text goes into `web/src/lib/i18n/skills.ts` for every supported language.
- The web app starts the review loop from `src/services/web-jobs.ts`. `SkillRouteContext.startRecordPast` starts **Record past turns** through `web-import-api.ts`. The category-cleanup routes moved to `profile-cleanup-routes.ts` to keep `web-server.ts` under its ceiling.
- Load the `omms-design` skill before UI work.

### 10. Config

`skillLearning` (boolean, default `false`), `skillLearningRedact` (boolean, default `true`, global only) and `skillFolders` (string array, unset by default). The normalisation lives in `src/services/skill-learning/skill-config.ts`, which keeps `config.ts` small. The project-override rule copies `captureTrace`: a project can turn it off, never on.

### 11. Skill turns as an import target

- `import-args.ts` gains `skipSkills` and `--skip-skills`, so the terminal, in-session commands and the web form share one option set. The import's skills output is on when `skillLearning` is on and `skipSkills` is false.
- The host imports call `importHistorySource` when memories or skills are on. A run with `skipMemories` still skips the memory path.
- In the `importHistorySource` loop, the skills output runs first for every candidate, before the ledger check, the live-captured check and the dry-run branch. Then the existing memory logic runs only when memories are on, and it is unchanged. This is how already-handled and live-captured turns still reach `skills.db`. The memory ledger is not touched for a skills-only unit.
- Dry run: the skills output checks `turn_key` in `skills.db` read-only and counts `wouldRecord` and `alreadyRecorded` in the report.
- The live `turn_key` and the import `turn_key` both use the reader's user entry id. Task 4.2 proves this per host with a test that records the same fixture turn live, then imports it.
- Progress: a skills-only run uses the existing run record and progress callbacks, with the phase `skill-turns`. It skips the model readiness checks (`opencode-import.ts` requires a provider today).
- A skills-only run also reads sessions whose project folder is gone; memory and profile runs still skip them.
- Automatic backfill passes `skipSkills: !skillLearning`, and runs a skills-only pass, with no model, when no memory work is pending but turns wait to be recorded.
- **Record past turns** is a grouped import with `skipMemories`, `skipProfile`, `scope: all-projects`, no cutoff and every set-up host. It runs through the existing grouped-import job, so the Memory page shows its progress as well. `om-memory-system skills record-past --yes` runs the same group in the terminal.

## Risks / Trade-offs

- [`skills.db` grows with full replies] → The card shows the file size and offers **Delete recorded turns**. A retention setting can follow if users ask for one.
- [Redaction off sends secrets to the external API on draft] → A danger callout and a confirmation step. Redaction is on by default.
- [Automatic mode writes a worse skill (the Hermes failure)] → Manual is the default. The automatic choice needs a confirmation. The stale check protects manual edits, and **Undo** restores the previous version.
- [Three processes write `skills.db` at once] → One short transaction for each turn, and a busy timeout from the connection manager. This is the same exposure as `user-prompts.db` today.
- [Skill detection misses a host's skill mechanism] → The `read` method covers any host that loads skills by reading `SKILL.md`. Missed cases only lower the counts.
- [Tool-call input is bounded by the readers] → Accepted. The input stays as long as memory capture already allows.
- [Swapping `captureConversation` for `handleFinishedTurn` at four sites changes memory behaviour by accident] → With skills off, the path is a direct call. The existing capture and import tests run unchanged, and task 3.4 adds a test for each site that the memory result is the same with skills on and off.
- [OpenCode live turns lose `<private>` text even with redaction off] → Accepted. The OpenCode prompt store strips it before skill learning reads the prompt, so the error is in the safe direction.
- [**Record past turns** on a large history takes a while] → It makes no model calls, shows progress, can be paused and cancelled like other imports, and is safe to run again.

## Migration Plan

No migration. `skills.db` is created on the first recorded turn. Existing import ledgers, runs and saved import drafts keep working. A draft with no `skills` field reads as skill turns on when recording is on. Rollback: turn off `skillLearning`, then delete `skills.db`. Nothing else reads it.
