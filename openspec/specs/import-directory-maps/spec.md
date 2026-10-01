# import-directory-maps Specification

## Purpose

Let the user save directory maps once, so that history recorded in deleted or moved directories is imported into the right project by automatic backfill, web imports, and CLI and slash-command imports alike.

## Requirements

### Requirement: Saved directory maps apply to every import

The global config SHALL accept `importPathMaps`, a list of maps, each with a source directory `from` and a target directory `to`. Automatic backfill, web imports, and CLI and slash-command imports on both hosts SHALL resolve project directories with these maps, using the existing resolution order: an exact directory map first, then the recorded directory, then, for OpenCode only, the project worktree. A `--map` flag or a web import's own map SHALL add to the saved maps for that run, and SHALL win over a saved map with the same source directory. A map whose target directory does not exist SHALL leave its sessions unresolved. `importPathMaps` SHALL be read from the global config only. Invalid entries SHALL be rejected by the same validation used at startup.

#### Scenario: Automatic backfill uses a saved map

- **WHEN** `importPathMaps` maps `/Users/me/code/app-feat-x` to `/Users/me/code/app` and Pi's backfill finds sessions recorded in `/Users/me/code/app-feat-x`, which no longer exists
- **THEN** those sessions SHALL be imported into the project of `/Users/me/code/app`

#### Scenario: A CLI map overrides a saved map

- **WHEN** a saved map sends `/old` to `/a` and the user runs an import with `--map /old=/b`
- **THEN** that run SHALL use `/b` for sessions recorded in `/old`
- **AND** the saved map SHALL be unchanged

#### Scenario: The target directory is missing

- **WHEN** a saved map points at a directory that does not exist
- **THEN** its sessions SHALL be reported as unresolved and SHALL NOT be assigned to any project

#### Scenario: A project config sets maps

- **WHEN** a project config sets `importPathMaps`
- **THEN** the value SHALL be ignored and the global value SHALL apply

### Requirement: The Settings page manages directory maps

The Settings page SHALL have a **Directory maps** section. It SHALL list the saved maps and the directories that the latest listing, preview, or backfill could not resolve, for each host, with the number of sessions in each. For each unresolved directory it SHALL offer a suggested target when one can be found, and SHALL let the user accept, edit, or reject it. Saving SHALL write `importPathMaps` to the global config with the same safe-save rules as other settings. The page SHALL say that a change applies to the next import or backfill run. It SHALL NOT show conversation content.

A suggestion SHALL be an existing directory. The page SHALL suggest, in this order: the main repository of a deleted Git worktree, found as an existing directory whose name is the longest leading part of the missing directory's name or of one of its parent directories' names (for example `app` for `app-feat-x` or for `workspaces/app/feat-x`); then, for OpenCode sessions, the project directory that OpenCode recorded for the session's project, read without writing to OpenCode's database. When no candidate exists, the page SHALL show no suggestion and SHALL let the user type a target or leave the directory unmapped.

#### Scenario: Accepting a suggested target

- **WHEN** Pi sessions are recorded in `/Users/me/code/app-feat-x`, which no longer exists, and `/Users/me/code/app` is a Git repository
- **THEN** the page SHALL suggest `/Users/me/code/app`
- **AND** accepting it and saving SHALL add the map to `importPathMaps`

#### Scenario: No candidate exists

- **WHEN** sessions are recorded in a temporary directory that no longer exists and no candidate is found
- **THEN** the page SHALL show the directory with no suggestion
- **AND** its sessions SHALL stay unresolved unless the user types a target

#### Scenario: Removing a map

- **WHEN** the user removes a saved map and saves
- **THEN** `importPathMaps` SHALL no longer contain it
- **AND** memories already imported through it SHALL remain

### Requirement: Directory maps are grouped by host

The Directory maps section SHALL list the saved maps once, above the host cards, and SHALL say that saved maps apply to every host. It SHALL then show one inner card for each host: Pi, OpenCode, and Claude Code. Each card SHALL list that host's unresolved directories with the number of sessions in each. A card with nothing to list SHALL say so in one line.

#### Scenario: Unresolved directories on two hosts

- **WHEN** Pi has 3 unresolved directories and Claude Code has 5
- **THEN** the Pi card SHALL list 3 directories, the Claude Code card SHALL list 5, and the OpenCode card SHALL say it has none

### Requirement: Unresolved counts agree across the page

The number of unresolved sessions on a host's import card and the directories in that host's Directory maps card SHALL come from the same latest full run or preview for that host. A session listing for one project SHALL NOT replace the host's list. Sessions that recorded no directory SHALL be counted and shown as one entry, **No directory recorded**, that cannot be mapped.

#### Scenario: Card and list match

- **WHEN** the latest Claude Code run found 27 unresolved sessions in 9 directories, and 2 sessions with no directory
- **THEN** the Claude Code import card SHALL show 27 unresolved sessions
- **AND** the Claude Code Directory maps card SHALL list 9 directories and one No directory recorded entry, with session counts that add up to 27

#### Scenario: Listing one project's sessions

- **WHEN** the user lists sessions for the current project only after a full run
- **THEN** the Directory maps card SHALL still show the full run's unresolved directories

### Requirement: Smart resolve fills in suggested targets

Each host card in the Directory maps section SHALL have a **Smart resolve directories** button, with a short description: it finds the project each missing directory belongs to, mostly the main repository of a deleted worktree, and fills in the suggestion for review. Pressing it SHALL fill the target of every unresolved directory that has a suggestion, using the suggestion rules of the Directory maps requirement, and SHALL leave directories with no suggestion empty. It SHALL NOT save. The page SHALL show how many directories it filled and how many it could not, and the user SHALL review, edit, or clear any target before pressing Save maps.

#### Scenario: Resolving deleted worktrees

- **WHEN** the Pi card lists `/code/app-feat-x` and `/code/app-feat-y`, `/code/app` is a Git repository, and `/tmp/scratch` has no candidate
- **THEN** pressing Smart resolve directories SHALL fill `/code/app` for both worktree directories and leave `/tmp/scratch` empty
- **AND** the page SHALL say it filled 2 and could not fill 1
- **AND** `importPathMaps` SHALL be unchanged until the user presses Save maps
