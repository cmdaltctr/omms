# Design

## Context

See [proposal.md](proposal.md) for the user problem and agreed scope.

The current implementation has these relevant boundaries:

- `web/src/lib/routes.ts` recognises project memories, user profile, and Settings. `App.tsx` owns the shared shell and page heading.
- `SETTINGS_SECTIONS` drives the Settings sidebar and `SettingsView` card order. Five of those sections become Memory children.
- `SettingsView` currently wraps `ProfilesSection` and `ProfileCatchUpSection` together. Profile identity controls still belong to Settings under the existing `profile-identity` spec.
- `ImportSection.tsx` is already over 600 lines. It owns one host, source/list state, selection, option fields, readiness, and job polling. Adding a three-host queue directly to that component would increase its responsibilities.
- `SettingsImportJobs` owns one in-memory slot shared by previews and imports. Its single-host request has `host`, `source`, `selection`, `options`, and `modelChoice`.
- `runHistoryImport` already owns host-specific execution, cross-process per-host claims, progress, and the shared ledger. `historyImportFailed` detects both failed memory units and a profile error.
- `importProfilePrompts` reads history prompts and drains the shared profile backlog. A forced replay uses the existing `#profile-rebuild` identity and can run once per prompt. Catch-up reads only stored waiting prompts.
- Source tokens, selection revisions, listing-time cutoffs, and OpenCode snapshots already protect web selections. Preview makes no model calls or memory-store writes, although listing or preview can create a temporary OpenCode snapshot.
- Settings requests and shared revision notifications are independent of the visible page. They can serve Memory without creating another config writer.

The relevant contracts are in [web-memory](specs/web-memory/spec.md), [multi-host-import](specs/multi-host-import/spec.md), and the four existing-capability deltas.

## Goals / Non-Goals

**Goals:**

- Give each UI action an explicit source and output, with a preview before paid work.
- Move existing controls without changing capture, retrieval, storage, host model rules, or automatic import cutoffs.
- Run selected histories in the web server so navigation does not own the next-host decision.
- Keep per-host selections, claims, results, and retry identities throughout a grouped run.
- Preserve old section links and shared config revisions.

**Non-Goals:**

- No new host, combined CLI command, dependency, database schema, or background scheduling service.
- No new profile reset, unlimited forced replays, or change to matching, confidence, decay, or workflow counts.
- No change to profile identity resolution or automatic merging of profiles with different git emails.
- No change to cross-process scheduling beyond respecting the existing per-host import claims.
- No redesign of the Project memories or User profile browsing pages.

## Decisions

### 1. Add a Memory route using the existing application shell

Add a `memory` view and `/memory` route. The backend's app-path handling must serve it on direct load as well as client navigation. Keep `/` resolving to Project memories.

Create one Memory section registry and `MemoryView` composition. Move the import, automatic-import, catch-up, limit, and folder-map presentation into `web/src/lib/components/memory/`. Keep each section's data operations in its current owning shared module. Reuse existing controls, CSS, and translation helpers rather than introducing a second design system.

The page and sidebar order is:

| Anchor                           | Title                           |
| -------------------------------- | ------------------------------- |
| `memory-section-import`          | Import chat history             |
| `memory-section-auto-import`     | Automatic import                |
| `memory-section-profile`         | Profile learning                |
| `memory-section-limits`          | Memory limits                   |
| `memory-section-project-folders` | Resolve missing project folders |

Keep the Settings tree's existing persistence key. Give the Memory tree its own open/closed preference. Retain the existing desktop-collapse and mobile-drawer behaviour.

Separate `ProfilesSection` from the catch-up wrapper. Keep it in Settings with a dedicated Profiles anchor and its existing conditional visibility. This avoids moving identity selection or profile merging as an accidental part of moving learning actions.

**Alternative:** Keep a Memory group inside Settings. Rejected because the requested navigation separates memory operations from application configuration.

### 2. Resolve legacy anchors before rendering the destination

Use a small explicit compatibility map in the existing route/section-navigation layer:

| Old Settings anchor               | New Memory anchor                |
| --------------------------------- | -------------------------------- |
| `settings-section-import`         | `memory-section-import`          |
| `settings-section-auto-import`    | `memory-section-auto-import`     |
| `settings-section-profile`        | `memory-section-profile`         |
| `settings-section-memory`         | `memory-section-limits`          |
| `settings-section-directory-maps` | `memory-section-project-folders` |

Preserve `directory-maps-pi`, `directory-maps-opencode`, and `directory-maps-claude-code` as host summary IDs. Recognise old `/settings#directory-maps-<host>` links too. Navigate first, then reveal and focus the matching disclosure after mount. Use history replacement for a legacy URL so Back does not cycle between the old and new locations.

Links within Memory must not remount its sections or reset unsaved folder targets. Unrelated Settings anchors retain their current destinations. Tests should click links and verify the destination and focus, rather than only searching source text.

**Alternative:** Remove old anchors and update only current links. Rejected because bookmarked URLs and existing documentation would stop reaching the intended action.

### 3. Put positive outputs and scope in the main import flow

Keep Current project as the default scope and both outputs selected. Preserve Pi as the initial host choice; choosing All hosts is an explicit wider selection. Show individual host choices and an All hosts shortcut, with an accessible selected-host count. Users can remove an unavailable host without losing the other selections.

Map web output choices to the existing importer options:

| Project memories | User profile | Importer options                            |
| ---------------- | ------------ | ------------------------------------------- |
| Selected         | Selected     | `skipMemories: false`, `skipProfile: false` |
| Deselected       | Selected     | `skipMemories: true`, `skipProfile: false`  |
| Selected         | Deselected   | `skipMemories: false`, `skipProfile: true`  |
| Deselected       | Deselected   | Invalid web request                         |

The UI has no Skip memories or Skip profile labels. The CLI flags stay unchanged. Place source overrides, inclusive prompt dates, batch size, and per-run map overrides under Advanced options. Label the existing force option **Re-analyse handled history** and explain its effect on whichever outputs are selected.

A listing or preview becoming stale clears permission to start a real run. Changes to selected hosts, source, selections, scope, dates, maps, outputs, force, batch size, or model choices invalidate the preview. A confirmation summarises the current outputs and warns about model calls.

Split the current large import component by responsibility: host/source session selection, the shared options and output controls, and preview/job results. Keep one owning draft and derive request options from it; avoid duplicate state chains and generic form abstractions.

**Alternative:** Rename the skip labels while keeping them negative. Rejected because positive choices state the outputs directly and make the profile-only preset visible.

### 4. Extend the existing web job owner with a grouped contract

Keep `/api/settings/imports`, `/api/settings/imports/current`, and the existing cancellation endpoint. Their names are internal API compatibility, not a requirement to keep the UI under Settings.

Accept an additive grouped payload with a `hosts` array. Each entry holds a supported `host`, source token, pinned `selection`, and that host's `modelChoice`. Shared import `options` apply to the children. Reject empty or duplicate hosts, unsupported names, unknown options, inconsistent scopes, and both outputs disabled. Preserve the current single-host payload and response fields.

Normalise requests to ordered children, always Pi, OpenCode, then Claude Code among those selected. The job slot remains owned by `SettingsImportJobs`; add a bounded group executor in the importer rather than a browser-driven loop. Keep the job owner under about 500 lines by separating grouped validation/execution if needed. Do not add a generic scheduler or persistent queue.

A group response contains its ID, dry-run flag, overall state, active host, and per-host entries. Entries carry metadata-only queued/running/done/failed/cancelled/no-work/not-run states, phase progress, summaries, and redacted errors. Sum like-for-like counts across completed child reports; keep memory units and profile batches separate. Preserve legacy response fields for single-host callers.

The current group lives in the web server like the existing single job. The page reconnects to it through the current-job endpoint after navigation or reload. A server restart ends that group; durable retry progress stays in the existing ledgers. A fresh preview and confirmation resumes unfinished work without adding persistent orchestration state.

**Alternatives:** A browser loop would lose queue ownership on navigation. Parallel host execution would overlap profile work and complicate failure reporting. A new durable scheduler would add storage and recovery behaviour beyond this change.

### 5. Preflight all children, then execute complete host runs sequentially

For a real run, validate every selected source, selection, option set, and model readiness before the first paid call. An unavailable child blocks the group and names the host. Valid sources with zero sessions become no-work results. Preview remains usable without model readiness and reports blockers without invoking a model.

Each child calls `runHistoryImport` with its own host, source path, selected keys, and listing-time cutoff. It receives capture progress and profile-phase progress. Wait for its complete return before starting the next child. Revalidate queued source identity and pinned selection at that child's start; a change or expiry fails visibly instead of silently refreshing or widening the selection.

Keep each child's model choice valid under current rules. A common Saved external API choice can fill all children. Claude Code has no host-model choice. Pi and OpenCode keep existing connected OpenCode web choices where available. Group execution never saves capture or backfill model settings.

Use `historyImportFailed(report)` for grouped outcomes. The current single-job owner does not distinguish every reported failure from a normal return, so a grouped loop must not use promise resolution as proof of success. Stop later children on a thrown error, failed unit, or profile error. Preserve each completed report and mark untouched children not run.

Use the existing abort signal for cancellation, including preparation, snapshots, and the active child. Prevent the next child from starting after cancellation. Release source/snapshot resources for finished, failed, cancelled, and never-started children according to existing snapshot retention rules; successful previews keep only the reusable snapshots needed by their selections.

Sequential execution coordinates the group's own profile steps. It does not replace the existing process-wide profile model registration or invent a global lock against every other process. Every child still takes the existing per-host claim; a competing CLI or backfill fails that child with the usual host-specific reason.

### 6. Make the two profile actions explicit without changing learning rules

**Analyse waiting prompts** keeps the existing catch-up endpoint, lease, pause/resume, oldest-first batches, and failure handling. Change its heading and explanatory copy so users understand that its input is already inside OMMS.

**Re-analyse chat history** opens the same import flow with only User profile selected and force enabled. It does not start work, erase a profile, bypass preview, or create another profile-learning pipeline. Keep hosts and project scope selectable. Preserve the once-per-prompt `#profile-rebuild` key in individual and grouped imports.

Show profile analysis-call estimates separately from memory work. Count non-trivial eligible source prompts using the same privacy and trivial-prompt rules as execution. Identify any waiting backlog separately and count it once in a combined estimate. These estimates are not a spending cap; matching, deduplication, retries, and newly waiting prompts can add calls.

An all-host run keeps existing user-email resolution. It does not force different profile identities into one profile. The explanation links users to Settings profile identity controls when relevant. Profile results merge through the existing rules, so no UI promise says that re-analysis must increase the workflow count.

**Alternative:** A separate reset-and-rebuild pipeline would change profile preservation, replay semantics, and identity handling. The existing forced import is sufficient for the requested action.

### 7. Move existing config and mapping controls without another writer

Memory limits and Automatic import keep their existing `/api/settings` save flow, revision notifications, conflict handling, validation, and live-refresh semantics. A save on either page publishes the new revision; sections opening on the other page read the current snapshot.

Memory limits retains all five config identifiers, defaults, units, explanations, override notes, and nested `chatMessage` preservation. This change changes its title and location only.

Resolve missing project folders retains the current mapping suggestions, host disclosures, review dialog, ignore/restore actions, and global save behaviour. Use the new title and a plain explanation; do not change directory resolution, silently save proposals, or start imports from navigation.

### 8. Verify with synthetic data and behaviour-sensitive tests

Use the current isolated Bun runner for focused backend and web test files. Do not weaken old assertions without replacing them with equivalent coverage for the moved behaviour. Add interaction tests for positive outputs, invalid selections, preset actions, preview invalidation, and real route/focus behaviour.

For grouped execution, use deferred fake child runners to prove that only one starts, that the next waits for profile completion, and that failure or cancellation suppresses later calls. Include ordinary reports containing failed work, stale queued sources, competing claims, same-text session IDs across hosts, and legacy single-host payloads.

Prove new tests fail against the missing or deliberately broken implementation before relying on them. Then run focused tests, check/build, strict OpenSpec validation, and the full local CI gate after permission.

Use Orca's embedded browser against the feature worktree build with fixture API responses or an isolated test store. Check both themes, English/Chinese/Arabic, desktop collapse, mobile widths, 320px overflow, and 200% zoom using the project's design verification matrix. Do not start paid imports, save production config, or mutate real memories as part of visual verification.

If native browser zoom controls cannot be reached, use the user's standing approval for best-judgement completion to verify browser-rendered CSS scaling at 200% and a 640×400 effective viewport separately. Record the exact mechanism, geometry, hit-testing, screenshots and restored settings. Report manual native GUI zoom as not run; never describe simulated scaling as native zoom. This fallback changes the verification method, not the required reflow or accessible controls.

Use screenshot-driven native frames when an off-screen Orca surface suspends animation callbacks. Confirm target rectangles, disclosure focus and preserved drafts after rendering. Keep local verification artefacts in the gitignored `docs/memory-workspace-evidence/` folder. README demonstration PNGs remain tracked under `.github/screenshots/`, contain English-only synthetic data and use the existing OMMS logo. English Memory and Settings H1s and the Memory sidebar parent use uppercase presentation; sidebar children retain their translated natural case.

## Risks / Trade-offs

- **Old links reach the wrong card:** Use an explicit compatibility map and direct-load/reload tests for every moved anchor.
- **A batch pays for work before discovering a blocker:** Preflight every child before paid calls and recheck a queued source before that child starts.
- **Profile calls exceed the displayed estimate:** Label analysis calls separately and state that matching, retries, and the changing backlog can add calls.
- **Partial failure looks successful:** Keep grouped outcomes separate from historical import badges and inspect reported failed work.
- **A cancelled queue starts another host:** Check the abort signal between all preparation and child execution steps.
- **Moving cards loses revision or folder drafts:** Reuse the shared snapshot writer and preserve in-page state when revealing anchors.
- **The proposal adds too much to the existing large import component:** Split by the responsibilities already identified, without creating a generic form framework.
- **A long group outlives source tokens or snapshots:** Report that host as stale, retain finished ledger work, and require a fresh preview for the retry.
- **Hosts resolve different profile identities:** Keep existing identity rules and explain that All hosts does not merge profiles.

## Migration Plan

1. Implement and test the route/anchor compatibility before removing the moved Settings entries.
2. Add the grouped web contract while continuing to accept legacy single-host requests.
3. Move and relabel the existing sections, then enable the grouped UI and profile-only preset.
4. Update `docs/web-ui.md`, `docs/web-ui-settings.md`, `docs/using-memory.md`, and the three host history-import guides. Add a focused Memory-page guide and link it from `docs/README.md`.
5. Record page ownership and the sequential web-batch decision in the next available ADR and update its index.
6. Verify the change and retain it active until approval for implementation, then archive only after implementation tests and verification pass.

No data or config migration is needed. Rollback restores the earlier UI/job owner; any memories or profile prompts already imported remain valid under the unchanged ledger identities.
