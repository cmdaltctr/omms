# Tasks: modularity follow-ups

Each group is one or more pull requests. Each pull request is built in its own sibling worktree from `origin/main`, passes `bun run ci:local`, and lowers its ratchet or ceiling baseline in the same commit. Use `refactor:` commits.

## 0. Before each part

- [ ] 0.1 Measure the current counts again (ratchet baselines, ceiling lines) and update the table in `design.md`.
- [ ] 0.2 Split the part into slices of 15 files or fewer, and list them under the part below.

## 1. Split the three largest files (part 4)

Slices (one per file, each under 15 files): A `api-handlers.ts` (1.1, 1.2), B `web-server.ts` (1.3, 1.4), C `user-profile-manager.ts` (1.5, 1.6). The slices own separate files and run in parallel. Each slice moves the ratchet counts of the code it moves to the new file names and never raises a total.

- [x] 1.1 Add characterisation tests for the `api-handlers.ts` route groups that lack them. Confirm that each test fails when the handler is broken.
- [x] 1.2 Split `src/services/api-handlers.ts` into `src/services/api/<group>.ts`. Keep the old path as a re-export. Remove its ceiling entry.
- [x] 1.3 Add characterisation tests for `web-server.ts` port ownership, step-aside and static serving where they are missing.
- [x] 1.4 Split `src/services/web-server.ts` by responsibility (D3). Remove its ceiling entry.
- [x] 1.5 Add characterisation tests for `user-profile-manager.ts` merge, dedupe, cleanup and version history.
- [x] 1.6 Split `src/services/user-profile/user-profile-manager.ts` behind a facade. Remove its ceiling entry.

## 2. OpenCode profile learning on the shared path (part 3)

- [x] 2.1 List what `src/adapters/opencode/profile-learning.ts` does that `src/core/profile-analysis.ts` does not.

Tasks 2.2 to 2.4 moved to the `unify-profile-learning` change (2026-11-18). The user chose one shared learning loop for all three hosts, with new defaults and a settings table. That changes behaviour, so it cannot be part of this refactor. The `profile-learning.ts` ceiling entry is removed there.

## 3. Pass config in (part 2)

Measured 2026-11-18 after `unify-profile-learning`: 52 files, 53 import sites. Approaches A, B, G, W and S are in design D5a. Slices (each 15 files or fewer, tests included), in waves of slices that share no file except the ratchet table:

| Wave | Slices                                                                                                                                                                                                                                                           |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | C1 web routes (web-autostart, web-jobs, openrouter-routes, skill-routes, ai-cleanup-handlers, auto-cleanup-handlers, web-route-modules); C2 settings (settings-snapshot, embedding-change); C3 store reader and `turso/` (5); C9 space-tool; C12 profile-context |
| 2    | C4 space routes; C5 `api/shared.ts`; C6 store files I (7); C7 store files II (7, includes `tags.ts`); C8 user-prompt-manager, backfill-state, write-health-checks; C11 memory-operations; C13 retrieval                                                          |
| 3    | C10 capture-context; C14 skills settings; C18a context step 1; C19 profile cleanup model                                                                                                                                                                         |
| 4    | C15 capture step 1; C18b context step 2; C24 move `global-config-writer.ts` to `src/config-writer.ts`                                                                                                                                                            |
| 5    | C16 capture step 2, then C17 auto-capture, then C20 cleanup and dedup (shared files, one after another)                                                                                                                                                          |
| 6    | C21 to C23 `client.ts` (expand, then contract)                                                                                                                                                                                                                   |

Target: `web-server.ts` and `active-space-access.ts` keep their import (D5a). The slice that takes the list below 10 files lowers the `minimum` argument of the `CONFIG import` ratchet.

- [x] 3.1 Slice the 52 `CONFIG` importers in `src/core/` and `src/services/`, leaf modules first.
- [x] 3.2 For each slice, change functions to take a `Pick<typeof CONFIG, ...>` argument and pass `CONFIG` at the edge (D5). Lower the `CONFIG import` baseline.
- [x] 3.3 Remove each `mock.module("../src/config.js")` stub whose test no longer needs it. Do not weaken any assertion.
- [x] 3.4 When the baseline reaches 0 for `src/core/` and `src/services/`, record it in `docs/shared-core.md`.

## 4. Storage port (part 1)

Decision D6a. Slices, one store each, in waves: 1 S0 foundation; 2 S1 capture attempts, S2 Claude cursor, S4 AI sessions, S6 ledger I; 3 S3 retry queue, S5 chat, S7 ledger II, S8 skills I; 4 S9 skills II, S10 prompts, S11 profiles; 5 M0 memory surface; 6 M1 web API, M2 client, M3 memory readers, M4 memory maintenance; 7 M5a shard migrations, M5b tag migrations; 8 SP1 space store, then SP2 transfer, import and export; 9 F close.

- [ ] 4.1 Create `src/services/storage/` and change `STORAGE_FOLDER` in `tests/modularity-ratchets.test.ts`.
- [ ] 4.2 For each store (memory, prompt, profile, import ledger, skills, chat, capture attempts), add characterisation tests for reads, writes, space switch and `resettable()`.
- [ ] 4.3 Move the store's SQL and libSQL imports behind typed functions, one store per pull request. Lower the `storage import` and `raw SQL` baselines each time.
- [ ] 4.4 Run a live check against a scratch HOME with a real-shaped store copy after each store moves. Confirm that the row counts and a search result match those from before the move.
- [ ] 4.5 Update `docs/shared-core.md` and the architecture table in `CLAUDE.md`.

## 5. Close

- [ ] 5.1 All ratchet baselines that this change owns are at 0, or justified in `design.md`.
- [ ] 5.2 Run `openspec validate modularity-follow-ups --strict`, then archive.
