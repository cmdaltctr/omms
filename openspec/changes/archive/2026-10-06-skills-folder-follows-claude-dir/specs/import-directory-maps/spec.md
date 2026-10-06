## MODIFIED Requirements

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
