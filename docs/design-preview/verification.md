# OpenSpec verification: omms-design-preview

Status: **COMPLETE under the user-approved browser verification scope**.

## Scope and approval

The user approved `/opsx-apply` for this trial and frozen-lockfile installs. They separately approved the shared-dialog focus correction. The implementation is prepared on `feat/omms-design-preview`, based on `059da2d`, in `/Users/aizat/Development/PROJECTS/omms-feat-omms-design-preview`.

The source checkout remains clean on `main` at `e73e068`. Package manifests and lockfiles have no changes. The copied canonical skill matches the source byte for byte. Its Claude symlink remains intact. The existing source licence notice was left unchanged.

## Scorecard

| Dimension         | Result                                                                                       |
| ----------------- | -------------------------------------------------------------------------------------------- |
| Completeness      | 26/26 tasks; task 5.3 uses user-approved browser verification                                |
| Correctness       | All 8 requirements have implementation and runtime or focused-test evidence                  |
| Scenario coverage | All 17 specification scenarios have evidence below                                           |
| Coherence         | Existing visual owners and state stores retained; focus correction follows separate approval |
| Device validation | Software-keyboard reachability: NOT RUN; user waived device and emulator checks              |

## Requirement and scenario mapping

Paths below are relative to the repository root unless they link to evidence in this directory.

| Requirement                                | Source evidence                                                                                                          | Scenario evidence                                                                                                                                                                                                                          | Result                                                      |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| Selected warm themes                       | `web/src/app.css:8-104`; shared UI primitives; sidebar semantic classes                                                  | Opening every representative screen: [after matrix](after-matrix.json), [final settings](final-settings-matrix.json), [final dialogs](final-dialog-matrix.json)                                                                            | PASS                                                        |
| Readable UI and technical typography       | `web/src/app.css:107-115,188-219`; scoped settings technical fields; memory/profile classes                              | Mixed prose, code, and paths; Arabic and Chinese typography: all matrix captures, [technical fields](technical-fields.json)                                                                                                                | PASS                                                        |
| Shared control contracts and states        | `web/src/lib/components/ui/`; `settings/settings.css`; preserved caller callbacks                                        | Primary/destructive and neutral hover; form submission; keyboard/disabled states: [19 control checks](control-states.json), [settings saves](settings-interactions.json), focused tests                                                    | PASS                                                        |
| Preserved screen structure and task flows  | Existing `App.tsx` composition, `SETTINGS_SECTIONS`, sidebar handlers, and memory/profile state owners                   | Navigation: [mobile sidebar](mobile-sidebar.json), desktop persistence evidence. Warnings/confirmations: [settings interactions](settings-interactions.json), existing settings and power tests                                            | PASS                                                        |
| Compatible theme/language preferences      | Unchanged `theme.ts`, `preferences.ts`, `i18n/index.ts`; existing `App.tsx` reload effects                               | Reload, legacy precedence, and open drafts: [migration](preference-migration.json), sidebar persistence files, [memory interactions](memory-interactions.json), [settings interactions](settings-interactions.json)                        | PASS                                                        |
| Accessible dialogs in supported directions | `web/src/lib/components/ui/dialog.tsx:40-88`; translated close keys; logical end placement; plaintext textarea direction | Keyboard editing: [memory interactions](memory-interactions.json), six focus regression tests. Arabic narrow: [final dialog matrix](final-dialog-matrix.json) and 320px captures                                                           | PASS for desktop/browser checks                             |
| Legible visual matrix                      | Semantic labels, opaque ring, stronger field borders, wrapping, dialog scrolling, reduced-motion CSS                     | Narrow translations: 60 after cases plus final refreshes. Focus/contrast/reduced motion: [control checks](control-states.json). Additional 320px and native 200% checks: [narrow matrix](narrow-reduced-motion.json), [zoom](zoom200.json) | PASS for tested browser conditions; mobile keyboard NOT RUN |
| Isolated synthetic verification            | `web/tests/visual/vite.config.ts`, `fixtures.ts`, `settings-fixtures.ts`                                                 | Unknown API requests: fixture tests return 404/405 without forwarding. Comparison: 60 before/60 after captures, recorded viewports and loaded worktree CSS paths                                                                           | PASS                                                        |

Computed text checks use rendered background composites. Disabled text is excluded from the contrast target. The evidence does not establish every possible application state or every screenshot pixel.

The 320px matrix resets media emulation and reports reduced motion as false. Reduced-motion evidence comes from the separate control runner, which confirms the browser media feature and computed durations.

Full-page baseline settings images include original horizontal overflow. Their pixel widths can exceed the viewport. The before/after browser viewport widths and languages match. Final dialog, settings, and [menu](final-menu-matrix.json) captures supersede their initial after captures.

## Commands and results

- `bun run check`: PASS, including formatting, lint with zero warnings, and root type-check.
- `bun run --cwd web check`: PASS.
- `bun test --tsconfig-override web/tsconfig.app.json ./web/tests/<file>`: PASS for 14 separate files, **73 passed, 0 failed**. [The evidence guide](README.md#focused-checks) lists each file and count.
- `node web/tests/visual/check-control-states.mjs`, with the existing external Puppeteer module and an isolated Chrome profile: PASS, **19 checks, 0 failures**. The runner blocks non-fixture HTTP requests.
- `openspec validate omms-design-preview --strict`: PASS.
- `git diff --check`: PASS.

Initial failures remain documented. The Bun alias failure was a command configuration issue. Formatting and an unused runner argument were corrected. Six browser failures came from harness layering and an incorrect neutral-button expectation. The earlier dialog focus failure was a confirmed base defect; its separately approved correction passed six regression tests and browser keyboard checks.

## Task 5.3 acceptance revision

The user accepted browser mobile-viewport checks and waived physical-device and emulator testing. Task 5.3 is complete under this revised criterion. Actual software-keyboard reachability remains **NOT RUN** and is no longer a completion blocker.

The completion review inspected existing evidence:

- `narrow-reduced-motion.json`: 24 cases at 320×480, no horizontal overflow, and Save within the viewport in all six translated light/dark dialog cases.
- `zoom200.json`: Arabic dialogs at native 200% browser zoom, with a 640×400 CSS viewport, visible Save, and dialog scrolling in both themes.
- `screenshots/zoom200-ar-dark-dialog.png`: Save and Cancel visible. At 320px, the unscrolled screenshot clips Cancel at the dialog edge; viewport fit for both actions is not claimed.
- `memory-interactions.json`: Tab reaches Cancel and Save within the dialog; Cancel closes without mutations and Save sends the synthetic draft.
- `control-states.json`: 19 passing checks, including reduced motion. `technical-fields.json` records readable monospace fields and left-to-right technical values in Arabic.

This review reused the recorded browser runs. It did not rerun browser or Bun tests, launch a preview, expose a network service, or change implementation code. The specification's browser requirements are unchanged; proposal, design, and task records now include the user's waiver. Archiving still requires a separate user request.

## Merge preparation

The user subsequently authorised commit, push through a pull request to `main`, local CI, and GitHub checks. `bun run ci:local` passed, including formatting, lint, type-check, build, and every test file in its own process. The first attempt stopped at formatting in this file; formatting it resolved the failure. Bun printed non-failing tsconfig directory-mismatch diagnostics during web tests.

This result covers the trial before integration with newer `main` commits. Rerun local CI before pushing the integrated branch. GitHub checks are **NOT RUN** while the sync/archive choice is pending.

Live-data checks, security audit, and code audit remain **NOT RUN**. No release or real-backend restart occurred. Installs were limited to the explicitly authorised frozen-lockfile commands.
