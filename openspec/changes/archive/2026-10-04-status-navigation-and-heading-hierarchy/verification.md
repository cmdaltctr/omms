# Verification: status-navigation-and-heading-hierarchy

## Execution scope

Worktree: `/Users/aizat/Development/PROJECTS/omms-feat-directory-map-controls`.
Branch: `feat/directory-map-controls`. Implementation starts from `00712bf`.

The user waived original tasks 3.2 and 3.3, covering synthetic browser interactions and the visual matrix. The user then approved running `bun run ci:local`. Proposal, design, and tasks record the revised execution gate. The three specification deltas retain all behaviour requirements.

No new browser checks ran. Actual browser scrolling, keyboard activation, focus visibility, calculated sizes, translated layouts, mobile widths, native zoom, and draft retention across presentation changes remain **NOT RUN**. This waiver is specific to this change. It does not reuse the archived change's waiver or establish that those browser outcomes passed.

The unfinished fixture extension was reverted after the waiver. Existing synthetic fixtures and their no-proxy boundary remain unchanged.

## Automated checks

| Check                                    | Result           | Evidence                                                                          |
| ---------------------------------------- | ---------------- | --------------------------------------------------------------------------------- |
| Changed-file Prettier formatting         | PASS             | `bunx --no-install prettier --write <changed-file>` for each changed or new file  |
| Full local CI                            | PASS             | `bun run ci:local`, exit 0; final run: `/tmp/omms-status-navigation-ci-final.log` |
| Format, lint, root type-check, and build | PASS             | Included in `ci:local`                                                            |
| Isolated full suite                      | PASS             | 259 test files; 1,722 passing tests, 0 failing, 4 skipped                         |
| Web type-check                           | PASS             | `(cd web && bun run check)`, exit 0                                               |
| Aikido scan                              | PASS             | `aikido_scan_paths`, all 29 changed/new code and test files; `issues: []`         |
| Whitespace check                         | PASS             | `git diff --check`, exit 0                                                        |
| Code graph update                        | PASS             | `graphify update .`, exit 0; code-only extraction without model calls             |
| OpenSpec strict validation               | PASS             | `openspec validate status-navigation-and-heading-hierarchy --strict`, exit 0      |
| OpenSpec verification                    | PASS with waiver | Source and scenario review below; browser evidence remains NOT RUN                |

The full gate ran in the checked feature worktree. No package was installed, no live backend was restarted, and no production API request was made for browser testing. At implementation verification, no git commit, push, archive, or pull request had been requested or performed.

### Focused tests

Every file below ran in its own Bun process. Web specs used `--tsconfig-override web/tsconfig.app.json`.

| Command                                                                                             | Result        |
| --------------------------------------------------------------------------------------------------- | ------------- |
| `bun test --tsconfig-override web/tsconfig.app.json web/tests/import-status-navigation.spec.tsx`    | PASS: 6 tests |
| `bun test --tsconfig-override web/tsconfig.app.json web/tests/automatic-import-navigation.spec.tsx` | PASS: 2 tests |
| `bun test --tsconfig-override web/tsconfig.app.json web/tests/heading-hierarchy.spec.tsx`           | PASS: 5 tests |
| `bun test --tsconfig-override web/tsconfig.app.json web/tests/visual-foundations.spec.ts`           | PASS: 4 tests |
| `bun test --tsconfig-override web/tsconfig.app.json web/tests/directory-map-controls.spec.tsx`      | PASS: 3 tests |
| `bun test --tsconfig-override web/tsconfig.app.json web/tests/sidebar-settings-tree.spec.tsx`       | PASS: 3 tests |
| `bun test --tsconfig-override web/tsconfig.app.json web/tests/dialog-focus.spec.tsx`                | PASS: 6 tests |
| `bun test tests/web-auto-settings.test.ts`                                                          | PASS: 9 tests |
| `bun test tests/web-settings-i18n.test.ts`                                                          | PASS: 4 tests |
| `bun test tests/web-directory-maps.test.ts`                                                         | PASS: 8 tests |

### Regression sensitivity

- The first run of `import-status-navigation.spec.tsx` had four failures and one pass before implementation. Missing host links, accessible names, host anchors, and the reveal helper caused the failures.
- The first run of `automatic-import-navigation.spec.tsx` had two failures before removal of duplicate pills and retargeting links. A later run exposed an incomplete test fixture: it omitted the progress `done` field. Adding synthetic progress fields made that test usable; it did not change application logic.
- The first run of `heading-hierarchy.spec.tsx` failed all four tests before the new typography roles and semantic levels were applied.
- The multilingual render test initially used React's English server snapshot. The test now supplies the current language snapshot through its hook mock. Expected Chinese and Arabic wording was corrected to match the unchanged existing translations.
- Final source review found two H4 group titles in the AI cleanup diff view whose parent is the dialog H2. A new `cleanup diff` regression failed on those headings: `/tmp/omms-status-cleanup-heading-red.log`. Both titles now use H3 and the subsection role. The heading spec passes five tests. The initial full gate passed 1,721 tests; the final gate passed 1,722 after this correction. Aikido was rerun on all 29 changed/new code files with zero findings.
- All focused tests passed after implementation and formatting. Native interaction and computed CSS outcomes remain outside these tests.

### Tool diagnostics

Bun 1.4.2 prints a non-fatal `directory mismatch` diagnostic when it loads `web/tsconfig.app.json`. Web specs and the full gate exit successfully. This message did not cause a test failure. If the diagnostic needs investigation, reproduce it with one focused web spec and report it to Bun separately; no toolchain change belongs to this frontend change.

The graph update refreshed code relationships. It advised refreshing community labels separately; no model-backed graph labelling was run.

## OpenSpec review

### Summary

| Dimension    | Assessment                                                                                                           |
| ------------ | -------------------------------------------------------------------------------------------------------------------- |
| Completeness | All 11 retained tasks verified; original 3.2 and 3.3 explicitly waived                                               |
| Correctness  | Implementation evidence found for all 4 requirements and all 21 scenarios; native browser outcomes remain unverified |
| Coherence    | Host-based links, bounded DOM reveal, shared roles, existing state ownership, and documentation follow the design    |

### Requirement mapping

| Requirement                                                | Implementation evidence                                                                                                                                                                                                                                                                                                                                                                                | Test evidence                                                                                                                                                                     |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Each host shows its import status                          | `web/src/lib/components/settings/HostImportBadges.tsx:43` passes host identity; `ImportStatusBadge.tsx:8-58` keeps badge text and informational states, with a link only for Partly imported                                                                                                                                                                                                           | `import-status-navigation.spec.tsx`; unchanged derivation tests in `tests/web-auto-settings.test.ts`                                                                              |
| The page controls automatic import                         | `web/src/lib/components/settings/AutoImportSection.tsx:102-380` retains model saving, switch, polling, actions, progress, profile batches, summaries, counts, model, cutoff, and errors; host headings at line 203 have no repeated pills; links at lines 350-358 target the host                                                                                                                      | `automatic-import-navigation.spec.tsx`; `tests/web-auto-settings.test.ts`; `tests/web-external-settings.test.ts`; `tests/web-settings-api.test.ts`; `tests/auto-backfill.test.ts` |
| Directory lists have compact expandable controls           | `web/src/lib/components/settings/DirectoryMapHost.tsx:37-59` keeps native collapsed disclosures and an empty state, with stable summary anchors; `web/src/lib/directory-map-navigation.ts:4-9` only opens the requested parent and focuses its summary; `DirectoryMapsSection.tsx:22-35` retains draft ownership                                                                                       | `import-status-navigation.spec.tsx`; `directory-map-controls.spec.tsx`; `tests/web-directory-maps.test.ts`                                                                        |
| Application headings have a semantic and visible hierarchy | `web/src/App.tsx:163,346` owns H1 and the add-memory H2; `ProfileView.tsx:236-348` uses H2/H3 without promoting category badges or preference prose; Settings titles share H2/H3 roles; `AiCleanupDialog.tsx:253,346,438` uses H3 below the dialog H2; `web/src/app.css:111-118` defines relative roles; `settings.css:5,19` uses 14px body/field sizes; `ui/dialog.tsx:110-115` uses the section role | `heading-hierarchy.spec.tsx`; `visual-foundations.spec.ts`; `sidebar-settings-tree.spec.tsx`; `dialog-focus.spec.tsx`                                                             |

The reveal helper does not call a state setter, fetch, save, or import operation. It leaves native anchor navigation enabled and uses `preventScroll: true` only for focus, so the browser supplies the anchor jump. Every link activation invokes the helper even when the fragment is unchanged. Host summaries remain mounted when their latest rows are empty.

The link names use literal product names with existing translated Settings messages for Directory maps and badge wording. English, Chinese, and Arabic rendered names pass without a translation-system change. Existing section anchors, routes, and card order remain unchanged. No memory card or Markdown renderer changed, and no global heading selector was added.

### Scenario mapping

Browser-specific parts of a scenario are NOT RUN under the waiver. The evidence below identifies code and automated coverage without claiming runtime browser verification.

| Scenario                                          | Evidence and limits                                                                                                                                                                               |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| All Claude Code history is in                     | Existing badge derivation returns Imported for a finished zero-pending, zero-unresolved run; rendered informational Imported badge is covered                                                     |
| Unresolved sessions remain                        | Rendered OpenCode badge with six unresolved sessions; existing Partly imported derivation tests                                                                                                   |
| Following an unresolved badge                     | Real host `href`, render test, shared reveal/focus helper test, and click-handler source; pointer/keyboard activation and scrolling NOT RUN                                                       |
| A badge without unresolved sessions               | Every informational state renders a span without a link, including Stopped                                                                                                                        |
| Turning automatic import off                      | Existing switch handler saves only `autoBackfill`; `tests/web-settings-api.test.ts` covers settings saving; `tests/auto-backfill.test.ts:249` covers stopping after the current exchange          |
| Choosing a backfill model for Pi                  | Exact `zai/glm-5-turbo` edit assertion in `tests/web-auto-settings.test.ts:43`; save handler unchanged                                                                                            |
| Choosing the external API for OpenCode's backfill | `tests/web-external-settings.test.ts:54` checks `backfillModelEdit("opencode", "external")`; the model option and save handler remain present                                                     |
| Watching progress                                 | Rendered progress bar and minutes-left text; unchanged polling helper and interval; live browser refresh NOT RUN                                                                                  |
| Reading automatic import without duplicate pills  | Render tests retain host names, operational details, errors, and controls; no Partly imported pill; source has no badge component call                                                            |
| Following the automatic import directory link     | All host links render the correct anchor; source invokes the same bounded reveal helper; native activation and React draft retention NOT RUN                                                      |
| Reviewing many missing folders                    | Render tests prove host and row disclosures start closed; native independent expansion NOT RUN                                                                                                    |
| Keeping edits during collapse                     | Existing draft owner and nested disclosures remain unchanged; directory helper tests retain target text and selections; actual collapse/expand draft retention NOT RUN                            |
| Navigating to a host with unsaved edits           | Navigation operates only on the requested summary and its disclosure, without touching React owners; actual cross-host draft retention NOT RUN                                                    |
| Following the same host link again                | Helper test closes and reopens the same disclosure and checks repeated focus calls; actual repeated anchor activation NOT RUN                                                                     |
| A count no longer has matching rows               | Rendered empty-state anchors for every host; missing target is handled without selecting another host; actual empty-list navigation NOT RUN                                                       |
| Reading a Settings card                           | Source roles and semantic levels pass the heading test; computed 24/18/15/14px sizes NOT RUN                                                                                                      |
| Reading the Profile outline                       | Rendered identity and top-level sections are H2; workflow title is H3; categories and preference descriptions keep metadata/prose roles                                                           |
| Reading the memory explorer                       | One application H1 and the add-memory H2 share the approved roles; memory card and Markdown sources unchanged; computed content rendering NOT RUN                                                 |
| Opening a dialog after the typography change      | Shared Radix title retains its heading primitive and uses the section role; connected-opener and consumer focus tests pass; computed size and native focus trapping NOT RUN                       |
| Translated headings on a narrow screen            | Heading owners retain wrapping and direction support; browser translation layout, overflow, and shaping NOT RUN                                                                                   |
| Zooming and changing presentation with a draft    | Theme/language stores, route owners, and draft owners unchanged; existing focus test retains the opener after prop/language rerender; native zoom and presentation-change draft retention NOT RUN |

### Findings and next action

- **CRITICAL:** none remaining after correcting the cleanup diff headings.
- **WARNING:** browser interaction and layout evidence is absent under the user's explicit waiver. Preserve these NOT RUN results when archiving. Run the waived checks if runtime evidence is required later.
- The helper unit test establishes reveal/focus behaviour with a synthetic DOM-shaped object. It does not mount the full React settings page or prove real draft retention. The static polling assertion does not prove a live timer refresh; existing polling tests and unchanged source provide separate evidence.

The implementation met the revised archive gate with the browser waiver recorded.

## Archive record

On 4 October 2026, the user requested archive and selected sync and archive. The four changed requirements and all 21 delta scenarios were synced into `import-directory-maps`, `web-settings`, and `web-visual-design`. Comparison confirmed that the three purposes and all unrelated requirement blocks remain unchanged. `openspec validate --specs --strict` passed all 27 main specifications; strict change validation passed before the move.

The complete change, including `.openspec.yaml`, tasks, and this verification record, moved to `openspec/changes/archive/2026-10-04-status-navigation-and-heading-hierarchy/`. Original tasks 3.2 and 3.3 remain waived and NOT RUN. No commit, push, or pull request was made.
