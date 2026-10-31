# ADR-035: Skill learning stores full turns in skills.db

- **Date:** 2026-10-30
- **Status:** Accepted
- **Deciders:** Aizat Hawari
- **Change:** [`skill-learning`](../../openspec/changes/archive/2026-10-31-skill-learning/proposal.md)

## Context

Agents repeat the same workflows, hit the same errors and get the same corrections, but the skills they load never learn from it. OMMS sees every turn on Pi, OpenCode and Claude Code. After memory capture it keeps only the prompt text for the profile. It drops the replies, the tool calls, and which skills ran.

To rank skills and draft better versions, OMMS needs the full turn: what the agent said, which tools it called, and which calls failed. This data is more sensitive than a project memory. The Security rule in `AGENTS.md` allowed one exception for stored conversation text, the capture retry queue (ADR-012). Skill learning needs a second one.

The user decided that full replies are worth keeping, because the data stays on their own computer.

## Decision

1. **Recording is opt-in.** The global setting `skillLearning` defaults to `false`. A project config can set it to `false` but a project value of `true` is ignored, so a cloned repository cannot start recording conversations. This follows `captureTrace`.
2. **A turn keeps the prompt, every assistant reply in full, and every tool call in order** with its name, input (as the host reader bounds it), outcome, and error text. Tool output bodies are not stored. A `Read` of a large file would multiply the store size, and the outcome and error text carry the learning signal.
3. **Redaction is a switch that is on by default.** When `skillLearningRedact` is `true`, OMMS removes `<private>` text and redacts secrets (the capture trace rules) before it stores a turn. The user can turn it off in the global config. Only the global config sets it. The Settings page shows a warning callout when it is off.
4. **A separate store, `skills.db`,** in the storage path, never inside a project folder. Project memories, `user-prompts.db`, the user profile and the memory chat never read from it or write to it. It opens through the shared connection manager, like `chats.db` (ADR-032), with its own schema version.
5. **One shared turn path.** Live capture on all three hosts and the history importer hand each finished turn to `handleFinishedTurn`, which sends it to memory capture and to skill turns when each is on. Skill learning adds an output to the existing pipeline and has no recorder of its own. Recording makes no model call, does not depend on memory capture, and a failure to record is logged without turn text and never blocks capture.
6. **Drafting uses the external API only.** Drafting and automatic review call the same external API model as the memory chat (ADR-033), because Claude Code hooks cannot call the session model. Tool outcomes, error texts and skill use go only to `skills.db`, and the memory capture request does not change.
7. **The user can delete recorded turns** from the Settings page or the terminal. Turning recording off does not delete them. The log never holds turn text.

## Implementation notes

- **One key per turn.** A turn is keyed `<host>:<session id>:<user message id>`. Live OpenCode capture keys skill turns with OpenCode's message id, the id the importer reads, so a turn captured live and later imported is stored once. The memory work unit keeps its own prompt id.
- **Memory input stays byte-identical.** Readers still cut tool inputs at 100 characters for memory capture. A read call's full path goes into a separate `path` field that memory capture ignores and skill detection reads. A test checks that the capture prompt is unchanged.
- **Claude Code records from a raw copy of the turn** that keeps outcomes and paths and does not strip `<private>` text, so the redaction switch decides what is stored. It records even when capture is off, without moving the capture cursor.
- **Imports record skill turns before the ledger checks,** so sessions already imported for memories still reach `skills.db`. A skills-only import makes no model call.
- **Drafting reuses profile learning's protections** with its own keys: a separate 10-minute failure wait (`skillDraftBackoff`) and a separate lease table (`skill_review_lease`).
- **`skills.db` follows the global storage path.** A project config that moves `storagePath` never moves `skills.db` into a project folder.
- **Delete recorded turns compacts the file,** so deleted text does not stay readable in free pages. `ai-sessions.db`, which holds draft prompts, uses `secure_delete` and is compacted once when it has free pages.
- **Ranking counts a failure against a skill only after the skill was used in that turn,** and offers an attention order, (failures + 1) / (uses + 2), beside the default most-used order.
- **An agent can fix a skill with no external API call** through the `skills` tool modes `evidence` and `propose`. The turn text then enters that agent's own session.
- **Known gaps.** OpenCode removes `<private>` text from prompts before OMMS sees them, so with redaction off its live prompts are still stored stripped. OpenCode with `chatMessage.enabled` off saves no prompts and so records no skill turns.

## Alternatives rejected

- **Structured events only** (skill name, tool name, outcome, no text). It removes most of the risk, but the user rejected it: it loses the replies that show how the agent worked.
- **New tables in `user-prompts.db`.** ADR-012 limits what that file holds, and the user asked for no mixing with memory or profile data.
- **One JSONL file for each day.** Ranking needs indexed counts and the apply step needs transactions.
- **A separate recorder beside each capture site.** It would run parallel to the import pipeline, so history import, backfill, progress and dedupe would each need a second copy.

## Consequences

- `skills.db` can hold full prompts and replies, so the user must treat it as private. The Settings page shows its size.
- With redaction off, secrets can be stored and can be sent to the external API when a draft is made. A danger callout and a confirmation step guard that choice.
- `AGENTS.md` lists `skills.db` as the second exception to the Security rule.
