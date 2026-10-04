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

### Requirement: Directory lists have compact expandable controls

Each host's Directory maps card SHALL initially collapse its unresolved rows. Its keyboard-accessible summary SHALL show the host, directory count, unresolved session count, and selected map count. Expanding a host SHALL show compact rows with individually expandable target controls. Collapsing a host or row SHALL retain unsaved targets and selections. Bulk actions and their results SHALL remain visible in the expanded host above the rows. Save maps SHALL remain accessible without expanding every row.

Host-specific unresolved-directory links SHALL reveal the matching host's disclosure, scroll its summary into view, and move focus to that summary. Navigation SHALL preserve all draft targets and selections, SHALL leave other hosts' disclosure states unchanged, and SHALL NOT automatically expand individual target editors. Existing general Directory maps anchors SHALL remain available. Repeating navigation to the same host after its disclosure was collapsed SHALL reveal it again. Navigation SHALL NOT save maps or start any import.

#### Scenario: Reviewing many missing folders

- **WHEN** the page contains unresolved directories for Pi, OpenCode, and Claude Code
- **THEN** each host list SHALL initially be collapsed
- **AND** expanding Pi SHALL reveal its rows without expanding the other hosts

#### Scenario: Keeping edits during collapse

- **WHEN** the user edits a target, selects its map, and collapses then expands the row or host
- **THEN** the edited target and selection SHALL remain unchanged

#### Scenario: Navigating to a host with unsaved edits

- **WHEN** the user has unsaved targets and selections and follows a Claude Code unresolved-directory link
- **THEN** the Claude Code disclosure SHALL open with focus on its summary
- **AND** all unsaved targets and selections SHALL remain unchanged
- **AND** other hosts and individual target editors SHALL keep their previous disclosure states

#### Scenario: Following the same host link again

- **WHEN** the user follows Pi's unresolved-directory link, collapses Pi's list, and follows the same link again
- **THEN** Pi's list SHALL open again and its summary SHALL receive focus

#### Scenario: A count no longer has matching rows

- **WHEN** the user follows a host's unresolved-directory link and its latest Directory maps list is empty
- **THEN** the page SHALL reveal that host's empty-state message and focus its summary
- **AND** it SHALL NOT choose a different host or invent directory rows

### Requirement: Users can select maps in bulk per host

Each expanded host SHALL offer Select all with targets and Clear selection. Select all with targets SHALL select rows with a recorded source directory and a non-empty target, using the edited target when present and otherwise the suggested target. It SHALL NOT invent targets, overwrite edits, or select sessions with no recorded directory. Clear selection SHALL deselect that host's rows without clearing target text. Neither action SHALL save config or start an import. Selection of a source shared across hosts SHALL be consistent with the single saved mapping for that source. Existing target validation and import resolution rules SHALL remain unchanged.

#### Scenario: Selecting available targets

- **WHEN** a host has a suggested target, a manually entered target, an empty target, and a No directory recorded entry
- **THEN** Select all with targets SHALL select only the suggested and manually entered targets
- **AND** config SHALL remain unchanged until Save maps

#### Scenario: Clearing selected maps

- **WHEN** the user presses Clear selection
- **THEN** the host's map selections SHALL be cleared while their target text remains

### Requirement: Suggestion actions explain when no work is done

Smart resolve SHALL display an accessible result beside its button with counts for newly selected suggestions, rows already selected, and mappable rows without suggestions. When no suggestion can be selected, it SHALL explain whether rows are already selected or need a manually chosen target. It SHALL preserve accepted choices and SHALL NOT save. The result SHALL direct the user to review selections and press Save maps when any maps are selected.

#### Scenario: No suggested targets exist

- **WHEN** the user presses Smart resolve and no mappable row has a suggestion
- **THEN** the visible result SHALL say that no suggested targets were selected
- **AND** it SHALL explain that the user must choose targets for rows without suggestions

#### Scenario: Suggestions are already selected

- **WHEN** the user presses Smart resolve after all suggested rows are selected
- **THEN** the result SHALL report the already selected rows and explain that Save maps is still required
