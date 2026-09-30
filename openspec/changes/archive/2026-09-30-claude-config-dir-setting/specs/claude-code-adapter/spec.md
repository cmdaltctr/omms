## ADDED Requirements

### Requirement: The capture endpoint reads only Claude Code transcripts

The capture endpoint SHALL accept a transcript path only when the path, after symlinks are resolved, is under the Claude projects folder and the file name is `<session-id>.jsonl`, where the session id is the one in the same request. The Claude projects folder SHALL be resolved as `<Claude folder>/projects`. The Claude folder is the `claudeConfigDir` setting when it is set, otherwise the `CLAUDE_CONFIG_DIR` environment variable of the web app, otherwise `~/.claude`. The endpoint SHALL compare paths by the letter case on disk. It SHALL answer any other path with `400` and SHALL NOT read the file.

#### Scenario: A transcript in the default folder

- **WHEN** `claudeConfigDir` is empty, `CLAUDE_CONFIG_DIR` is not set, and the hook sends `~/.claude/projects/<folder>/<session-id>.jsonl`
- **THEN** the endpoint SHALL queue the capture

#### Scenario: A transcript in the folder from the setting

- **WHEN** `claudeConfigDir` is `/data/claude` and the hook sends `/data/claude/projects/<folder>/<session-id>.jsonl`
- **THEN** the endpoint SHALL queue the capture, whatever `CLAUDE_CONFIG_DIR` says

#### Scenario: A path outside the folder

- **WHEN** the path is outside the projects folder, reaches it through a symlink, or has a file name other than `<session-id>.jsonl`
- **THEN** the endpoint SHALL answer `400`
- **AND** it SHALL NOT read the file

#### Scenario: The setting changes while the web app runs

- **WHEN** the user saves a new `claudeConfigDir` on the Settings page
- **THEN** the next capture request SHALL use the new folder without a restart
