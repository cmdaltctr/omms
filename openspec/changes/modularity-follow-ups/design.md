# Design: modularity follow-ups

## Context

The measured debt on 2026-11-17, after PR #288 and PR #290 merged:

| Debt                                             | Files | Sites       | Guarded by                                                     |
| ------------------------------------------------ | ----- | ----------- | -------------------------------------------------------------- |
| libSQL imports outside `services/turso`          | 51    | 137         | `storage import` ratchet, `tests/modularity-ratchets.test.ts`  |
| Raw SQL outside the storage folder               | 49    | 311         | `raw SQL` ratchet, same file                                   |
| `CONFIG` imports in `src/core/`, `src/services/` | 52    | 62          | `CONFIG import` ratchet, same file                             |
| `user-profile-manager.ts`                        | 1     | 1,947 lines | `tests/file-size-ceiling.test.ts` (baseline 1947)              |
| `web-server.ts`                                  | 1     | 1,790 lines | ceiling baseline 1833                                          |
| `api-handlers.ts`                                | 1     | 1,183 lines | ceiling baseline 1194                                          |
| OpenCode `profile-learning.ts`                   | 1     | 824 lines   | ceiling baseline 832; host-branch test keeps it in the adapter |

The archived proposal `openspec/changes/archive/2026-11-17-modular-boundaries/proposal.md` ("Follow-up changes") has the first size estimates. Measure again before each part starts. Other work may move the numbers.

## Goals

- Every ratchet baseline above reaches 0, or reaches a number the `CLAUDE.md` rules allow.
- The three largest files leave the ceiling list.
- No user-visible behaviour changes. No stored data changes shape.

## Non-goals

- A new storage engine. libSQL/Turso stays.
- Web host registry use (`web/src/`). That is a separate follow-up from the archived proposal.
- A fourth host.

## Decisions

### D1. One pull request per slice, smallest first

Each part is split into slices of 15 files or fewer. A slice lowers its ratchet baselines in the same commit. The ratchet tests then act as the progress tracker. A slice that would raise any count does not merge.

### D2. Characterisation tests before each move

Before code moves, pin its current behaviour with tests. Write each test against the old code and confirm it passes there. Mutate the old code and confirm the test fails, then move the code. No existing assertion changes.

### D3. Part 4: split by responsibility, keep import paths

- `api-handlers.ts`: one file per route group under `src/services/api/`. The old path stays as a re-export, so `web-server.ts` and the test imports need no edits in the same slice.
- `web-server.ts`: move route registration, port ownership, the step-aside and update hooks, and static serving into separate modules. `web-server.ts` keeps only startup.
- `user-profile-manager.ts`: split storage, merge/dedupe, cleanup and the version history into separate modules. Keep the manager as a thin facade so callers do not change.

### D4. Part 3: OpenCode uses `core/profile-analysis.ts`

The adapter keeps only these pieces:

- the OpenCode model port: host model, then external API, then session model, through `live-model-choice.ts`
- the per-turn trigger
- the TUI notice

The batching, the prompt build, the merge and the backoff move to the shared path, or reuse what Pi and Claude Code already call. Each existing OpenCode profile test must pass unchanged through the V2 adapter (`setup` with a fake V2 context).

### D5. Part 2: pass values, not `CONFIG`

Follow `live-model-choice.ts`: the function takes a `Pick<typeof CONFIG, ...>` argument, and the caller at the edge passes `CONFIG`. Callers are host adapters, CLI entry points and the web server start. A `CONFIG` import is allowed only at those edges. Long-lived objects that read config take it in their constructor, and register with `resettable()` when they hold a path built from `storagePath`.

### D6. Part 1: storage port, one store per slice

Use one folder, `src/services/storage/`, with one module per store: memory, prompt, profile, import ledger, skills, chat, capture attempts. Each module owns its SQL and its connection through the existing connection manager. Callers use typed functions, never SQL. Change `STORAGE_FOLDER` in `tests/modularity-ratchets.test.ts` in the first slice. Keep each `.db` file name the same. Keep `skills.db` and the embedding cache on the global storage path.

## Risks

- **Data loss in part 1 (Likelihood 3 × Impact 9).** Mitigation: characterisation tests per store, including space switch and `resettable()`. Also back up the store before any live check, and run a live check against a scratch HOME with a copy of a real-shaped store.
- **Config stubs in tests (Likelihood 6 × Impact 2).** Many tests stub `../src/config.js` with `mock.module`. Part 2 removes the need for those stubs. Remove each stub only when its file no longer imports `CONFIG`.
- **Merge conflicts with feature work (Likelihood 5 × Impact 2).** Small slices keep the conflict window short.

## Rollback

Each slice is one `refactor:` commit with no data change, so a revert is safe.
