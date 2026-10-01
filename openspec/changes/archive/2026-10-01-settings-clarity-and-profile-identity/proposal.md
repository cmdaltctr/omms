# Proposal

## Why

The User Profile page showed "No profile found" while the store held a profile with 185 preferences. The login web app runs with `/` as its working directory, and the git trust check refuses every `git` binary there, so the server looked up the profile of user `unknown`. A repository with its own git email also split one person into two profiles, and the page gives no way to see or fix that. The Settings page has several sections that are hard to read: a key list that is not a table, diagnostics rows with a `—` model and unexplained columns, import cards with no plain "done" status, and directory maps that disagree with the import cards.

## What Changes

- The web app finds the user's email when it runs outside a project. Order: `userEmailOverride`, the git email of the working directory, the global git email, then the only active profile when exactly one exists.
- Fix the git trust check: a directory with no project marker above it has no untrusted root, so `git` on `PATH` is allowed.
- New **Profiles** card on the Settings page. It appears when more than one active profile exists. It lists each profile with its email, item counts, and last update. The user can choose which profile is theirs (saves `userEmailOverride`) or merge one profile into another (the source profile is turned off, not deleted).
- The profile API stops sending each item's embedding vectors (`centroid`, `anchor`) to the browser. The payload drops from about 15 MB to under 1 MB. Edits from the page keep the stored vectors.
- **Keys and access** becomes a table with column headings, in the same style as the other tables on the page.
- **Capture diagnostics**: the outcomes table shows one row for each host (OpenCode, Pi, Claude Code), each with a control to show its models. A row with no recorded model says "model not recorded" in place of `—`. A note explains Saved, Skipped, Failed, and Total.
- **Import and backfill**: each host gets a status badge, for example "Imported ✅", "Running", "Partly imported (27 unresolved)", or "Not started".
- **Automatic import**: the progress bar shows only while a run is active. After a run, the card shows a short summary of the last run with its finish time and counts.
- After the last exchange, an import learns the profile in batches of 50 prompts. Its record stays `running` at 100% during that step, so the bar looks stuck at full. The record and the page now show this step as **Learning profile**, with its batch count.
- Profile page: the confidence circle becomes a small rectangular badge, coloured green, blue, orange, or red by band.
- Pi backfill in the login web app: load Pi's SDK from Pi's own install, so the run finishes and the unresolved counts agree.
- **Directory maps**: each host gets its own inner card. The unresolved list uses the same source as the import cards, so the counts agree. A **Smart resolve directories** button fills in a suggested target for every unresolved directory that has one. The user reviews the suggestions and then presses Save.

## Capabilities

### New Capabilities

- `profile-identity`: how OMMS decides which profile belongs to the user, and how the user picks or merges profiles when more than one exists.

### Modified Capabilities

- `web-settings`: Keys and access card layout, capture diagnostics grouping and labels, import status badges, automatic import last-run summary.
- `import-directory-maps`: per-host cards, one data source for unresolved directories, and the Smart resolve action.
- `import-progress`: the progress bar shows only during an active run.
- `pi-session-history-backfill`: Pi's SDK is found outside Pi.

## Impact

- Server: `src/services/tags.ts` (trust check, global email fallback), `src/services/api-handlers.ts` (profile payload, profile list and merge), `src/services/web-server.ts` (new routes), capture diagnostics aggregation, backfill state for unresolved directories.
- Web: Settings sections for keys, diagnostics, import, automatic import, directory maps, and a new Profiles card; `ProfileView` edit path; i18n strings for every language file.
- Config: no new keys. The Profiles card writes the existing `userEmailOverride`.
- Docs: `docs/web-ui-settings.md`, `docs/web-ui.md`, `docs/configuration.md`.
- Pi: the login web app could not load Pi's SDK, so every Pi backfill from it failed. OMMS now loads the SDK from Pi's own install when its folder has none (TDR-021).
