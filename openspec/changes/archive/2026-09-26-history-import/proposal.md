# Proposal

## Why

The maintainer moved to a new Mac. Past work is still available as history: 1,006 OpenCode sessions in `~/.local/share/opencode/opencode.db` (June to September 2026) and 262 Pi sessions in `~/.pi/agent/sessions`. The old memory store was not carried over, so omms starts from zero. omms can already rebuild memories from Pi history (`/memory-import-pi-history`), but it has no OpenCode importer and neither importer feeds the user profile. The old `opencode-mem-scripts` (`backfill-memories.py`, `backfill-profile.py`, `build-profile.py`) no longer work with omms:

- They write `opencode_project_<sha(dir)>` tags, but omms reads `omms_project_<sha(git identity)>`.
- They send no web API token, so requests are rejected.
- They write to `~/.opencode-mem/data` instead of `~/.omms/data`.
- They store raw prompt dumps instead of AI summaries.

A live check also showed that a Pi auto-capture fails when the model answers "skip" without the empty `summary`/`tags` fields.

## What Changes

- **New terminal command `import-opencode-history`** (run as `npx om-memory-system import-opencode-history`), a 3-in-1 replacement for the three scripts:
  1. **Memories:** reads `opencode.db` read-only and turns each past exchange into a memory through the same capture pipeline as live use. It has a dry-run, a durable ledger so re-runs never duplicate, date/session/project filters, and `--map`. Sessions from deleted worktrees are sent automatically to their repository using OpenCode's own project table. Sub-agent sessions are read as part of their parent session, not as separate conversations.
  2. **Profile prompts:** records the maintainer's own past prompts (not AI replies) for profile learning in the omms store.
  3. **Profile build:** runs omms's profile learning over those prompts in batches, creating or updating the user profile.
- **Model choice for bulk imports:** by default the importer uses omms's configured external model. `--provider`, `--model` and `--api-url`, with the key read from an environment variable, choose a separate, cheaper model for the import only.
- **Pi importer parity:** `/memory-import-pi-history` gains the same profile steps (2 and 3) and a `--model <provider/id>` option to use a Pi model other than the active one for the import.
- **Capture fix:** a reply whose type is `skip` is accepted even when `summary` or `tags` are missing. When a reply cannot be parsed, a shortened copy of the raw reply is logged so the cause can be seen.
- The old Python scripts are superseded. The docs describe the new commands and how to replace the scripts.

## Capabilities

### New Capabilities

- `opencode-history-import`: importing OpenCode session history into omms memories and the user profile from the terminal, with dry-run, ledger, project resolution, and model selection.

### Modified Capabilities

- `pi-session-history-backfill`: the Pi importer also records past prompts for profile learning, builds the user profile, and accepts a model option for the import.
- `host-neutral-memory-core`: capture extraction accepts `skip` replies without `summary`/`tags` and reports unparseable replies.

## Impact

- **Code:**
  - new `src/cli/` entry point plus the `bin` field in `package.json`
  - new `src/importer/opencode-*.ts` (discovery, session reader, project resolution)
  - `src/importer/importer.ts` and `ledger.ts`, generalised from Pi-only to both hosts
  - `src/adapters/pi/import-command.ts` and `profile.ts`
  - a host-neutral profile analyser moved out of the Pi adapter
  - `src/core/extraction.ts` for the capture fix
- **Tests:** OpenCode reader and resolution fixtures (small SQLite fixture DBs), ledger idempotency, profile steps, the CLI in dry-run, and the skip-parse regression.
- **Docs:** README, `docs/pi-history-import.md`, and a new `docs/opencode-history-import.md`.
- **Decision records (kept local, not committed):** ADR-002 for the built-in importer; ADR-003 for the npm name `om-memory-system` and the fixed plugin id; ADR-004 for the release pipeline; TDR-001 for reading OpenCode's live database; TDR-002 for the capture skip fix. `docs/tdr/` is added to `.gitignore`, as `docs/adr/` already is.
- **Runtime:** the CLI runs under Node 22.14 or later from the installed npm package. It reads `opencode.db` read-only and in immutable mode, so OpenCode can stay running. It makes one model call per non-skipped exchange, plus one per profile batch.

## Scope added during review

Review of PR #12 widened the change: both hosts now import in a session with the session's model, both have a terminal command, and live capture uses one model rule on both hosts. The delta specs and tasks section 9 record this; ADR-005 and ADR-006 explain the decisions.
