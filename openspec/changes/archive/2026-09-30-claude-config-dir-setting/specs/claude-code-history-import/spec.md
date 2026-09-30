## MODIFIED Requirements

### Requirement: Claude Code transcripts are read by one shared reader

OMMS SHALL read Claude Code session transcripts from `<projects folder>/<project-folder>/<session-id>.jsonl`, or from the folder given by `--root`. The projects folder SHALL be `<Claude folder>/projects`. The Claude folder is the `claudeConfigDir` setting when it is set, otherwise the `CLAUDE_CONFIG_DIR` environment variable, otherwise `~/.claude`. The reader SHALL take the project directory from each entry's recorded working directory, not from the folder name. It SHALL build one work unit per user prompt that produced assistant text or tool work, oldest first, with the prompt text, the assistant text parts, the tool calls with their inputs, the entry ids, and the prompt timestamp. It SHALL skip sidechain entries, meta entries, tool results, and entries it cannot parse, and it SHALL count the skipped entries. Live capture and the history import SHALL use the same reader. The reader SHALL be covered by fixture transcripts saved in the repository, because the transcript format is internal to Claude Code.

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

#### Scenario: A custom Claude folder

- **WHEN** `claudeConfigDir` is `/data/claude` and the user runs `om-memory-system import-claude-history` without `--root`
- **THEN** the reader SHALL read `/data/claude/projects`

## ADDED Requirements

### Requirement: Every Claude Code surface uses the same projects folder

The terminal importer, the web import readiness, the web session list, the web folder picker's start folder, and the automatic backfill SHALL use the same projects folder as live capture. One resolver SHALL produce it. A `--root` option SHALL still override it for the terminal importer.

#### Scenario: The web import screens with a custom folder

- **WHEN** `claudeConfigDir` is `/data/claude` and the user opens the Claude Code import screen
- **THEN** the readiness check and the session list SHALL read `/data/claude/projects`
