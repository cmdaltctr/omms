# Design: modularity follow-ups

## Context

The measured debt on 2026-11-17, after PR #288 and PR #290 merged. Measured again on 2026-11-18 at `39c8beb5` before part 4: no number changed.

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

#### Task 2.1 inventory (2026-11-18)

What `src/adapters/opencode/profile-learning.ts` does that `src/core/profile-analysis.ts` does not. "Differs" means the shared path has the step but behaves differently, so a plain move changes OpenCode behaviour.

| Step                                                                                       | Shared path                                                     | Goes to          |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------------------- | ---------------- |
| Re-entry flag, backoff check, config refresh, byte limit                                   | Claude has the flag; backoff shared                             | adapter          |
| Skip with a warning when the provider is not ready                                         | missing                                                         | adapter          |
| Drop trivial prompts, newest batch of `userProfileAnalysisInterval`                        | same in Claude                                                  | core             |
| User id `"unknown"` when no email                                                          | differs: Pi and Claude skip                                     | adapter for now  |
| Validation step (`userProfileValidationEnabled`, default off), verdicts, `evolveAndUpdate` | missing                                                         | core             |
| Decay and `pendingValidation` promotion before every analysis                              | missing: Pi and Claude merge without decay                      | core, opt-in     |
| Rich prompt: profile summary, guidelines, examples, byte cut                               | differs: shared sends numbered prompts only                     | core, opt-in     |
| Host-model call: own system prompt, structured output, 120 s limit                         | differs: `analyzeProfile` uses text `complete()`, schema check  | port + core opts |
| Host-model failure falls back to the external API (issue #265), no notice                  | Pi has the rule and shows a notice                              | adapter          |
| External call with `createUserProfileToolSchema`, no reply check                           | differs: `model-selection.ts` uses `z.toJSONSchema` and a check | adapter port     |
| Backoff success recorded before the save                                                   | differs: Pi and Claude record after                             | core             |
| Save loop: 3 attempts, re-read via `getActiveProfile`, decay and merge per attempt         | differs: `saveMergedProfile` re-reads via `getProfileById`      | core with hooks  |
| Version-history summary "+N preferences…", "validated: …"                                  | differs: "Pi analysis of N prompts"                             | core             |
| Cleanup start without a model                                                              | Pi and Claude pass `resolveModel`                               | adapter          |
| Notice "User Profile Updated", rethrow on failure                                          | differs per host                                                | adapter          |
| `buildLearningPaths` and the "no result" branch                                            | dead code                                                       | delete           |

Test facts: no OpenCode learning test goes through V2 `setup`. They call `performUserProfileLearning(directory)` in a `Bun.spawn` subprocess with `mock.module` stubs. `tests/profile-workflow-prompt.test.ts` reads the adapter source, so it changes when the prompt moves.

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
