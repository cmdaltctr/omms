# Design

## Context

Findings from the live store on 2026-10-01:

- The login web app runs with `/` as its working directory. `findUntrustedProjectRoot("/")` finds no project marker, so it returns `/` itself. Every `git` on `PATH` sits inside `/`, so `resolveTrustedGitCommand` returns `null`. `getGitEmail` then returns `null`, and `handleGetUserProfile` and `handleUpdateProfileItem` look up user `unknown` (`src/services/tags.ts:60-125`, `src/services/api-handlers.ts:911`, `:1347`).
- `~/Development/PROJECTS/pi-extensions/om-pi-todo` had a local git email, so Claude Code learning wrote to a second profile. The user's config now sets `userEmailOverride`, and the stray profile was merged and turned off by hand.
- The profile payload was 15.2 MB. Each item stores `centroid` and `anchor`, two 1024-number vectors. Page edits go through `PATCH /api/user-profile/item` with type and index, so the browser never sends vectors back.
- Diagnostics group by `host, provider, model` (`src/services/capture-attempt-store.ts:92`). A `—` row means both provider and model are null: the attempt failed before a provider set them (for example `no Pi model available`, or the stub provider in the Claude Code retry drain).
- Card unresolved count: `unresolvedProjects.length + unresolvableSessions.length` (`src/importer/auto-backfill.ts:48`). The Directory maps list reads `unresolved_directories`. Three writers replace that table, and one of them is the session listing for the current scope (`src/importer/import-sessions.ts:258`). The list drops entries with no directory (`src/services/backfill-state.ts:89`).
- `readImportRun` already reports a dead-process run as `stopped` (`src/importer/import-runs.ts:72`). An import keeps `state = running` with `done = total` during its profile step.

## Goals / Non-Goals

**Goals:**

- The profile page works from the login item with no project directory.
- The user can see and fix split profiles from the page.
- The settings sections the user named become readable without guessing.

**Non-Goals:**

- Session-level memory summaries.
- Changing how profile learning matches or merges items.

## Decisions

1. **Trust check.** `findUntrustedProjectRoot` returns `null` when no `.git` or marker exists above the directory, and `resolveTrustedGitCommand` skips the inside-root test for `null`. The check still blocks a `git` inside a cloned repository. Alternative: run `git` with `cwd: homedir()` in the web app. Rejected, because it hides the bug for other callers.
2. **One identity resolver for the web app.** Add `resolveProfileUserId()` in a new module `src/services/profile-identity.ts`. Order: `CONFIG.userEmailOverride`, git email of `process.cwd()`, `git config --global user.email`, and then the only active profile. `handleGetUserProfile`, `handleUpdateProfileItem`, refresh, and AI cleanup call it. It takes `CONFIG` as an argument, so test stubs of `src/config.ts` need no new export.
3. **Profile list and merge.** New routes: `GET /api/user-profiles`, `POST /api/user-profiles/use` (writes `userEmailOverride` through `global-config-writer`), `POST /api/user-profiles/merge` with `{ sourceId, targetId }`. The merge uses `userProfileManager.mergeProfileData` and `updateProfile`, then sets `is_active = 0` on the source. Add `deactivateProfile(id)` to the manager in place of raw SQL. The routes use the same origin and auth guard as other settings writes. This is the same procedure that was run by hand on 2026-10-01.
4. **Strip vectors in one place.** A pure `stripProfileVectors(data)` drops `centroid` and `anchor` from every item. The GET profile and snapshot handlers call it. The PATCH handler keeps reading the stored data, so vectors survive.
5. **Diagnostics grouping in the browser.** The server keeps returning per-model rows. The browser groups them by host and adds totals. This keeps the API stable and lets the host filter work as before. A `null` model renders as **model not recorded**. The column note is one muted paragraph above the table.
6. **Import status badge.** A pure `importStatusBadge(backfillStatus, run)` in `web/src/lib/auto-import-settings.ts` maps state to one of the badge labels in the spec. The section shows it next to each host title.
7. **Profile phase.** `import_runs` gains `phase TEXT` (`exchanges` | `profile`) and `profile_done`, `profile_total` integers, added by the same `ALTER TABLE ... ADD COLUMN` pattern used elsewhere. The runner sets `phase = profile` before the profile backlog loop and updates the counts after each batch. The page shows the profile phase in place of the bar. When no run is active, the page shows the last run summary from `import_runs` (finish time, surface, counts).
8. **One source for unresolved directories.** The card count was `unresolvedProjects.length + unresolvableSessions.length`, a number of directories plus a number of sessions. It becomes the number of sessions, the same total the listed entries add up to. Rows with no directory are stored under one fixed entry and shown as **No directory recorded**, which has no map input. A session listing already writes the full unresolved list whatever its project scope, so it keeps writing it. A run with one project's scope or a page selection sees only part of the history, so it no longer writes the list.
9. **Smart resolve in the browser.** The `GET /api/settings/import-maps` view already carries `suggestedTarget` for each directory. The button copies each suggestion into the row's input and reports filled and not-filled counts. No new server code. Save keeps its current path.
10. **Keys and access table.** Reuse the table class constants from `DiagnosticsSection.tsx`. Move them into `web/src/lib/components/settings/table-styles.ts`, because a third user now exists.

11. **Pi SDK lookup.** `src/importer/pi-sdk.ts` tries the normal import, then Pi's managed install, each `pi` on `PATH`, and Node's global packages. See TDR-021.
12. **Confidence badge.** A pure `confidenceLevel(percent)` in `web/src/lib/profile-utils.ts` maps the bands; the badge reads its colour from one class table.

## Risks / Trade-offs

- [The trust check now allows `git` from `PATH` in non-project directories.] → The check's purpose is to stop a repository from shipping its own `git` binary. A directory with no repository has nothing to protect. A test covers the repository case so it still blocks.
- [A merge cannot be undone from the page.] → The source profile stays stored and inactive, and the target gets a changelog entry, so a snapshot exists. The page asks for confirmation.
- [Stopping the session listing from writing `unresolved_directories` changes when the list refreshes.] → The list now refreshes only on full runs and previews. The section says which run the list comes from and when it ran.
- [Grouping in the browser needs every model row.] → The outcomes query has no limit today. This stays the same.
