# claude-code-history-import Specification

## Purpose

Defines how OMMS reads past Claude Code transcripts and imports them into the shared store, from the terminal, the web app, and the automatic backfill.

## Requirements

### Requirement: Claude Code transcripts are read by one shared reader

OMMS SHALL read Claude Code session transcripts from `~/.claude/projects/<project-folder>/<session-id>.jsonl`, or from the folder given by `--root`. The reader SHALL take the project directory from each entry's recorded working directory, not from the folder name. It SHALL build one work unit per user prompt that produced assistant text or tool work, oldest first, with the prompt text, the assistant text parts, the tool calls with their inputs, the entry ids, and the prompt timestamp. It SHALL skip sidechain entries, meta entries, tool results, and entries it cannot parse, and it SHALL count the skipped entries. Live capture and the history import SHALL use the same reader. The reader SHALL be covered by fixture transcripts saved in the repository, because the transcript format is internal to Claude Code.

#### Scenario: A transcript with tool use

- **WHEN** the reader loads a transcript where a prompt led to three tool calls and a final reply
- **THEN** it SHALL return one work unit with that prompt, the reply text, and the three tool calls

#### Scenario: A subagent sidechain

- **WHEN** a transcript holds sidechain entries from a subagent
- **THEN** those entries SHALL NOT become work units or be added to the parent turn

#### Scenario: An unknown entry type

- **WHEN** a line holds an entry type the reader does not know
- **THEN** the reader SHALL skip that line and continue

#### Scenario: A line that is not JSON

- **WHEN** a transcript line cannot be parsed
- **THEN** the reader SHALL count it as unreadable and continue with the next line

### Requirement: Claude Code history can be imported from the terminal

`om-memory-system import-claude-history` SHALL import Claude Code transcripts with the shared import options. `--root` SHALL name the transcripts folder and SHALL default to `~/.claude/projects`. The import SHALL use the shared importer, its ledger, and the live capture pipeline, with host `claude-code` and source type `history-import`. It SHALL need the external API, or `--provider`, `--api-url`, and `--api-key-env`, in the same way as the other terminal imports. Reruns SHALL be idempotent and failed units SHALL be retryable. Exchanges that live capture already saved SHALL be skipped by their entry ids.

#### Scenario: A dry run over all projects

- **WHEN** the user runs `om-memory-system import-claude-history --dry-run --scope all-projects`
- **THEN** the command SHALL report the sessions and work units it would import, per project, and store nothing

#### Scenario: A rerun after a partial import

- **WHEN** an import stopped half way and the user runs it again
- **THEN** already imported units SHALL be skipped and the rest SHALL be imported

#### Scenario: A turn that live capture saved

- **WHEN** a transcript turn was captured live by the `Stop` hook
- **THEN** the import SHALL skip that turn

### Requirement: Claude Code appears in the web import surfaces

The web Settings page SHALL show Claude Code in import readiness, the import source browser, session listing, and the import form, with the same fields the other hosts show. The source kind for a transcripts folder SHALL be validated and signed like the Pi folder kind.

#### Scenario: Browsing Claude Code sessions

- **WHEN** the user opens the import form for Claude Code on the Settings page
- **THEN** it SHALL list the sessions found under the default folder, with their project directories and dates

### Requirement: Claude Code history is backfilled automatically

When `autoBackfill` is on and a Claude Code session start reaches the web app, the web app SHALL run the Claude Code backfill after the start-up delay, with the same cutoff, pacing, single-run lock, pause and resume controls, progress record, and unresolved-directory record as the other hosts. The backfill model SHALL be the external API. When the external API is not fully configured, the run SHALL NOT start and the status SHALL say which setting is missing. The Settings page SHALL show the Claude Code backfill status and controls.

#### Scenario: First Claude Code session on a machine with history

- **WHEN** `autoBackfill` is on, the external API is set up, and a Claude Code session starts with transcripts that were never imported
- **THEN** the web app SHALL import them in the background
- **AND** the session SHALL become usable without waiting

#### Scenario: The backfill is paused

- **WHEN** the user has paused the Claude Code backfill and a Claude Code session starts
- **THEN** no Claude Code backfill SHALL start

#### Scenario: The external API is missing

- **WHEN** `memoryApiUrl` is not set and a Claude Code session starts
- **THEN** no backfill SHALL start
- **AND** the status SHALL say that `memoryApiUrl` is missing
