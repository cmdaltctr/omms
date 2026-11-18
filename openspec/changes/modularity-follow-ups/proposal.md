# Proposal: modularity follow-ups

## Why

The `modular-boundaries` change (PR #288, 2026-11-17) fixed host identity, but it left four large refactors for later. `tests/modularity-ratchets.test.ts` and `tests/file-size-ceiling.test.ts` stop this debt from growing, but they do not remove it. This change records the four refactors so they are not forgotten. Each one lands as its own pull request.

## What Changes

No user-visible behaviour changes. Each part is a pure refactor, protected by characterisation tests that are written first.

1. **Storage port.** Code outside `src/services/turso/` imports libSQL directly (51 files, 137 import sites). It also writes raw SQL (49 files, 311 sites). Move the memory, prompt, profile, ledger and skill stores behind one storage folder, and move the SQL behind them. About 69 files overlap.
2. **Pass config in.** 52 files in `src/core/` and `src/services/` import the global `CONFIG` (62 import sites). This breaks the project rule in `CLAUDE.md` ("do not import `CONFIG` there"). Pass the values in as arguments, following the pattern in `src/services/ai/live-model-choice.ts`.
3. **OpenCode profile learning on the shared path.** `src/adapters/opencode/profile-learning.ts` (824 lines) has its own analysis loop. Pi and Claude Code already use `src/core/profile-analysis.ts`. Move OpenCode onto the shared path and keep only the host model wiring in the adapter. About 6 files change.
4. **Split the three largest files.** These are `src/services/user-profile/user-profile-manager.ts` (1,947 lines), `src/services/web-server.ts` (1,790) and `src/services/api-handlers.ts` (1,183). Split each file by responsibility into files of 500 lines or fewer, and remove its entry from `tests/file-size-ceiling.test.ts`. About 15 files change.

Order: 4 first, then 3, then 2, then 1. The early parts are small and make the later ones easier. The storage port touches the most files, so it goes last.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. All four parts are refactors with no change to specified behaviour, so `.openspec.yaml` sets `skip_specs: true`.

## Impact

- **Code:** `src/services/`, `src/core/`, `src/importer/`, `src/adapters/opencode/`. Exact files are listed per part in `design.md`.
- **Tests:** the baselines in `tests/modularity-ratchets.test.ts` and `tests/file-size-ceiling.test.ts` shrink with each pull request. Tests that stub `../src/config.js` with `mock.module` need fewer stubs after part 2.
- **Release:** commits use `refactor:`, which release-please hides from the changelog. No release starts from this work alone.
- **Risk:** part 1 touches every store. A mistake there can lose or corrupt data with no warning. Each store moves in its own pull request, after characterisation tests that cover reads, writes and space switches (`resettable()`).
