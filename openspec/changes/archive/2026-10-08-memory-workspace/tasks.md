# Tasks

## 1. Memory page and compatible navigation

- [x] 1.1 Verify the sibling worktree and feature branch, then obtain permission for the root and web frozen-lockfile installs; verify both installations succeed without lockfile changes.
- [x] 1.2 Add `/memory`, its application view and sidebar tree, and the five-section Memory registry; translate new navigation labels and verify direct load, reload, active state, desktop collapse, and mobile navigation with route/sidebar tests that first fail without the new route.
- [x] 1.3 Move import, automatic-import, catch-up, memory-limit, and folder-map sections into Memory while retaining Profiles identity controls in Settings; verify each moved section appears once, Settings has no duplicate, existing limit/default/save tests pass, and profile identity visibility remains unchanged.
- [x] 1.4 Add legacy Settings-anchor redirects and cross-route host folder links; verify every old anchor, unrelated Settings links, Back navigation, focused host disclosures, and preserved in-page folder drafts through behaviour-sensitive navigation tests.
- [x] 1.5 Document the new page and section ownership in `docs/web-ui.md`, `docs/web-ui-settings.md`, a focused `docs/web-ui-memory.md` guide, and `docs/README.md`; verify all route and section links resolve to the tested destinations.

## 2. Server-owned grouped imports

- [x] 2.1 Add grouped request validation and metadata-only job types while preserving legacy single-host payloads and fields; verify invalid/duplicate/empty hosts, unknown options, no output, and Claude Code host-model rejection in focused web-import tests that fail against the old validator.
- [x] 2.2 Preflight all children and preserve their source tokens, revisions, selected keys, and turn cutoffs; verify stale sources, unavailable readers, missing models, zero matching sessions, read-only previews, and unchanged original history with fake runners and source fixtures.
- [x] 2.3 Run selected children sequentially in Pi/OpenCode/Claude Code order within the existing web job slot; use deferred runner tests to prove the next host waits for the full memory/profile return, a second web job is refused, reported failed work stops the group, and reload queries do not resubmit it.
- [x] 2.4 Add safe group cancellation, queued-source revalidation, and cleanup; verify cancellation before work and during profile learning, competing per-host claims, stale queued sources, retained completed results, suppressed later hosts, and snapshot cleanup without changing the other process's claim.
- [x] 2.5 Add per-host and combined preview counts and profile analysis estimates; verify privacy/trivial filtering, overlapping prompt identities, shared backlog counted once, separate memory/profile units, and no model or memory-store writes during preview.
- [x] 2.6 Reuse existing ledgers and forced profile replay identities for retries; verify a partially finished group skips completed work, retries failed/waiting work, keeps same-text session IDs separate across hosts, and does not automatically restart queued work after a server restart.
- [x] 2.7 Document the additive grouped web contract and failure/retry behaviour in the Memory guide and `docs/developers.md`; add the next available ADR for Memory page ownership and sequential batches, update the ADR index, and verify examples match request/response tests.

## 3. Digestible import controls and progress

- [x] 3.1 Split the existing large import component by host/session selection, shared options, and results while keeping one draft owner; implement positive output choices and visible project scope, translate the controls, and verify all output combinations, defaults, advanced options, and unchanged CLI flag mapping with interaction tests.
- [x] 3.2 Add individual host choices and the All hosts shortcut with independent source/session state; verify host deselection, missing-reader feedback, per-host listings and revisions, cross-page selection, and explicit scope boundaries before testing the grouped request sent by the UI.
- [x] 3.3 Require a current successful preview and paid-work confirmation; verify every option/selection change invalidates Start, preview shows blockers and no-work hosts, confirmation names the hosts/models/outputs, and duplicate submissions create only one group.
- [x] 3.4 Show the server-owned group's current host, memory/profile phase, queued and finished rows, combined counts, errors, and cancellation; verify reconnection after route navigation or reload and retain existing CLI/automatic-import status and last-run coverage.
- [x] 3.5 Update the Memory guide and the Pi, OpenCode, and Claude Code history-import guides for positive outputs and selected-host batches; verify the explanations distinguish grouped-job outcomes from existing historical import badges and do not imply changed CLI commands.

## 4. Profile actions and moved controls

- [x] 4.1 Rename Catch up profile to Analyse waiting prompts with an explanation of stored waiting prompts and analysis-call estimates; translate the copy and verify confirmation, existing lease/takeover, pause/resume, trivial filtering, and failure/retry behaviour with focused catch-up tests.
- [x] 4.2 Add Re-analyse chat history as a forced profile-only import preset; verify it opens the reviewed import flow without starting paid work, allows selected hosts/scope, leaves project memories unchanged, preserves the current profile, and honours once-per-prompt replay through UI and profile-import tests.
- [x] 4.3 Explain Automatic import's two outputs and fixed cutoff, Memory limits' unchanged five settings, and Resolve missing project folders' global mappings; translate visible/accessibility text and verify existing automatic-import disclosures, safe limit saves, revision refresh across pages, override notes, and folder-review behaviour remain intact.
- [x] 4.4 Update `docs/using-memory.md` and the Memory/Settings guides for backlog analysis versus history re-analysis, identity rules, call-estimate limits, memory limits, and folder mappings; verify examples and labels match the implemented actions and avoid promising additional workflows.

## 5. Integration and approval gate

- [x] 5.1 Prove the new regression tests detect missing or deliberately broken behaviour, then run the relevant files through the isolated test runner, `bun run check`, `bun run build`, and `bun run ci:local` after permission; record exact commands/results and keep all existing boundary tests passing.
- [x] 5.2 Verify the feature-worktree UI through Orca with synthetic API data or an isolated store, using the project's theme/language/width matrix; record screenshots and interaction results for navigation, output choices, group progress/errors, profile actions, and limits without paid imports or production config writes.
- [x] 5.3 Run `openspec validate memory-workspace --strict` and perform `openspec-verify-change`; verify task/spec/design coverage, resolve every finding, and report the final state before requesting any archive or git action.
