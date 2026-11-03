# ADR-040: Hooks add only what the prompt needs

- **Date:** 2026-11-03
- **Status:** Proposed
- **Deciders:** Aizat Hawari
- **Change:** [`align-recall-host-parity`](../../openspec/changes/align-recall-host-parity/proposal.md)

## Context

The three hosts did not inject memories alike. Claude Code added the project's recent memories at `SessionStart`, before the user typed anything. OpenCode V2 and Pi added nothing before the first prompt. A recent list gives general context to every session, including sessions that need none of it.

Other gaps made the hosts behave differently:

- Subagent sessions got memories on OpenCode V2 only. Claude Code had no `SubagentStart` hook, and Pi starts children with `--no-extensions`.
- Restore after compaction worked on OpenCode V2 and Claude Code. Restore after resume worked on Claude Code only. Pi restored nothing.
- Claude Code recall rows ignored `visibleRecall`.
- A restored section on Claude Code was labelled `mode=recent`, which describes a list that no longer exists.

## Decision

1. **The hook is an intermediary. It adds only what the prompt needs.** By default every host adds the recall for the current prompt and nothing else before the first prompt.
2. **Injection at session start is an option, off by default, and driven by a query.** `openingContext` (default `false`) and `openingContextQuery` (default `project architecture, setup, conventions and key decisions`, global only, 500 characters at most) add the memories that match the query. They use the same relevance filter, result limit and size budget as the prompt recall.
3. **"Session start" means the first message of a new session on all three hosts.** OpenCode V2 and Pi send no model request before the first prompt. Claude Code could add text at `SessionStart`. It uses its first `UserPromptSubmit` instead, so the three hosts behave the same. `SessionStart` with source `startup` or `clear` adds nothing. The hook still starts the web app, the backfill and the plugin self-update check.
4. **Subagent memory is on by default.** `subagentMemory` (default `true`) gives a subagent session the memories that match its task. OpenCode V2 child sessions get the prompt recall. Claude Code has a new `SubagentStart` hook that reads the parent transcript for the unanswered `Agent` or `Task` call of the same `subagent_type`, and uses its prompt as the search. With no match it adds nothing. Pi has a child gate in the extension, and the injection waits for om-pi-subagents to load OMMS in children. No host shows rows in a subagent session. The plugin registers no `SubagentStop` hook, so subagent turns are not captured on their own.
5. **Restore after compaction and after resume works on all three hosts**, controlled by the existing `compaction.enabled` and `compaction.memoryLimit`. A project config can turn it on or off. Only the session's own memories from the same host come back, as a short reminder. Pi's own compaction summary is not replaced.
6. **Rows say what the section is.** Row modes are `search`, `opening` and `restore` on every host. Claude Code draws no `mode=recent` row.
7. **Claude Code honours `visibleRecall` with a marker.** The hook command can reach the recall module only through the injected text. While rows are off, each injected section carries the line `<!--omms:rows-off-->` (21 bytes) right after the opening tag. The opening section carries `<!--omms:opening query="...">` when rows are on.
8. **The host differences that stay are written down with a reason.** The single home is [Using memory: Host differences](../using-memory.md#host-differences). A new difference needs a row with its reason there.
9. **OpenCode work is V2 only.** OpenCode V1 still adds its recent list to the first message and ignores the new settings.
10. **Project config rule.** A project config can turn `openingContext` and `subagentMemory` off, never on. A project query is ignored. `compaction.enabled` keeps its existing rule: a project config can set it on or off.

## Alternatives rejected

- **Keep the Claude Code recent list as the default.** It adds context that most prompts do not need. The user chose default off on all three hosts.
- **Deliver the opening context at `SessionStart` on Claude Code only.** That gives one setting two behaviours.
- **Stop sending the `SessionStart` request at `startup`.** The backfill start depends on it.
- **Fixed opening text.** It would be a second instructions file. `AGENTS.md` and `CLAUDE.md` already do that job.
- **A recency list for the opening context.** It is a search that ignores the topic.
- **A `PreToolUse` hook that rewrites the Agent tool input.** It changes Claude's tool input, and the memories would then be captured as task text.
- **Pass `visibleRecall` to Claude Code through the status command.** The status command reads only the global config and refreshes every 6 hours, so a project value would apply late.
- **A new setting for the restore.** Two switches could disagree.

## Consequences

Release note wording:

- Claude Code no longer adds recent memories at session start by default.
- Every subagent session gets extra context by default.

Positive:

- The three hosts behave alike for the prompt recall, the opening context, subagent memory and the restore.
- A user who wants a briefing at the start turns on `openingContext` and edits the query in the Memory page.

Negative:

- Claude Code users lose the opening list by default. The same memories arrive when a prompt matches them.
- Subagent memory costs up to one retrieval budget (`retrievalMaxTokens`) of extra context for each subagent session, and one search for each subagent prompt.
- Claude Code reads the task of a subagent from the parent transcript. That is not documented Claude Code behaviour. It was checked on Claude Code 2.1.317.
- Trade-off: while rows are off, the Claude Code injected text carries one 21-byte marker line for each section. With rows on, the opening section carries the configured query once per session. Both markers count in the size budget and hold no memory text.
- Pi subagents get memories only after om-pi-subagents loads OMMS in children. That change is in another repository.

Neutral:

- Fold state is kept on OpenCode across restarts, and lost on Pi and Claude Code (TDR-062).

## Revisit triggers

- Claude Code adds the task prompt to the `SubagentStart` input. OMMS could stop reading the parent transcript.
- om-pi-subagents loads OMMS in children. Pi subagent memory then works, and the host difference closes.
- OpenCode V1 support ends. The `recent` mode and the V1 first-message list can go.
