# Spec Delta

## ADDED Requirements

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
