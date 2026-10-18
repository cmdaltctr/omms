## Context

See proposal.md for the problems.

Current state that the design depends on:

- `MemoryView.tsx` renders the seven sections from `MEMORY_SECTIONS` in one column. `AppSidebar.tsx` lists the same sections as Memory children. `legacyMemoryAnchor` maps old Settings anchors to `/memory#memory-section-*`.
- The router (`routes.ts`, `router.ts`) reads the path and the hash only, and drops a query string. The server already serves `index.html` for any GET path without an extension (`web-server.ts`, SPA fallback).
- `ImportSection.tsx` keeps one `ImportDraft` in React state. `initialImportDraft()` ticks Pi only, so every reload resets the host ticks.
- `unresolved_directories` in `import-ledger.db` has one row per host. `recordUnresolvedDirectories` replaces it on every write. A session listing writes it with the whole-source unresolved set; `matchImportSessions` finds unresolved sessions across the whole source in both scopes (OpenCode: 21 in Current project and in All projects). The automatic backfill then writes only the unresolved sessions before its cutoff and replaces the listing's result. On this machine that turned OpenCode's 21 into 0.
- `runSettingsHealth` (`src/importer/settings-health.ts`) already has a **Memory store** check (open `user-prompts.db`, `SELECT 1`) and an **Embedding** check (`embedWithTimeout("OMMS health check")`).
- The backfill controls (`backfill-controls.ts`) give `runNowUnavailableReason`. The import readiness (`import-types.ts` `Readiness`) tells whether each host's reader and default source exist.
- `web-server.ts` is 1,817 lines and has a ceiling entry of 1,818 in `tests/file-size-ceiling.test.ts`. `ImportSection.tsx` is 454 lines and `DirectoryMapsSection.tsx` is 432.
- The design system is the `omms-design` skill (OpenChamber look). Status tokens `--status-info`, `--status-warning`, `--status-success` and `--destructive` exist in `app.css`.

## Goals / Non-Goals

**Goals:**

- One place per host for its state, next action, sessions and settings, and one place for shared settings.
- Every unavailable action says why, and the page shows when memories cannot be saved.
- Avatars that look the same size whatever the user uploads.

**Non-Goals:**

- No change to import, backfill, capture or directory-map behaviour on the server, except the coverage rule for unresolved directories.
- No new visual style. The look stays OpenChamber via `omms-design`.
- No avatars outside the Memory page and sidebar.
- No log page work (the `add-log-levels` change owns it).
- No host registry. The three hosts stay a fixed list (see the known refactor in `CLAUDE.md`).

## Decisions

### Views are path segments, not query strings

`/memory/pi`, `/memory/opencode`, `/memory/claude-code` and `/memory/shared`. The router drops query strings today, while the server already serves the app shell for these paths. `routes.ts` gains a `memoryView` parser, and `AppView` stays `"memory"` so the sidebar and header logic stays as it is. A query string (`?view=`) would need router and history changes for no gain.

### Old anchors map to views in one table

`legacyMemoryAnchor` grows into one table that maps every old Settings anchor and every old `#memory-section-*` anchor to a view path plus an optional row anchor. Import and automatic import anchors go to the overview, because they name no host. `#directory-maps-<host>` goes to that host's view.

### Component split

| File                                                    | Holds                                                                  | Size target |
| ------------------------------------------------------- | ---------------------------------------------------------------------- | ----------- |
| `MemoryView.tsx`                                        | picks overview, host view or shared view from the path                 | < 80        |
| `MemoryOverview.tsx`                                    | four cards, Import all hosts                                           | < 200       |
| `HostCard.tsx`                                          | avatar, name, status line, warning, Change icon menu                   | < 200       |
| `HostView.tsx`                                          | switcher, health strip, status header, sessions, host settings         | < 250       |
| `HostStatusHeader.tsx`                                  | state, main action, explanation sentence                               | < 200       |
| `host-status.ts`                                        | pure function: run + backfill + readiness → state, label, sentence key | < 200       |
| `HostSessions.tsx`                                      | one host's session list and its needs-a-folder group                   | < 300       |
| `SharedView.tsx`                                        | the shared rows, reusing existing section components                   | < 150       |
| `HostAvatar.tsx`, `AvatarDialog.tsx`, `avatar-image.ts` | avatar render, dialogs, crop and resize                                | < 250 each  |
| `MultiHostImport.tsx`                                   | today's multi-host form, opened by Import all hosts                    | < 450       |

`ImportSection.tsx` splits into `MultiHostImport.tsx` and `HostSessions.tsx`; the host view uses `HostSessions` with one host. `DirectoryMapsSection.tsx` splits so the per-host unresolved rows move into `HostSessions` and the saved maps and ignored list move into the Shared view. Existing sections (`MemorySection`, `KeywordModeSection`, `RerankerSection`, `ProfileCatchUpSection`) are reused unchanged inside Shared rows.

### Status and main action come from one pure function

`host-status.ts` takes the host's `ImportRun`, backfill status, readiness and `runNowUnavailableReason`, and returns `{ state, action, sentence }`. The rules:

| Input                                      | State           | Action                                    | Sentence                          |
| ------------------------------------------ | --------------- | ----------------------------------------- | --------------------------------- |
| reader or source missing, no saved source  | not set up      | none                                      | setup note                        |
| run state `running`                        | running         | Pause                                     | progress, time left               |
| `paused` flag set                          | paused          | Resume (unavailable when a reason exists) | the reason, or when it was paused |
| last run `failed`                          | failed          | Retry                                     | the redacted failure code         |
| last run done or stopped with no work done | done            | Run now                                   | nothing waiting before the cutoff |
| otherwise                                  | done or stopped | Run now                                   | last run summary                  |

Keeping this pure makes every row of the table a unit test and keeps the components thin. The **Use external API** shortcut saves that host's backfill model as `external` through the existing backfill model save.

### Host choices persist in local storage

The multi-host form saves the ticked hosts and the scope to `localStorage` under `omms-memory-import-hosts`, read inside a `try`/`catch` and validated against the three host names. This is a per-browser convenience, which is what the spec asks for. The host views need no storage, because the path names the host.

### Unresolved directories record their coverage

`unresolved_directories` gains a `coverage` column, `full` or `partial`, with `full` as the value for existing rows. A session listing, a full run and a preview without `since`/`until` write `full`. An automatic backfill or an import with a date limit writes `partial`, and a `partial` write never replaces a `full` row. The upsert does this in SQL (`ON CONFLICT ... DO UPDATE ... WHERE unresolved_directories.coverage = 'partial' OR excluded.coverage = 'full'`), so two processes writing at once stay correct.

### Run now with nothing pending writes a finished record

Task 1.3 found why a pressed **Run now** looked like it did nothing. `scheduleAutoBackfill` returns after its dry run when no exchange is pending, before any `import_runs` record exists, so the page kept showing the previous run (for OpenCode a run stopped on 9 October, with a process id that no longer exists). A user-started run (`userStarted`) now writes a record that starts and finishes as `done` with zero counts, so `host-status.ts` can say "nothing waiting before the cutoff". An automatic run that finds nothing still writes no record, because that happens at every host start.

### Ignore all is one settings save

**Ignore all** reuses the existing ignore save path, sending the union of the current `importIgnoredDirectories` and the listed directories with the current settings revision. One save keeps it atomic and gives the same conflict error as a single Ignore.

### Write health reuses the existing checks

A new `GET /api/memory/write-health` runs the existing **Memory store** and **Embedding** checks only, and returns `{ ok, reason, checkedAt }`. The reason is the check's error message after `safeHealthError` redaction, shortened to one line, for example `Embedding server error (500)`. The server caches the result for 30 seconds, so many open tabs make at most one probe each 30 seconds. The page asks on open, every 5 minutes while the tab is visible, and on **Check again**. The handler stays a few lines in `web-server.ts` and calls a new `src/services/write-health.ts`, so `web-server.ts` stays under its ceiling. A remote embedding API is called once per probe with the fixed string `OMMS health check`; this is a very small cost, which `docs/web-ui-memory.md` states.

### Avatars: crop in the browser, validate on the server

`avatar-image.ts` checks the file type from its first bytes (PNG, JPEG, WebP, GIF) and the 20 MB limit before it reads the file. It decodes with `createImageBitmap`, draws the centre square onto a 128 × 128 canvas, and exports PNG. Redrawing drops EXIF and any other metadata. SVG never reaches a canvas, because it can carry script.

Storage is under the global OMMS data folder, `<storagePath>/host-appearance/` (`~/.omms/data/host-appearance/` by default, next to `import-ledger.db`): `<host>.png` for an image and `appearance.json` for `{ <host>: { kind: "icon" | "image", icon? } }`; a host with no entry shows the default mark. Endpoints, all served from `memory-host-routes.ts` through the existing route-module hook so `web-server.ts` does not grow:

- `GET /api/host-appearance` returns `{ hosts: { <host>: { kind, icon? | image? } } }`, where `image` is a `data:image/png;base64,…` URL. A 128 × 128 PNG is a few KB, and JSON keeps the route module's result type.
- `PUT /api/host-appearance/<host>` takes `{ kind: "icon", icon }` or `{ kind: "image", png: <base64> }`.
- `DELETE /api/host-appearance/<host>` resets the host.

The server accepts only the three host names, an icon name in kebab-case (at most 40 characters, which the web app uses as a `lucide-react` key and shows as the default mark when it does not exist), and a PNG whose signature, IHDR chunk (128 × 128) and closing IEND chunk are correct, at most 256 KB. Every `/api/` route except health already requires the web token, so every change needs it. Writes go to a temp file and rename, so a crash leaves the old avatar.

The icon grid uses `lucide-react`, which the web app already ships. The picker offers a fixed set of about 60 icons that suit a coding tool, so the bundle does not grow by the whole icon set.

Default marks: simple two-letter monograms (`Pi`, `OC`, `CC`) in the host's `keywordHue` colour. No third-party logo files are added.

### Not set up comes from readiness

A host is not set up when its reader is unavailable or its default source does not exist, and no custom source is saved for it. This reuses `Readiness` and needs no new server check.

## Risks / Trade-offs

- [Users lose the one-page view of every setting] → Shared holds every cross-host setting in one view, and old anchors still open the right row.
- [The health probe calls a paid remote embedding API] → it runs at most once per 30 seconds per server and every 5 minutes per visible tab, with a fixed 3-word string.
- [A `partial` record never replaces a stale `full` record] → every session listing writes `full` again, so the next listing refreshes it; the host view lists sessions when it opens.
- [Large uploads slow the tab during decode] → the 20 MB limit applies before reading, and `createImageBitmap` decodes asynchronously.
- [Arabic right-to-left layout of the card row] → cards use logical properties; the browser check covers `ar`.

## Migration Plan

- `coverage` column: added with `ALTER TABLE ... ADD COLUMN coverage TEXT NOT NULL DEFAULT 'full'`, the same pattern as `import_runs`. No data change.
- `<storagePath>/host-appearance/` is created on the first change. With no folder, every host shows its default mark.
- Rollback: the old page ignores `coverage` and the appearance folder.

## Open Questions

None.
