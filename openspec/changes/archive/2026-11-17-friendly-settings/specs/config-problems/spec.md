# Spec Delta

## Purpose

Tell the user, in plain words and on every host, when OMMS cannot read the config file or cannot accept a value in it, and keep OMMS running while the file is fixed.

## ADDED Requirements

### Requirement: A config file that cannot be read is reported with its line

When a global or project config file exists but is not valid JSONC, OMMS SHALL record a problem with the file path, the line and column of the first error, and a plain sentence for the error. It SHALL keep today's fallback: the first load uses the defaults, and a reload keeps the last good settings. It SHALL NOT quote file content in the problem or the log.

#### Scenario: A missing comma

- **WHEN** line 12 of `~/.config/omms/omms.jsonc` lacks a comma between two keys
- **THEN** the problem SHALL name that file, line 12, and say that a comma is missing
- **AND** OMMS SHALL keep running

### Requirement: A value out of range names the key and the allowed range

When a config value fails validation, on the first load or on a live reload, OMMS SHALL record a problem that names the key, its line in the file when OMMS can find it, and the values it accepts. It SHALL use that key's default, except for a fail-safe key, and SHALL load every other setting from the file. It SHALL NOT stop loading, and SHALL NOT print the rejected value. Only a file that cannot be parsed keeps the last good settings on a reload.

#### Scenario: A retention of zero days

- **WHEN** the global file sets `"autoCleanupRetentionDays": 0`
- **THEN** OMMS SHALL load and SHALL use the default for that key
- **AND** the problem SHALL say that `autoCleanupRetentionDays` accepts whole numbers of 1 or more

#### Scenario: Other keys still apply

- **WHEN** the file sets an invalid `maxMemories` and a valid `memoryModel`
- **THEN** OMMS SHALL use the saved `memoryModel`

#### Scenario: A live edit with one bad value

- **WHEN** a running host has loaded the file, and the user then adds a new `memoryModel` and an invalid `maxMemories`
- **THEN** the next reload SHALL use the new `memoryModel` and the default `maxMemories`

### Requirement: A rejected value never leaves a risky feature on

For a fail-safe key, a rejected value SHALL turn its feature off for that load instead of using the default, and the problem SHALL say in plain words which feature is off. A switch written as text, such as `"false"`, SHALL be a rejected value.

#### Scenario: Days written as text while deletion is on

- **WHEN** the global file sets `"autoDeleteOldMemories": true` and `"autoCleanupRetentionDays": "365"`
- **THEN** no memory SHALL be deleted by age for that load
- **AND** the problem SHALL say that automatic memory deletion is off until the file is fixed

#### Scenario: Automatic import written as text

- **WHEN** the global file sets `"autoBackfill": "false"`
- **THEN** OMMS SHALL NOT import past chats automatically

### Requirement: The fail-safe keys

The fail-safe keys, and the switch each one turns off, SHALL be: `autoDeleteOldMemories` and `autoCleanupRetentionDays` turn off `autoDeleteOldMemories`; `autoBackfill`, `opencodeBackfillModel` and `piBackfillModel` turn off `autoBackfill`; `autoCaptureEnabled` turns off `autoCaptureEnabled`; `userProfileAutoCleanupEnabled` and `userProfileAutoCleanupInterval` turn off `userProfileAutoCleanupEnabled`; `webServerAutoStart` turns off `webServerAutoStart`.

#### Scenario: A bad import model

- **WHEN** the global file sets `piBackfillModel` to a value with no `/`
- **THEN** automatic import of past chats SHALL be off for that load

### Requirement: A bad value elsewhere does not block a Settings save

The Settings page SHALL refuse a save only when the config file cannot be parsed, or when a key in the save itself holds a value OMMS cannot use. A rejected value under another key SHALL stay in the file as written.

#### Scenario: Turning deletion off while the days are rejected

- **WHEN** the global file sets `"autoCleanupRetentionDays": "365"` and the user saves `autoDeleteOldMemories: false`
- **THEN** the save SHALL succeed
- **AND** the `autoCleanupRetentionDays` line SHALL remain as the user wrote it

### Requirement: Every host shows a config problem to the user

When a config problem is recorded, OpenCode SHALL show a notice at start, Pi SHALL show a notice at session start, and the Claude Code session-start hook SHALL show a message. Each SHALL name the file, the line or the key, and tell the user to fix the file. It SHALL also point to the Settings page only when a Settings card can change that key. Each host SHALL show a given problem once per session.

#### Scenario: Pi starts with a broken file

- **WHEN** Pi starts a session and the global file has a syntax error on line 4
- **THEN** Pi SHALL show one notice that names the file and line 4

#### Scenario: Claude Code starts with a bad value

- **WHEN** a Claude Code session starts and the global file sets `maxMemories` out of range
- **THEN** Claude Code SHALL show a message that names `maxMemories` and its allowed range

### Requirement: Claude Code session-start notices use one reply field

The Claude Code SessionStart hook SHALL send `"notices": true` in its request to the web app. The web app's reply SHALL carry an optional `systemMessage` string, with one line per notice, joined with a newline. Config problems SHALL be lines in that string. The hook SHALL copy a string `systemMessage` to the `systemMessage` field of its one stdout JSON object, and SHALL NOT put it in `additionalContext`. A request without `notices` SHALL get no `systemMessage`.

#### Scenario: A problem at session start

- **WHEN** the hook sends a SessionStart request with `"notices": true` and the global file has a syntax error on line 4
- **THEN** the reply SHALL carry a `systemMessage` line that names the file and line 4
- **AND** the hook SHALL print one JSON object whose `systemMessage` holds that line and whose `additionalContext` does not

#### Scenario: An older hook

- **WHEN** a SessionStart request has no `notices` field
- **THEN** the reply SHALL have no `systemMessage`

### Requirement: Removed config keys are ignored

OMMS SHALL ignore `maxProfileItems`, `userProfileDisplayPreferences`, `userProfileDisplayPatterns` and `userProfileDisplayWorkflows` in the global and project config files. It SHALL NOT validate them, fail on them, report them as a problem, or rewrite the file to remove them.

#### Scenario: An old file keeps the removed keys

- **WHEN** the global file sets `"maxProfileItems": 5` and `"userProfileDisplayWorkflows": 10`
- **THEN** OMMS SHALL load the config with no error and no problem
- **AND** the file SHALL remain unchanged
