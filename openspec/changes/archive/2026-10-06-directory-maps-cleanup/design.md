## Context

Measured on the live page (OMMS 4.8.0, 5 October 2026):

| Part                     | Height                     | Notes                             |
| ------------------------ | -------------------------- | --------------------------------- |
| Directory maps section   | 3,863 px                   | Viewport is 763 px                |
| Saved maps list          | 3,388 px                   | 34 rows; long paths wrap          |
| Save maps button         | 3,810 px below the heading | 6,072 px with all host lists open |
| Automatic import section | 1,180 px                   | Three host cards, always open     |

The page has two save paths today. Path one is the row checkbox, then Select all or Clear, then the bottom Save maps. Path two is Smart resolve, then the dialog, then Confirm. Path one's button is out of sight. Path two dead-ends when no row has a target.

All three hosts call `resolveImportProject` before the ledger lookup (`src/importer/importer.ts:526`, `opencode-import.ts:101`, `claude-reader.ts:328`). A saved map therefore stays necessary after import.

Project identity is the Git common directory (`getGitProjectIdentity` in `src/services/tags.ts`). A live linked worktree and its main repository share one project tag. A renamed or moved repository gets a new tag.

### Suggestions on the 22 live unresolved rows

Today `suggestMapTarget` suggests a target for 9 rows. A probe of the live data found these causes for the other 13:

| Row (shortened)                                               | Today | Cause                                                         | After this change         |
| ------------------------------------------------------------- | ----- | ------------------------------------------------------------- | ------------------------- |
| `/private/tmp/pi-verify-repo`                                 | none  | Not a project                                                 | Ignore (temporary folder) |
| `~/.pi/agent/npm/node_modules/pi-mcp-adapter`                 | none  | Not a project                                                 | Ignore (`node_modules`)   |
| `~/.agents/skills/s-pi-agent-build`                           | none  | Not a project                                                 | Ignore (skills folder)    |
| `~/.agents/skills/s-skill-creator-enhanced`                   | none  | Not a project                                                 | Ignore (skills folder)    |
| `~/Library/Application Support/Open Design/…`                 | none  | Not a project                                                 | Ignore (app data)         |
| `/private/tmp/oc-mem-phase1/project`                          | none  | Not a project                                                 | Ignore (temporary folder) |
| `/private/var/folders/…/od-conn-test-…`                       | none  | Not a project                                                 | Ignore (temporary folder) |
| `/private/tmp/claude-501/…/scratchpad/jevtest`                | none  | Not a project                                                 | Ignore (temporary folder) |
| `CLIENTS/restro-1-2025`                                       | none  | Moved to `PROJECTS/praxis-vue-template/restro-1-2025`         | Map, name                 |
| `~/.local/share/opencode/worktree/72a8e1ab…/feat-google-…`    | none  | OpenCode records `CLIENTS/Jalan2Bola/restro-1-2025`, now gone | Map via that record, name |
| `pi-extensions/opinionated-modular-pi-subagents-system-ompss` | none  | Renamed to `om-pi-subagents`                                  | Map, guess                |
| `pi-extensions/opinionated-modular-pi-todo-system-ompts`      | none  | Renamed to `om-pi-todo`                                       | Map, guess                |
| `pi-extensions/ompts-todo`                                    | none  | Renamed; stored remote `ompts-todo.git` matches no live repo  | none (manual)             |

Result: 13 maps (2 guesses), 8 ignore proposals, 1 manual row.

The probe also showed the linked-worktree fault. `suggestMapTarget` returned the live worktree `llamaindex-rag-mcp-feat-modular-ocr-workers-dots-mocr` for a deleted `…-dots-mocr-2`, and did the same for `om-pi-subagents-feat-add-agent-tree-viewer` and `omms-feat-directory-maps-cleanup`. `isProject` accepts a `.git` file, and the longest name wins.

The web server calls `directoryMapsView()` with no `knownProjects`. The memory store's project list (`ShardInventoryService.listShards`, with `projectPath`, `projectPathCandidates`, and `gitRepoUrl`) is unused. No deleted worktree left Git metadata (`.git/worktrees/*/gitdir`), so that is not a usable signal.

## Goals / Non-Goals

**Goals:**

- One save path for unresolved directories, with its action next to the rows.
- A way to dismiss rows that are not projects, and to undo that.
- Suggestions for moved and renamed repositories, and for deleted worktrees of live worktrees.
- A clear confidence on each suggestion, so guesses need an explicit tick.
- Saved maps take one line until the user opens them.
- Automatic import host cards take one line each until opened.
- Counts on every card agree after ignoring.

**Non-Goals:**

- Pattern or prefix maps (one rule for `omms-feat-*`). This would cut the saved list, but it changes import resolution for every host. It needs its own change.
- Pruning used maps. They are still needed, as the Context section shows.
- Network lookups, such as following GitHub rename redirects.
- Decoding Claude Code scratchpad paths back to a project.
- Changing the Import and backfill section layout.
- Making the importer skip ignored directories. Ignore is a display decision only.

## Decisions

### D1. Smart resolve is the only save path; ticks move into the dialog

Remove the row checkbox, Select all with targets, Clear selection, and the bottom Save maps. The dialog shows a checkbox per proposed map and per ignore proposal. Confirm saves the ticked items.

Why: the selection and its action now sit in the same place. The row keeps only its target field, which Smart resolve already reads.

Alternative: keep the checkboxes and repeat Save maps inside each host card. Rejected, because it keeps two paths that do the same thing.

Code: `MapDecision.accepted` and `selectWithTargets`/`clearSelection`/`applySuggestions` go. Decisions keep only `target` text. `reviewDirectoryMaps` returns maps (with confidence), ignore proposals, and unmapped rows. `DirectoryMapReviewDialog` holds the tick state locally, set from D8's defaults each time it opens. `confirmedMapsToSave` receives only ticked maps. `mapsToSave` in `external-api-settings.ts` keeps only the removal path for Save removals.

### D2. Ignore persists in a new global setting, `importIgnoredDirectories`

A list of absolute paths, read from the global config only, like `importPathMaps`. Ignore and Restore each send one settings PATCH with the revision check, and the page reloads the maps view afterwards. Confirm in the dialog writes `importPathMaps` and `importIgnoredDirectories` in one PATCH.

Why a setting and not a ledger table: the setting is visible in `omms.jsonc`, survives a ledger reset, and reuses the existing safe-save and snapshot code.

Code:

- `src/config.ts`: add `importIgnoredDirectories: string[]` (default `[]`). Parse it with a new `parseIgnoredDirectories` in `src/importer/import-path-maps.ts`, which reuses `expandHome`, the absolute-path check, and `resolve`. Strip it from project overrides next to `importPathMaps`.
- `global-config-writer.ts` and `settings-snapshot.ts`: add the key wherever `importPathMaps` appears, with array validation.
- `directoryMapsView` (`map-suggestions.ts`): filter ignored directories out of each host list, the same way it filters saved sources, and return `ignored: string[]`. Read with `CONFIG.importIgnoredDirectories ?? []`, because tests stub `config.js`.

### D3. The server subtracts ignored sessions from `counts.unresolved`

In the `GET /api/settings/backfill` handler, for each host, read the stored unresolved list (`readUnresolvedDirectories`) and subtract the sessions of ignored directories from `counts.unresolved`. Clamp the result at 0. Put the arithmetic in a pure function in `backfill-state.ts` that takes the ignored list as an argument, so it is testable without `CONFIG`.

Why at read time: an Ignore click must change the badge at once. Runs in Pi and OpenCode processes record counts with their own config snapshot, so a record-time filter would lag until the next run.

The stored list is capped at `MAX_UNRESOLVED_DIRECTORIES`. A directory past the cap is not shown, so the user cannot ignore it, and the subtraction never removes more than the list holds.

### D4. Saved maps: one disclosure, grouped by target

`<details>` for Saved maps, collapsed, with a count in the summary. Inside, group by `to` (sorted by map count, then path). Each group is a nested `<details>` whose summary shows the target and count. Each map row shows only the source path and Remove. A Save removals button sits at the top of the disclosure, disabled until a removal is pending. The keep-after-import note sits under the summary.

This matches the existing `DirectoryMapHost` disclosure pattern, so no new UI primitive is needed.

### D5. Automatic import host cards become disclosures

Wrap each host card in `<details>`. The summary holds the existing `h3` and a one-line status: state, pending, unresolved. Track open state per host in component state. Initialise it once from the first status load: open if the run is running or paused. After that, only the user changes it. Polling must not re-open or close a card.

The unresolved link inside the card stays. The summary shows the count as text only, because a link inside `<summary>` toggles the disclosure.

### D6. Empty-dialog text

When the dialog has no map and no ignore proposal, it shows: "Nothing to save. Type a target in the row, or press Ignore for folders that are not projects." Add English, Chinese, and Arabic strings in `web/src/lib/i18n/settings.ts`. Remove strings that no longer appear.

### D7. Suggestion engine

`suggestMapTarget` returns `{ kind: "map", target, confidence } | { kind: "ignore", reason } | null`, where `confidence` is `"exact" | "name" | "guess"` and `reason` is `"temporary" | "node_modules" | "app-data" | "skills"`. The web view passes this through; the host row shows the target or the reason.

Rules run in order; the first result wins:

1. **Not a project** → ignore. Pure path checks: under `/tmp`, `/private/tmp`, `/private/var/folders`, or `os.tmpdir()`; a `node_modules` path part; under `~/Library/Application Support`; under `~/.agents/skills` or `~/.claude/skills`. It runs first, because these folders never hold a project worth mapping, and the name rules could pick a wrong sibling inside them.
2. **Same remote** → exact. From the store inventory: find the group whose `projectPathCandidates` contain the missing path. Take its `gitRepoUrl`. Suggest the one other group whose `projectPath` exists and has the same remote. Two or more candidates give no result.
3. **OpenCode record** → exact when the recorded folder exists. When it is missing, run rules 2 to 6 on that folder and keep that rule's confidence. Recursion depth is one.
4. **Deleted worktree** (today's rule) → name. New step: when a candidate's `.git` is a file, read its `gitdir:` line. When the path contains `/.git/worktrees/`, take the folder before `/.git` as the main working tree. That folder must exist and pass `isProject`. Otherwise, drop the candidate. No `git` process is started.
5. **Moved folder** → name. Among existing known projects, those whose base name equals the missing directory's base name. Exactly one gives a result.
6. **Rename guess** → guess. Split names on `-`, `_`, and `.`. For each candidate project in the search roots, every candidate part must match, in order, either one missing-name part exactly or the initials of two or more consecutive missing-name parts. At least two parts must match exactly. Exactly one candidate gives a result.

Known projects are the union of: the store inventory's existing `projectPath` and `projectPathCandidates` values, saved map targets, and OpenCode's recorded project folders. `directoryMapsView` gets them from one `listShards` call per request. If the store read fails, it continues with the other sources. The folder-listing cache stays per request.

Why this order: the not-a-project check is the cheapest and the safest. Exact signals come next. Name rules follow, then the guess, which is unticked by default.

Alternative: run `git remote get-url` on every candidate. Rejected, because it starts a process per folder, and the store already holds the remotes.

### D8. Dialog groups and default ticks

The dialog shows three groups: **Proposed maps** (with a confidence label: Exact, Name match, or Guess), **Suggested to ignore** (with the reason), and **No target** (no checkbox). An edited target counts as exact. Default ticks: exact, name, and ignore proposals ticked; guesses unticked. Confirm is enabled when at least one item is ticked. One PATCH writes both keys with one revision check.

## Risks / Trade-offs

- [Users who relied on Select all lose it] → Smart resolve ticks every exact and name map by default, which is the same result in one click.
- [A wrong rename guess] → Guesses start unticked and carry a Guess label.
- [The not-a-project rule hides a real project kept in a temporary folder] → The proposal is visible and can be unticked, and Restore undoes a confirmed ignore.
- [The store read slows the maps view] → One `listShards` call per request. A failure falls back to the other sources.
- [Ignore hides a directory the user later needs] → The Ignored directories disclosure lists every entry with Restore.
- [A new config key is missing in test stubs of `config.js`] → Read it with `?? []`, and keep the count logic and suggestion rules in pure functions that take their inputs as arguments.
- [Count drift between the card and the list] → Both read the same stored list and the same ignored setting. A test checks that they agree.
- [A link inside a summary] → Keep links out of `<summary>`.

## Migration Plan

No data migration. `importIgnoredDirectories` defaults to empty. Existing `importPathMaps` stay unchanged. Rollback: revert the change. An `importIgnoredDirectories` key left in `omms.jsonc` is then unknown and ignored by the older version, which reads config by named fields.

## Open Questions

None.
