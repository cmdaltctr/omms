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

### Requirement: Unresolved counts agree across the page

The number of unresolved sessions on a host's import card and the directories in the host's Directory maps card SHALL come from the same latest full run or preview for that host, after removing directories in `importIgnoredDirectories`. A session listing for one project SHALL NOT replace a host's list. Sessions recorded with no directory SHALL be counted and shown as one entry, **No directory recorded**, which cannot be mapped or ignored.

#### Scenario: Card and list match

- **WHEN** the latest Claude Code run found 27 unresolved sessions in 9 directories, and 2 sessions with no directory
- **THEN** the Claude Code import card SHALL show 27 unresolved sessions
- **AND** the Claude Code Directory maps card SHALL list 9 directories and one No directory recorded entry, whose session counts add up to 27

#### Scenario: Card and list match after ignoring

- **WHEN** the latest Pi run found 10 unresolved sessions and the user ignores a directory with 6 of them
- **THEN** the Pi import card and the Pi Directory maps card SHALL both show 4 unresolved sessions

#### Scenario: Listing one project's sessions

- **WHEN** the user lists sessions for the current project only after a full run
- **THEN** the Directory maps card SHALL still show the full run's unresolved directories

### Requirement: Smart resolve fills in suggested targets

Each host card SHALL offer **Smart resolve directories** at the top of its expanded list, with a description of its review-and-confirm flow. Smart resolve SHALL be the only way to save maps for unresolved directories. Pressing it SHALL open a dialog for that host with three parts: proposed source-to-target maps with session counts and each map's confidence; a **Suggested to ignore** group with each directory's reason and session count; and the rows left without a target. Edited targets SHALL win over suggestions and count as exact. Each map and each ignore proposal SHALL have its own checkbox. When the dialog opens, exact and name maps and every ignore proposal SHALL be ticked, and guess maps SHALL be unticked. Opening the dialog SHALL change neither the config nor page drafts. The user SHALL change the ticks and press Confirm to save the ticked items, or press Cancel to leave everything unchanged.

#### Scenario: Resolving deleted worktrees

- **WHEN** the Pi card lists `/code/app-feat-x` and `/code/app-feat-y`, `/code/app` is a Git repository, and `/tmp/scratch` is a temporary folder
- **THEN** Smart resolve SHALL open a dialog showing `/code/app` as the ticked target for both worktree directories
- **AND** it SHALL show `/tmp/scratch` ticked under Suggested to ignore, with the temporary-folder reason
- **AND** `importPathMaps`, `importIgnoredDirectories`, and page drafts SHALL remain unchanged until Confirm

#### Scenario: Keeping an edited target

- **WHEN** the user has edited a directory's target before opening Smart resolve
- **THEN** the dialog SHALL show the edited target rather than replacing it with a suggestion
- **AND** an explicitly cleared target SHALL remain unmapped

#### Scenario: A guess starts unticked

- **WHEN** the dialog proposes a map with guess confidence
- **THEN** the map SHALL show the label Guess and start unticked
- **AND** pressing Confirm without ticking it SHALL NOT save it

#### Scenario: Unticking a proposed map

- **WHEN** the dialog proposes three ticked maps and the user unticks one and presses Confirm
- **THEN** only the two ticked maps SHALL be saved
- **AND** the unticked row SHALL stay in the host list with its target text

### Requirement: Directory lists have compact expandable controls

Each host's Directory maps card SHALL initially collapse its unresolved rows. Its keyboard-accessible summary SHALL show the host, the directory count, the unresolved session count, and the number of rows that have a target. Expanding a host SHALL show Smart resolve above compact rows, each with an individually expandable target control and an Ignore action. Collapsing a host or row SHALL retain unsaved targets. The page SHALL NOT show a per-row selection checkbox or a section-wide Save maps button.

Host-specific unresolved-directory links SHALL reveal the matching host's disclosure, scroll its summary into view, and move focus to that summary. Navigation SHALL preserve all draft targets, SHALL leave other hosts' disclosure states unchanged, and SHALL NOT automatically expand individual target editors. It SHALL NOT save settings or start any import.

#### Scenario: Reviewing many missing folders

- **WHEN** the page contains unresolved directories for Pi, OpenCode, and Claude Code
- **THEN** each host list SHALL initially be collapsed
- **AND** expanding Pi SHALL reveal its rows without expanding other hosts

#### Scenario: Keeping edits during collapse

- **WHEN** the user edits a target and collapses then expands its row or host
- **THEN** the edited target SHALL remain unchanged

#### Scenario: Navigating to a host with unsaved edits

- **WHEN** the user has unsaved targets and follows a Claude Code unresolved-directory link
- **THEN** the Claude Code disclosure SHALL open with focus on its summary
- **AND** all unsaved targets SHALL remain unchanged
- **AND** other hosts and individual target editors SHALL keep their previous disclosure states

#### Scenario: Following the same host link again

- **WHEN** the user follows Pi's unresolved-directory link, collapses Pi's list, and follows the same link again
- **THEN** Pi's list SHALL open again and its summary SHALL receive focus

#### Scenario: A count no longer has matching rows

- **WHEN** the user follows a host's unresolved-directory link and the latest Directory maps list for that host is empty
- **THEN** the page SHALL reveal the host's empty-state message and focus its summary
- **AND** it SHALL NOT choose a different host or invent directory rows

### Requirement: Suggestion actions explain when no work is done

The Smart resolve dialog SHALL report the proposed maps, the ignore proposals, and the rows without targets. When it has neither a map nor an ignore proposal, it SHALL disable Confirm and SHALL say how to proceed: type a target in the row, or press Ignore for rows that are not projects. When every item is unticked, it SHALL disable Confirm. Confirmation success SHALL report the number of saved maps and ignored directories and say that they apply to the next import or backfill run. It SHALL NOT claim sessions were imported or folders recreated.

#### Scenario: No suggested targets exist

- **WHEN** the user presses Smart resolve and no row has a suggested or edited non-empty target or an ignore proposal
- **THEN** the dialog SHALL say there is nothing to save and disable Confirm
- **AND** it SHALL tell the user to type a target in the row or ignore rows that are not projects

#### Scenario: Suggestions are already selected

- **WHEN** a row already shows a suggested or edited target and the user presses Smart resolve
- **THEN** the dialog SHALL show that row's map, ticked unless it is a guess
- **AND** Confirm SHALL save it with no further save step

#### Scenario: Everything unticked

- **WHEN** the user unticks every map and every ignore proposal
- **THEN** Confirm SHALL be disabled

### Requirement: Confirmation saves only reviewed maps

Confirm SHALL save the ticked maps to `importPathMaps` and the ticked ignore proposals to `importIgnoredDirectories` in one settings save, with the same validation and revision checks as other settings saves. It SHALL retain existing saved maps and ignored directories, and leave unrelated target edits and pending saved-map removals unchanged. A shared source SHALL have one global mapping. Confirmation SHALL NOT start an import or change history files.

#### Scenario: Saving reviewed mappings

- **WHEN** the user confirms a dialog containing valid ticked maps and ticked ignore proposals
- **THEN** the maps SHALL be saved in global `importPathMaps` and the ignored directories in global `importIgnoredDirectories`, in one save
- **AND** the page SHALL refresh saved maps, ignored directories, and unresolved rows without importing any sessions

#### Scenario: Keeping unrelated drafts

- **WHEN** the user confirms Pi maps while an unrelated OpenCode target edit and a saved-map removal are pending
- **THEN** only the reviewed Pi items SHALL be saved
- **AND** the unrelated target edit and pending removal SHALL remain unsaved and visible

#### Scenario: Sharing a source across hosts

- **WHEN** a confirmed source directory appears in more than one host's list
- **THEN** its confirmed global map SHALL apply to every host
- **AND** refreshing SHALL NOT create duplicate saved maps for that source

### Requirement: Review remains safe on cancellation or failure

Cancel, Escape, and closing the dialog before confirmation SHALL change nothing. While saving, the page SHALL prevent duplicate submissions. A rejected save SHALL retain the reviewed items, their ticks, and unrelated drafts, show an accessible error, and require another explicit confirmation. A failed refresh after a successful save SHALL be reported separately without claiming the save failed.

#### Scenario: Cancelling review

- **WHEN** the user opens Smart resolve and cancels, presses Escape, or closes the dialog without confirming
- **THEN** saved maps, ignored directories, pending removals, and edited targets SHALL remain unchanged

#### Scenario: A save fails or settings changed elsewhere

- **WHEN** the save is rejected, including because the settings revision changed
- **THEN** the dialog SHALL remain available with its reviewed items and error
- **AND** it SHALL NOT overwrite newer settings or silently resubmit

#### Scenario: Confirm is pressed twice

- **WHEN** a confirmation save is pending and the user activates Confirm again
- **THEN** only one save request SHALL be submitted

#### Scenario: Refresh fails after saving

- **WHEN** the save succeeds but reloading the directory list fails
- **THEN** feedback SHALL say the items were saved and the list could not be refreshed
- **AND** the page SHALL offer a refresh without resubmitting the completed save

### Requirement: Every host has an accessible mapping review

Pi, OpenCode, and Claude Code SHALL use the same review-and-confirm flow. The dialog SHALL have a translated title and actions, trap keyboard focus, return focus on close, and keep long lists and paths usable at narrow widths and 200% zoom. It SHALL show paths and counts only, without conversation content.

#### Scenario: Reviewing each host

- **WHEN** the user opens Smart resolve for Pi, OpenCode, or Claude Code
- **THEN** the dialog SHALL show only the chosen host's proposed maps and explain that saved maps apply globally
- **AND** each host SHALL have the same confirmation, cancellation, and error behaviour

#### Scenario: Keyboard and translated review

- **WHEN** the dialog is used by keyboard in English, Chinese, or Arabic
- **THEN** its title and actions SHALL be translated and reachable without focus leaving the dialog
- **AND** long technical paths SHALL remain readable left-to-right, with focus returned to the opener after closing

### Requirement: Users can ignore directories that are not projects

Each unresolved directory row with a recorded source directory SHALL offer **Ignore**. Ignore SHALL save the source directory at once to the global `importIgnoredDirectories` list, with the same validation and revision checks as other settings saves. A ticked ignore proposal confirmed in the Smart resolve dialog SHALL be saved to the same list. `importIgnoredDirectories` SHALL be read from the global config only, SHALL accept absolute paths after `~` expansion, and SHALL reject invalid entries with the same startup validation as other settings. An ignored directory SHALL leave every host list and SHALL NOT count as unresolved on the page. The page SHALL list ignored directories in a collapsed **Ignored directories** disclosure with a count. Each entry SHALL offer **Restore**, which removes it from `importIgnoredDirectories` and returns the directory to the host lists that report it. Ignore and Restore SHALL NOT change `importPathMaps`, the import ledger, or history files, and SHALL NOT start an import. The **No directory recorded** entry SHALL NOT offer Ignore.

#### Scenario: Ignoring a temporary folder

- **WHEN** the Pi list shows `/private/tmp/pi-verify-repo` with 6 sessions and the user presses Ignore
- **THEN** the global config SHALL have `/private/tmp/pi-verify-repo` in `importIgnoredDirectories`
- **AND** the Pi list SHALL no longer show it
- **AND** the Pi unresolved session count SHALL drop by 6

#### Scenario: Restoring an ignored directory

- **WHEN** the user opens Ignored directories and presses Restore for `/private/tmp/pi-verify-repo`
- **THEN** the directory SHALL leave `importIgnoredDirectories`
- **AND** it SHALL appear again in each host list whose latest run reported it

#### Scenario: Ignoring does not import or map

- **WHEN** the user ignores a directory
- **THEN** its sessions SHALL stay unimported
- **AND** the next import SHALL still report them unresolved to the importer

#### Scenario: Ignore fails to save

- **WHEN** the save is rejected, including because settings changed elsewhere
- **THEN** the row SHALL stay in the list
- **AND** the page SHALL show an accessible error and SHALL NOT retry by itself

### Requirement: Saved maps stay after their sessions import

Saved maps SHALL keep applying after their sessions import, because every host resolves a session's directory before it checks the import ledger. The page SHALL say, next to the saved maps, that a map should stay after import and that removing it makes its sessions unresolved again on the next run.

#### Scenario: Removing a used map

- **WHEN** a saved map's sessions are already imported and the user removes the map and saves the removal
- **THEN** the next full run SHALL report those sessions unresolved again
- **AND** memories already imported through that map SHALL remain

### Requirement: Suggestions follow known projects, moves, and renames

Each suggestion SHALL be either a map to an existing target directory or an ignore proposal. Each map suggestion SHALL carry a confidence: **exact**, **name**, or **guess**. For a missing directory, the page SHALL apply these rules in order and use the first that gives a result:

1. **Not a project**: a directory inside a system temporary folder (`/tmp`, `/private/tmp`, `/private/var/folders`, or the operating system's temporary folder), with a `node_modules` part in its path, inside `~/Library/Application Support`, or inside a skills folder (`~/.agents/skills`, or `skills` in Claude Code's folder: the `claudeConfigDir` setting, then `CLAUDE_CONFIG_DIR`, then `~/.claude`) SHALL get an ignore proposal with a reason.
2. **Same remote**: when the memory store records the missing directory as a path of a project whose stored git remote equals the stored git remote of exactly one existing known project, the page SHALL suggest that project with exact confidence.
3. **OpenCode record**: for OpenCode sessions, the project folder OpenCode recorded for the session's project, read without writing OpenCode's database, SHALL be suggested with exact confidence when it exists. When it does not exist, the page SHALL apply rules 2 to 6 to that recorded folder, and SHALL use the result with that rule's confidence.
4. **Deleted worktree**: the existing directory whose name is the longest leading part of the missing directory's name or of one of its parent directories' names (for example `app` for `app-feat-x` or for `workspaces/app/feat-x`) SHALL be suggested with name confidence. When that candidate is a linked Git worktree, the page SHALL suggest its main working tree instead.
5. **Moved folder**: when exactly one existing known project has the same folder name as the missing directory, it SHALL be suggested with name confidence. When more than one has that name, this rule SHALL give no suggestion.
6. **Rename guess**: when exactly one existing project directory beside the missing directory or beside a known project has a name whose parts each match, in order, either one part of the missing name or the initials of consecutive parts, with at least two parts matching exactly, it SHALL be suggested with guess confidence.

Known projects SHALL include existing project directories recorded in the memory store, saved map targets, and OpenCode's recorded project folders. The page SHALL read them without writing to the store, OpenCode's database, or Git, and SHALL NOT make network requests. When no rule gives a result, the page SHALL show no suggestion.

#### Scenario: A live linked worktree is not a target

- **WHEN** `/code/app` is a Git repository, `/code/app-feat-x` is its live linked worktree, and sessions were recorded in the deleted `/code/app-feat-x-2`
- **THEN** the page SHALL suggest `/code/app` with name confidence

#### Scenario: A moved repository

- **WHEN** sessions were recorded in the deleted `/clients/shop-2025` and the memory store records an existing project at `/projects/templates/shop-2025`
- **THEN** the page SHALL suggest `/projects/templates/shop-2025` with name confidence

#### Scenario: Two projects with the same folder name

- **WHEN** two existing known projects are named `shop-2025` and no earlier rule gives a result
- **THEN** the page SHALL show no suggestion for `/clients/shop-2025`

#### Scenario: OpenCode's recorded folder is also missing

- **WHEN** OpenCode sessions were recorded in a deleted OpenCode worktree folder, OpenCode records the project folder `/clients/team/shop-2025`, which is also missing, and the store records an existing project at `/projects/templates/shop-2025`
- **THEN** the page SHALL suggest `/projects/templates/shop-2025` with name confidence

#### Scenario: Same stored remote

- **WHEN** the memory store records `/old/tool` and the existing `/new/tool-renamed` with the same git remote
- **THEN** the page SHALL suggest `/new/tool-renamed` for `/old/tool` with exact confidence

#### Scenario: A renamed repository

- **WHEN** sessions were recorded in the deleted `/ext/opinionated-modular-pi-subagents-system-ompss` and `/ext/om-pi-subagents` is the only matching Git repository
- **THEN** the page SHALL suggest `/ext/om-pi-subagents` with guess confidence

#### Scenario: A folder that is not a project

- **WHEN** sessions were recorded in `~/.pi/agent/npm/node_modules/pi-mcp-adapter`
- **THEN** the page SHALL propose ignoring it, with a reason that names the `node_modules` folder
- **AND** it SHALL NOT suggest a map for it

#### Scenario: Suggestions never write

- **WHEN** the page builds suggestions
- **THEN** the memory store, OpenCode's database, Git metadata, and history files SHALL be unchanged

#### Scenario: Skills in a moved Claude Code folder

- **WHEN** `claudeConfigDir` is `~/.claude-work` and sessions were recorded in `~/.claude-work/skills/s-x`
- **THEN** the page SHALL propose ignoring it, with a reason that names the skills folder
