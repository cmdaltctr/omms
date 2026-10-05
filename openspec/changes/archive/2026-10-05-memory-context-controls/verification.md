# Verification: memory-context-controls

## Result

Implementation verified against both delta specs, the design, and the task list. All implementation and test requirements are met. This report completes task 6.5; the task file is updated immediately afterwards.

| Dimension    | Result                                                                                               |
| ------------ | ---------------------------------------------------------------------------------------------------- |
| Completeness | 28 task acceptance criteria met; 8 requirements covered                                              |
| Correctness  | 30 scenarios mapped to implementation and test or browser evidence                                   |
| Coherence    | Shared packing, host boundaries, shallow config merge, safe writes, and existing UI owners preserved |
| Final gate   | PASS: 270 isolated test files, 1829 tests passed, 0 failed                                           |

No unresolved implementation findings. Archive approval remains separate. No commit, push, archive, real-store write, or dependency change was made.

## Environment and scope

- Worktree: `/Users/aizat/Development/PROJECTS/omms-feat-memory-context-controls`.
- Branch: `feat/memory-context-controls`; baseline: `1997c05`.
- Main checkout remained on `main`.
- Final gate: Bun `1.4.2`, Node `24.21.0`.
- The system Node is `26.10.0`. The final gate used an official Node 24 binary under `/tmp/omms-node24-verify/`, verified against Node's published SHA-256 checksum. Project dependencies and the system install were unchanged.
- Four Pi workers ran in parallel with separate file ownership. Follow-up dispatches repaired review findings. Every worker settled and its owned terminal was released or transferred to its follow-up.
- Config and store tests used temporary directories. The browser used synthetic API fixtures with the real-data proxy disabled.

## Requirement and scenario coverage

| Requirement                                         | Implementation                                                                                                                  | Evidence                                                                                                                                                                                                                                                                                                                                                 |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| File-only memory limits                             | `src/utils/memory-limits.ts`, `src/config.ts`                                                                                   | `memory-limits-config.test.ts`: five defaults, boundaries, wrong types, fractions, omitted keys, terminal edits, project overrides, generated template, and valid/invalid live reloads                                                                                                                                                                   |
| One automatic size budget                           | `src/core/context-budget.ts`, `src/services/context.ts`, `src/core/retrieval.ts`, V1/V2/Pi/Claude callers                       | `memory-context-budget.test.ts`, all four `*-injection-budget.test.ts` files, shared memory operations, CLI search, and Claude hook tests: bounded final text, supported recent/restored paths, wrapper overhead, one request total, unchanged stored data and manual results                                                                            |
| Ordered packing and complete delimiters             | Shared packer and both formatters                                                                                               | `memory-context-budget.test.ts`: small-input output unchanged, first oversized result shortened, later results excluded, profile quarter allocation, unused space reused, Unicode sweeps, complete tags, and no marker-only section                                                                                                                      |
| Next-operation limits and original in-flight limits | Operation-entry refresh and snapshots in hosts, client search, capture, manual operations, and OpenCode profile learning        | `memory-limits-operation-snapshot.test.ts`, V2 budget tests, config reload tests: config changes during deferred work, next request uses new limits, invalid live edits retain last-good config, multiple sections and concurrent compaction stay within the original total                                                                              |
| True OpenCode profile bytes                         | `src/adapters/opencode/profile-learning.ts` uses `truncateToMaxBytes` with a snapshotted ceiling                                | `opencode-profile-learning-bytes.test.ts`: Chinese, Arabic, emoji, marker overhead, fitting input, and unchanged stored prompts; TDR-033 records the correction                                                                                                                                                                                          |
| Editable Memory card and effects                    | `MemorySection.tsx`, `memory-controls.ts`, Settings translations                                                                | `memory-section.spec.tsx` and browser evidence: five labelled rows, defaults, units, visible effects, UTF-8 and estimate help, host coverage, readable mixed-direction text, local overflow, and no English translation fallback                                                                                                                         |
| Safe Memory saves                                   | Settings snapshot, fixed writer allowlist, explicit nested JSONC path, shared revision flow                                     | `memory-limits-settings.test.ts`, `web-settings-api.test.ts`, UI tests: nested leaf preservation, creation of a missing parent, comments/order/siblings, invalid and unsupported edits, auth/origin/JSON checks, conflicts, legacy migration, project overrides, Cancel, save locking, translated failure feedback, and subsequent saves on another card |
| Memory sidebar navigation                           | Shared Settings registration, `SettingsView.tsx`, `settings-navigation.ts`; existing sidebar and Directory maps helper retained | `memory-navigation.spec.tsx`, sidebar/navigation/heading regressions, and browser evidence: unique link after Models, project-to-Settings navigation, direct URL/reload, desktop collapse, mobile drawer dismissal, host disclosure focus, and preserved unsaved map target/selection                                                                    |

A project-only global-value regression was added during integration. It initialises runtime config for the project, proves the global input still uses its default, and prevents project values leaking into global edits.

## Red-before-green evidence

| Area                           | Before implementation or repair                                                    | Final focused result                                          |
| ------------------------------ | ---------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Config limits                  | 7 new assertions failed                                                            | 9 passed                                                      |
| Settings limits                | 9 new assertions failed                                                            | 12 passed, including the later project-only regression        |
| Shared packing                 | 25 new behaviour tests failed; small-input guards passed                           | 29 passed, including the later marker-only Unicode regression |
| OpenCode profile bytes         | Multibyte size, marker overhead, and split-surrogate cases failed                  | 5 passed                                                      |
| Host propagation               | Removing budget arguments failed Pi 2/2, V1 4/4, and Claude 3/3 scenarios          | All host budget suites passed                                 |
| Operation snapshots            | All five deferred-work scenarios failed                                            | 5 passed                                                      |
| V2 review repairs              | Three regressions failed: restored-only timing and prompt/compaction refresh order | 9 passed                                                      |
| Memory UI                      | Missing component failed before the card existed                                   | 23 passed                                                     |
| UI feedback and duplicate save | Seven assertions failed before the repair                                          | Included in the 23 passing UI tests                           |
| Memory anchor                  | Removing its mount effect made the navigation test fail                            | 6 passed after restoration                                    |

## Final commands

The user approved dependency installation and full CI before implementation continued.

| Command                                              | Result                                                                                                                            |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `bun install --frozen-lockfile`                      | PASS, root dependencies installed in the feature worktree                                                                         |
| `(cd web && bun install --frozen-lockfile)`          | PASS                                                                                                                              |
| Prettier on changed files                            | PASS                                                                                                                              |
| `bun run check`                                      | PASS: format, lint, typecheck                                                                                                     |
| `openspec validate memory-context-controls --strict` | PASS                                                                                                                              |
| `bun run ci:local` with Node 24 on PATH              | PASS: check, clean build, 270 isolated files, 1829 passed, 0 failed                                                               |
| `git diff --check`                                   | PASS                                                                                                                              |
| `graphify update .`                                  | PASS: local AST-only graph update, no model call                                                                                  |
| `coderabbit review --agent -t uncommitted`           | Initial review found two valid V2 timing issues; both fixed. Second review: 0 findings                                            |
| Aikido scans of changed first-party code             | 41 unique code/test files scanned across initial and follow-up scans. No new findings; baseline file-read warnings reviewed below |

CodeRabbit reviewed tracked uncommitted changes. Its file list does not include untracked new files. New helpers, components, and tests also received direct review, focused tests, and Aikido scans.

The final gate runs each test file in a separate Bun process. Web specs use `--tsconfig-override web/tsconfig.app.json`. The required regressions passed:

| File                                             | Passed | Failed |
| ------------------------------------------------ | ------ | ------ |
| `web/tests/import-status-navigation.spec.tsx`    | 6      | 0      |
| `web/tests/automatic-import-navigation.spec.tsx` | 2      | 0      |
| `web/tests/directory-map-controls.spec.tsx`      | 3      | 0      |
| `web/tests/heading-hierarchy.spec.tsx`           | 5      | 0      |
| `web/tests/sidebar-settings-tree.spec.tsx`       | 3      | 0      |
| `tests/release-approve.test.ts`                  | 9      | 0      |
| `tests/web-settings-api.test.ts`                 | 21     | 0      |

Full final output: `/tmp/omms-memory-context-ci-node24.log`. Earlier CI and review logs are also under `/tmp/omms-memory-context-*`.

## Security finding assessment

The initial 33-file Aikido scan reported 13 potential file-read findings. Scanning the same four files from baseline `HEAD` reproduced all 13, with identical rule IDs and snippets. Follow-up scans covered the remaining changed files and repairs.

| Sites                                     | Assessment                                                                                                                                                                                                     |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Config loader and secret-reference reader | Local operator-selected config paths and explicit file references. Memory controls add no path field.                                                                                                          |
| Settings snapshot and writer              | Fixed global filenames and project config filenames; saves accept a fixed allowlist and explicit nested leaf. Request callers cannot supply the file path. Auth/origin/JSON/conflict tests pass.               |
| Claude transcript reader                  | `checkedTranscriptPath` resolves symlinks, checks the session filename, and confines the resolved path to the configured Claude projects root before reading. Existing traversal rejection tests remain green. |

These conditional scanner warnings were reviewed against their input guards and baseline. No unsafe new read path was found. The scan did not return an entirely empty result for those existing files.

## Visual evidence and limits

[Visual verification](verification/visual.md) records the synthetic browser matrix, screenshots, measurements, navigation, drafts, and keyboard checks. It also records the browser's smooth-animation and one failed screenshot-capture limitation. The 200% check used CSS zoom. Native browser-menu zoom and animation timing are not claimed.

The user later limited further visual feedback checks to English and browser mobile viewports. That instruction was followed. No mobile emulator ran.

Bun printed a non-fatal `directory mismatch` diagnostic for some web tsconfig overrides. Every affected process reported passing tests and exited successfully. No tests or assertions were weakened to suppress it. If this diagnostic is investigated later, reproduce it with one web spec and the same Bun version before changing the runner.

An early `bun test tests/v2-plugin-gate.test.ts` invocation matched no file. It was replaced with the real `plugin-v2-loader-contract.test.ts` and `v2-legacy-client.test.ts` files, both passing. An initial Node-package launcher could not provide its binary; the verified official archive supplied the isolated Node 24 runtime instead.

## Final assessment

All eight requirements and their scenarios have implementation and verification evidence. The archived Directory maps, heading/navigation, and release-cache work remains covered by passing regressions. Manual results and stored data stay complete. No package or lockfile change was added.

Ready for archive approval. Archiving and git actions remain unperformed.
