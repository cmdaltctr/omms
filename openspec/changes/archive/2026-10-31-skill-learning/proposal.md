# Proposal: Skill learning

## Why

Agents repeat the same workflows, hit the same errors and get the same corrections, but the skills they load never learn from it. OMMS already sees every turn on Pi, OpenCode and Claude Code. Today it keeps only prompt text for the profile, and it drops replies, tool calls and skill use after memory capture. With that data kept on the user's own computer, OMMS can show which skills the user relies on and draft better versions of them.

## What Changes

- **Opt-in turn recording.** A new global setting `skillLearning` (off by default) records each full turn: the prompt, every assistant reply, every tool call with its input and outcome, and the skills the turn used. Turns go into a new store, `skills.db`, in the storage path. Project memories, `user-prompts.db` and the user profile stay as they are and never read from it.
- **One turn path, shared options.** Live capture and history import hand each finished turn to one shared path, which sends it to project memories and skill turns when each is on. Skill learning adds an output to the existing pipeline and gets no recorder of its own. Profile prompts keep their current recording, and the same import options choose all three outputs. The profile and memories keep their current inputs. Tool calls and skill use go only to `skills.db`.
- **Skill turns are an import target.** History imports gain `--skip-skills` next to `--skip-memories` and `--skip-profile`, and the Memory page import gains a **Skill turns** checkbox. Automatic backfill records skill turns when recording is on. Recording a turn makes no model call, so OMMS also reads sessions the memory ledger has already handled. A turn that was both live-captured and imported is stored once.
- **Record past turns.** When the user turns recording on, OMMS offers a one-time run that records turns from every host's history, with no model calls. With it, the Skills tab has data from the first day.
- **Redaction is a setting.** `skillLearningRedact` (on by default) strips `<private>` text and redacts secrets before a turn is stored. The user can turn it off. The page shows a warning callout when they do.
- **Tool outcomes.** The three host readers add each tool call's outcome (succeeded or failed) and a short error text to the shared capture work unit. Memory capture ignores the new fields.
- **Watched skill folders.** The user chooses the folders that hold their skills. The defaults are `~/.agents/skills` and the Claude Code folder's `skills` folder, when they exist.
- **Skill ranking.** OMMS counts how often each skill was used in the last 30 days and how many of those turns had a failed tool call. It marks the skills worth improving.
- **Proposals.** For a chosen skill, OMMS drafts a revised `SKILL.md` from recent turns that used it and shows the diff. It can also find ideas for new skills in recorded turns and draft them. Drafting uses the external API model, and reuses profile learning's failure wait and one-run lease, each with its own key.
- **Manual or automatic per skill.** Manual mode waits for the user to apply or reject each proposal. Automatic mode applies proposals without asking. Every apply first checks that the file has not changed since the draft, and keeps the previous version for **Undo**.
- **Skills tab.** A new **Skills** entry in the left bar opens `/skills`. A new **Skill learning** card on the Settings page holds the switches, warning callouts, the store size and **Delete recorded turns**.
- **Agent tool.** A new `skills` tool on all three hosts, plus an `om-memory-system skills` terminal command, lists skills, drafts proposals, shows diffs, and applies or rejects them.
- **Security rule update.** `AGENTS.md` (which `CLAUDE.md` links to) gets a second documented exception for `skills.db`. A new ADR records the decision.

Out of scope: editing files other than `SKILL.md`, GEPA-style evaluation runs, and feeding tool calls or skill use into the profile or project memories.

## Capabilities

### New Capabilities

- `skill-learning-capture`: opt-in recording of full turns, tool outcomes and skill use into `skills.db` on every host, from live capture and history import, with optional redaction and deletion.
- `skill-learning-proposals`: watched folders, skill ranking, drafting improvements and new skills, manual and automatic apply with undo, and the `skills` agent tool and terminal command.
- `web-skills`: the Skills tab at `/skills` and the Skill learning settings card with its warning callouts.

### Modified Capabilities

None. Tool outcomes are new optional fields on the work unit, and memory capture behaviour stays the same.

## Impact

- **New code:** `src/core/turn-outputs.ts` (the shared turn path), `src/services/skill-learning/` (store, skill-turn output, ranking, drafting, apply), `src/core/skill-operations.ts` (shared tool operations), `src/cli/skills-command.ts`, web API routes, and `web/src/lib/components/skills/`.
- **Changed code:** `src/core/host.ts` (`CaptureToolCall` fields), the live readers and the OpenCode import reader, the turn-end handlers in `src/services/auto-capture.ts`, `src/adapters/pi/capture.ts` and `src/importer/claude-hook-api.ts`, the importer (`import-args.ts`, `importer.ts`, `run-import.ts`, the three host imports, `auto-backfill.ts`), `src/core/profile-backoff.ts` (keyed waits), the Memory page import form, tool registration in `src/index.ts`, `src/adapters/pi/extension.ts` and `hooks/`, `src/config.ts`, `web/src/lib/routes.ts` and the sidebar.
- **Data:** a new `skills.db` file in the storage path. It can hold full prompts and replies, so the user must treat it as private.
- **Model cost:** one external API call for each draft, and two for a new-skill idea run. Recording itself makes no model call.
- **Writes outside the store:** OMMS writes `SKILL.md` files, but only inside a watched folder.
- **Docs:** a new `docs/skill-learning.md` guide, `docs/configuration.md`, `docs/cli.md`, the three history import guides, `docs/web-ui-memory.md`, `docs/web-ui-settings.md`, `docs/README.md`, ADR-036, and `AGENTS.md`.
