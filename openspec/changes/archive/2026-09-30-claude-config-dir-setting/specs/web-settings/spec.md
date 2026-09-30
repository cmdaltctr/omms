## ADDED Requirements

### Requirement: The page sets the Claude Code folder

The Settings page SHALL have a **Claude Code folder** section with a text field for `claudeConfigDir`. The field SHALL be empty by default. The section SHALL show the projects folder in use and where it comes from: the setting, the `CLAUDE_CONFIG_DIR` environment variable of the web app, or the default. It SHALL warn when that folder does not exist. It SHALL accept an absolute path, or a path that starts with `~/`, and SHALL reject any other value with a message. A project config SHALL NOT override the setting. The text SHALL be available in every language the page supports.

#### Scenario: Setting a folder

- **WHEN** the user enters `/data/claude` and saves
- **THEN** the global config SHALL have `claudeConfigDir` set to `/data/claude`
- **AND** the section SHALL show `/data/claude/projects` as the folder in use, with the source "setting"

#### Scenario: A folder that does not exist

- **WHEN** the folder in use does not exist on this computer
- **THEN** the section SHALL show a warning that names the folder

#### Scenario: Clearing the field

- **WHEN** the user clears the field and saves
- **THEN** the web app SHALL use `CLAUDE_CONFIG_DIR` when it is set, and `~/.claude` when it is not

#### Scenario: A relative path

- **WHEN** the user enters `claude/config` and saves
- **THEN** the page SHALL reject the value and SHALL NOT change the global config
