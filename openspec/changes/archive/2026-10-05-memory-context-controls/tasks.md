# Tasks

All tasks are for the approved implementation phase. Keep them unchecked during proposal creation. Use temporary HOME, config files, and stores for verification; leave the real OMMS config and memory store unchanged. Obtain permission before installing dependencies or running the full test suite.

Implementation baseline: `features-fixes` at `1997c05`, already merged into this worktree. Preserve the archived directory-map controls and status-navigation/heading work. The release cache fix is also present and needs no reimplementation.

## 1. File configuration and validation

- [x] 1.1 Add focused tests for the five defaults, accepted boundaries, invalid types, fractions, missing values, and project overrides. Confirm new assertions fail on the current code.
- [x] 1.2 Add `retrievalMaxTokens` and validate all five limits through the config builder and Settings path. Verify the focused config tests pass with unchanged existing defaults.
- [x] 1.3 Add all five controls and their effects to the generated config template. Verify the template parses and `chatMessage.maxMemories` remains nested.
- [x] 1.4 Test valid and invalid hand edits during live operation, including a project `chatMessage` object with a missing count. Verify last-good config retention and existing shallow-merge behaviour.

## 2. Safe Settings reads and writes

- [x] 2.1 Add failing Settings tests for values, defaults, effective sources, global values, and the nested `chatMessage.maxMemories` field. Verify the tests fail before implementation.
- [x] 2.2 Expose the five fields in the Settings snapshot and permit only their named edits through the existing writer. Verify snapshot tests and allowed-value saves pass.
- [x] 2.3 Map the nested request identifier to the JSONC leaf path. Verify saves preserve sibling values, comments, unrelated keys, and key order, both with and without an existing `chatMessage` object.
- [x] 2.4 Cover invalid and unsupported edits, stale revisions, legacy-only config migration, JSON/origin/auth checks, and shared revision refresh. Verify rejection leaves files unchanged and a save on another card works afterwards.

## 3. Shared automatic context budget

- [x] 3.1 Add failing tests for the estimate, small inputs, oversized memories, profile allocation, restored-memory formatting, final wrapper overhead, and Unicode boundaries. Confirm each new behaviour fails on current code.
- [x] 3.2 Implement the pure shared packing helper and use it in normal and compaction formatters. Verify final emitted bytes never exceed `retrievalMaxTokens * 4` and generated delimiters remain closed.
- [x] 3.3 Verify packing preserves incoming order, shortens the first oversized entry, gives the profile at most one quarter of payload space, and reallocates unused profile space. Run focused formatter tests with deterministic fixtures.
- [x] 3.4 Verify full stored memory and profile content remain unchanged and manual tool/CLI search results stay complete. Run focused shared memory-operation tests.

## 4. Host integration and OpenCode profile bytes

- [x] 4.1 Refresh and snapshot limits before supported injection operations in OpenCode V1, OpenCode V2, Pi, and Claude Code. Verify host tests cover retrieval, recent-memory injection, and compaction/resume paths without changing their timing.
- [x] 4.2 Cover a config change during asynchronous retrieval and requests with multiple OMMS sections. Verify each request retains its original total budget, and the next request uses the new value.
- [x] 4.3 Verify Claude Code respects both the shared budget and its existing hook limit, with a closed retrieval tag. Run focused Claude retrieval and hook-client tests.
- [x] 4.4 Add an OpenCode profile-input regression test with Chinese, Arabic, and emoji text. Confirm it fails on the character limiter, then use UTF-8 truncation with its marker inside the ceiling and verify the test passes.
- [x] 4.5 Run focused host-boundary and plugin-bundle tests. Verify shared code imports no adapter or host SDK and the change adds no dependency.

## 5. Memory card and sidebar navigation

- [x] 5.1 Add failing UI tests for the five editable rows, visible Affects text, defaults, units, labels, and project overrides. Confirm the tests fail without the Memory card.
- [x] 5.2 Add the Memory card using existing table styles, controls, and the integrated H2/H3 typography roles. Verify its Save/Cancel, validation, busy state, failure feedback, draft handling, shared snapshot behaviour, and heading outline through focused UI tests.
- [x] 5.3 Register Memory after Models in the shared Settings list and composition. Update count-sensitive sidebar tests and verify a unique `/settings#settings-section-memory` link.
- [x] 5.4 Verify navigation from another view, direct hash load, reload, desktop collapse, and mobile drawer dismissal. Preserve the integrated host-specific Directory maps links, disclosure focus, and unsaved targets/selections. Add the smallest Memory anchor-handling change needed without repurposing `revealDirectoryMaps`; confirm the new navigation test fails when that handling is removed.
- [x] 5.5 Add English, Chinese, and Arabic strings for all new visible and accessible messages. Run localisation tests and verify each message exists without English fallback.
- [x] 5.6 Inspect the rendered card in both themes, all three languages, narrow and desktop widths, keyboard navigation, and 200% zoom. Verify table overflow stays within the card and technical identifiers remain readable; record screenshots and findings.

## 6. Documentation and final verification

- [x] 6.1 Update `docs/configuration.md` and `docs/web-ui-settings.md` with the table, file-only example, nested key, ranges, host effects, estimate, and next-operation behaviour. Verify every documented default against config tests.
- [x] 6.2 Record the OpenCode character-versus-byte correction in the next available TDR (033 at this baseline; 032 records the release cache fix) and add it to the folder index. Verify the record names the regression test and includes its execution evidence.
- [x] 6.3 Run formatting, `bun run check`, strict OpenSpec validation, and the focused backend/UI/host tests in this worktree. Include `web/tests/import-status-navigation.spec.tsx`, `automatic-import-navigation.spec.tsx`, `directory-map-controls.spec.tsx`, `heading-hierarchy.spec.tsx`, and `sidebar-settings-tree.spec.tsx`, each in its own process with the web tsconfig override, plus `bun test tests/release-approve.test.ts`. Verify each command passes and record its result.
- [x] 6.4 Obtain approval for the full suite, then run `bun run ci:local` in this worktree. Verify the full gate passes without using one-process `bun test` for the suite.
- [x] 6.5 Run `openspec-verify-change` against both delta specs, tasks, and design. Resolve every finding and record the verification report before requesting archive approval.
