# Verification: directory-map-controls

Date: 4 October 2026. Schema: spec-driven.

## Assessment

| Dimension    | Result                                                                                                             |
| ------------ | ------------------------------------------------------------------------------------------------------------------ |
| Completeness | 9/9 retained tasks complete. Task 3.2 was waived by the user on 4 October 2026.                                    |
| Correctness  | All three requirements have implementation and scenario evidence. Keyboard behaviour remains unverified.           |
| Coherence    | Native disclosures, shared draft ownership, explicit saving, and existing settings translations follow the design. |

**Ready for archive with the user's verification waiver.** On 4 October 2026, the user said task 3.2 could be skipped and requested spec sync, archive, and commit. The remaining browser checks below stay unverified; the waiver does not change the specified behaviour. The implementation and required automated checks pass. No code changed when recording the waiver.

## Requirement evidence

- **Compact expandable controls:** `web/src/lib/components/settings/DirectoryMapHost.tsx:37` and `:128` use initially closed native disclosures. Their summaries show counts and targets. Checkbox and toolbar controls sit outside summaries. `DirectoryMapsSection.tsx:18` owns drafts, so collapse keeps inputs mounted and selections shared. The section anchor remains at `:100`; Save maps stays outside host disclosures.
- **Bulk selection:** `web/src/lib/directory-maps.ts:41` uses edited targets before suggestions, excludes empty or whitespace-only targets and the no-directory sentinel, and retains source keys. `:57` clears selections without clearing target text. `DirectoryMapsSection.tsx:154` and `:155` only update drafts. Existing revision-checked saving remains at `:80`.
- **Suggestion feedback:** `web/src/lib/directory-maps.ts:12` counts newly selected suggestions, accepted rows, and rows without suggestions. Already selected and no-suggestion counts can overlap for manually accepted rows. Accepted targets remain unchanged. `DirectoryMapHost.tsx:82` renders translated results in a polite status region beside the toolbar. It explains zero selections and reminds users to save when maps are selected.

All six specification scenarios have evidence in `tests/web-directory-maps.test.ts`, `web/tests/directory-map-controls.spec.tsx`, and the synthetic browser checks in `web/tests/visual/directory-map-checks.ts`.

## Command results

| Command or check                                                                               | Result                                                                                                                             |
| ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `bun install --frozen-lockfile`                                                                | PASS in the verified feature worktree.                                                                                             |
| `(cd web && bun install --frozen-lockfile)`                                                    | PASS. No dependency or lockfile changes.                                                                                           |
| `openspec validate directory-map-controls --strict`                                            | PASS before implementation and after code changes.                                                                                 |
| `bun test tests/web-directory-maps.test.ts`                                                    | PASS: 8 tests, 28 assertions.                                                                                                      |
| `bun test tests/web-settings-i18n.test.ts`                                                     | PASS: 4 tests. Covers every literal settings label's Chinese and Arabic translations.                                              |
| `bun test --tsconfig-override web/tsconfig.app.json web/tests/directory-map-controls.spec.tsx` | PASS: 3 tests, 22 assertions. Bun prints a directory-mismatch diagnostic, then exits successfully.                                 |
| `(cd web && bun run check)`                                                                    | Initially FAIL: duplicate translation keys. Removed the duplicate additions and reused existing translations. Subsequent run PASS. |
| `bun --cwd web run check`                                                                      | Printed Bun usage instead of running the check. Replaced with the explicit subshell command above.                                 |
| Aikido `aikido_scan_paths`                                                                     | PASS: eight changed code files, zero findings.                                                                                     |
| `git diff --check`                                                                             | PASS.                                                                                                                              |
| `graphify update .`                                                                            | PASS: code graph refreshed without model calls. Community names changed; semantic relabelling was not run.                         |

### Failure-detection evidence

- Helper tests first failed because bulk helpers were absent. Log: `/tmp/omms-directory-red.log`.
- UI tests first failed because the host component was absent. Log: `/tmp/omms-ui-red.log`.
- Deliberately opening hosts and removing the status role caused two UI tests to fail. Restored the implementation. Log: `/tmp/omms-ui-mutation.log`.
- Breaking helper selection, clearing, and repeated-click counts caused tests to fail. Restored the implementation. Log: `/tmp/omms-directory-helper-mutation.log`.
- A new toolbar-wrapping assertion failed before the narrow-layout fix. It passed after applying wrapping. Log: `/tmp/omms-directory-wrap-red.log`.
- Counting an accepted manual target as already selected failed before the count correction, then passed. Log: `/tmp/omms-directory-count-red.log`.

### Full CI history

1. `/tmp/omms-directory-ci.log`: BLOCKED by the execution tool's 120-second limit. The run stopped mid-suite.
2. `/tmp/omms-directory-ci-complete.log`: PASS with a longer limit.
3. `/tmp/omms-directory-ci-final.log`: FAIL at Prettier after the feedback wording changed. No tests ran.
4. `/tmp/omms-directory-ci-formatted.log`: PASS after formatting the affected component. Exit 0; 1,709 passing tests, zero failures, 256 isolated test files. Includes formatting, lint, typechecks, and builds.

The failed formatting run remains recorded. Tests were not retried unchanged to hide failures.

## Browser evidence

Used `bun run dev --config tests/visual/vite.config.ts` from `web/`, serving `http://127.0.0.1:5179/settings`. Fixture middleware has no live API proxy. Computed stylesheet paths confirmed this worktree. No production settings or memory stores were changed.

The fixture includes 32 Pi directories, an unknown-directory entry, a source shared with OpenCode, and a Claude Code row without a suggestion.

### PASS

- Thirteen interaction assertions cover initial collapse, independent host expansion, bulk selection, explicitly emptied targets, manual edits, clearing, shared-source updates, repeated Smart resolve, and missing suggestions.
- Targets and selections survive host and row collapse.
- Draft actions leave saved fixture configuration unchanged.
- Save maps remains reachable and enabled with all hosts closed.
- Sixteen layout cases: English light/dark at 1280, 768, 390, and 320px; Arabic light/dark at 1280, 390, and 320px; Chinese light/dark at 390px. Height: 800px.
- Each case retained the manually edited target and 32 selected rows across language/theme changes. Paths retained left-to-right direction in Arabic.
- No checked control crossed viewport bounds or overflowed its button after the wrapping fix. Arabic at 320px initially overflowed the bulk button and prompted the regression fix.
- Final computed text-contrast probes reported no failures for text matching the Directory maps section. These probes do not establish control-boundary or focus contrast.
- Inspected final English desktop screenshots in both themes and Arabic dark at 390px. Labels and fields remain legible.

Screenshot and measurement evidence is temporary, under `/tmp/omms-directory-browser/`:

- `matrix-final.json`
- `en-light-1280-final.png`
- `en-dark-1280-final.png`
- `ar-dark-390-final.png`

Interaction results: `/tmp/omms-directory-browser-interactions-final.json`.

### BLOCKED / NOT RUN

- **Keyboard:** Orca's Enter and Space commands reported success but did not toggle a focused native summary. Keyboard navigation and focus visibility require a browser with working native keyboard input. This does not establish an application bug.
- **Native 200% browser zoom:** NOT RUN. Viewport resizing alone does not verify browser zoom.
- **Before screenshots:** NOT RUN. Only after screenshots were captured.
- **Hover, focus, disabled/error visual states, control-boundary contrast, and persistence after reload:** NOT RUN as a complete matrix.
- **Motion:** the embedded browser produced mixed transition colours during initial theme probes. Final layout and contrast measurements disabled transitions in the test page. Native reduced-motion preference behaviour remains unverified.

### User waiver of task 3.2

The user accepted the completed browser evidence and waived the remaining checks on 4 October 2026. They are excluded from this change's archive gate. The BLOCKED / NOT RUN results above remain unchanged.

OpenSpec verification was repeated against the revised plan: the three requirements and six scenarios retain their implementation evidence, nine retained tasks are complete, and no blocking plan gaps remain. Keyboard and native 200% zoom behaviour were not verified at runtime.
