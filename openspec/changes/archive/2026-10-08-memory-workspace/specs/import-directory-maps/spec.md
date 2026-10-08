# Spec Delta

## MODIFIED Requirements

### Requirement: The Settings page manages directory maps

The Memory page SHALL have a **Resolve missing project folders** section. It SHALL explain that a directory map links a recorded project folder to its current folder. It SHALL list saved maps, ignored directories, and the directories the latest listing, preview, or backfill could not resolve, for each host, with the number of sessions in each. For each unresolved directory it SHALL show a suggestion when the suggestion rules give one, and SHALL let the user edit the target, clear it, or ignore the directory. Saving SHALL write `importPathMaps` and `importIgnoredDirectories` in the global config with the same safe-save rules as other settings. The page SHALL say that a change applies to the next import or backfill run. It SHALL NOT show conversation content.

A map suggestion SHALL be an existing directory, chosen by the rules in **Suggestions follow known projects, moves, and renames**. A row with an ignore proposal SHALL show the reason. When no rule gives a result, the page SHALL show no suggestion and SHALL let the user type a target, ignore the directory, or leave it unmapped.

#### Scenario: Accepting a suggested target

- **WHEN** Pi sessions are recorded in `/Users/me/code/app-feat-x`, which no longer exists, and `/Users/me/code/app` is a Git repository
- **THEN** the page SHALL suggest `/Users/me/code/app`
- **AND** confirming it in Smart resolve SHALL add the map to `importPathMaps`

#### Scenario: No candidate exists

- **WHEN** sessions were recorded in `/Users/me/old/notes`, which no longer exists, and no rule gives a result
- **THEN** the page SHALL show the directory with no suggestion
- **AND** its sessions SHALL stay unresolved unless the user types a target or ignores the directory

#### Scenario: Removing a map

- **WHEN** the user marks a saved map for removal and presses Save removals
- **THEN** the map SHALL leave `importPathMaps`
- **AND** memories already imported through it SHALL remain

### Requirement: Directory maps are grouped by host

The Resolve missing project folders section SHALL show saved maps once, above the host cards, in a collapsed **Saved maps** disclosure. Its summary SHALL show the number of saved maps and SHALL say that saved maps apply to every host. Inside, the page SHALL group saved maps by target directory, one collapsed disclosure per target, whose summary shows the target and its map count. Each map SHALL offer Remove, and removals SHALL be saved by a **Save removals** button inside the Saved maps disclosure, enabled only while a removal is pending. The section SHALL then show one inner card for each host: Pi, OpenCode, and Claude Code. Each card SHALL list the host's unresolved directories, without ignored directories, with the number of sessions in each. A card with nothing to list SHALL say so in one line.

#### Scenario: Unresolved directories on two hosts

- **WHEN** Pi has 3 unresolved directories and Claude Code has 5
- **THEN** the Pi card SHALL list 3 directories, the Claude Code card SHALL list 5, and the OpenCode card SHALL say it has none

#### Scenario: Many saved maps

- **WHEN** 34 saved maps point at 6 target directories
- **THEN** the Saved maps disclosure SHALL be collapsed and show 34
- **AND** opening it SHALL show 6 collapsed target groups with their map counts

#### Scenario: Removing a map from a group

- **WHEN** the user opens a target group, presses Remove on one map, and presses Save removals
- **THEN** only that map SHALL leave `importPathMaps`
- **AND** unsaved target edits in the host cards SHALL remain unchanged
