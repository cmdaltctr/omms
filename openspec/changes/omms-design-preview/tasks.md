# Tasks

## 1. Approval and isolated verification setup

- [x] 1.1 Obtain explicit proposal approval and start the apply workflow. Verify the recorded approval precedes every UI or fixture code edit.
- [x] 1.2 Confirm the worktree root, branch, and untouched source checkout. Request permission for root and web frozen-lockfile installs; verify no `.env`, credentials, stores, or outputs are copied.
- [x] 1.3 Add test-only Vite configuration and deterministic fixtures for explorer, profile, settings, and dialog entry. Verify both dev and preview have no live API proxy; unknown requests fail closed and declared mutations remain in memory.
- [x] 1.4 Start the fixture UI through the existing Vite script on a distinct loopback origin. Verify loaded module paths identify this checkout and request logs contain only synthetic API handling.
- [x] 1.5 Capture the unchanged UI baseline for the representative screens with matching fixture state, themes, languages, and widths. Verify screenshots contain no private content and retain a capture manifest for comparison.

## 2. Focused test coverage

- [x] 2.1 Delegate focused tests to a-test for shared control contracts, translated dialog close labels, preference migration, and fixture isolation. Verify scenario coverage against `specs/web-visual-design/spec.md` and retain existing Bun conventions without installing a test framework.
- [x] 2.2 Confirm new tests detect the intended missing or deliberately broken implementation. Run each file in a separate Bun process and record failing evidence before the relevant implementation; restore deliberate mutations immediately.

## 3. Shared foundations and controls

- [x] 3.1 Update `web/src/app.css` with the selected light/dark palette, semantic aliases, separate tinted labels, and opaque focus role. Verify token completeness and computed contrast on actual backgrounds in both themes.
- [x] 3.2 Apply system sans-serif UI typography and reusable text roles while retaining JetBrains Mono for technical values and markdown line height. Verify browser font styles, Arabic shaping, Chinese wrapping, and long path/code fixtures.
- [x] 3.3 Update button variants and sizes in their shared owner, preserving props and semantics. Verify default/small/large dimensions and primary, neutral, destructive, disabled, invalid, hover, pressed, and focus states.
- [x] 3.4 Update shared Input, Textarea, and Select appearance. Verify fills, boundaries, selection, focus, invalid state, option/value events, keyboard selection, and unchanged form callbacks.
- [x] 3.5 Adapt related checkbox, label, badge, alert, and tooltip presentation only where needed. Verify existing semantics, status text/icons, solid-fill foregrounds, and visible warnings remain intact.

## 4. Existing screen integration

- [x] 4.1 Adjust sidebar row, footer, and language-menu classes without changing dimensions or event handling. Verify desktop collapse, mobile dismissal, section anchors, neutral selection, keyboard navigation, and 44px narrow navigation touch height.
- [x] 4.2 Apply consistent presentation to existing settings fields and raw buttons at shared owners. Remove conflicting local styles and the global primary-colour hover override; verify section order, helpers, warnings, validation, save timing, and destructive confirmation contracts against fixture requests.
- [x] 4.3 Make only necessary class changes in explorer/profile owners and `App.tsx` for shared control fit and technical typography. Verify route composition, memory selection, content grouping, action callbacks, and language-triggered reloads remain unchanged.
- [x] 4.4 Style shared dialogs and translate the existing accessible close label through all three dictionaries. Apply the separately approved focus-return correction with a failing regression test, honour consumer focus handlers, and restore only a connected opener. Verify logical close placement, constrained-height scrolling, Save/Cancel semantics, Escape, focus trap, and focus return without changing dialog structure.

## 5. Focused and browser verification

- [x] 5.1 Run `bun --cwd web run check` and relevant focused Bun files, one process per file. Include language-menu, settings-tree, affected settings/power tests, and new tests; record exact commands and results.
- [x] 5.2 Inspect all representative screens in English light/dark at 1280px, 768px, and 390px, Arabic light/dark at 1280px and 390px, and Chinese light/dark at 390px, each at 800px height. Verify contrast, wrapping, overflow, visible warnings, and required interaction states.
- [x] 5.3 Check touched controls/dialogs at 320px and 200% browser zoom, reduced motion, long technical values, and constrained height. Use browser mobile-viewport checks as the user-approved completion criterion; record actual software-keyboard behaviour separately.

  Browser checks pass in `docs/design-preview/{zoom200,narrow-reduced-motion,control-states,technical-fields}.json`. The narrow matrix covers 24 cases at 320×480 with no horizontal overflow. Reduced motion passes in `control-states.json`; it was false in the narrow matrix. Actual mobile keyboard reachability remains NOT RUN. The user waived physical-device and emulator testing and accepted browser mobile-viewport verification for completion.

- [x] 5.4 Verify keyboard menu/dialog interactions and route, sidebar, selected item, unsaved memory draft, and unsaved settings values through theme/language updates. Use existing store updates for an open modal; verify no remount and no additional UI controls.
- [x] 5.5 Verify theme/language persistence, legacy migration precedence, and sidebar/tree persistence after reload on the isolated origin. Confirm no request reached the shared backend or real stores.
- [x] 5.6 Capture matched after screenshots for every recorded baseline case. Include the main changed screen in both themes and Arabic narrow layout; verify matching data, widths, and language and record computed token/font evidence.

## 6. Documentation and completion

- [x] 6.1 Delegate the matching web UI guide update to a-docs. Verify the guide describes the trial and preserve the canonical skill's attribution unchanged; the existing notice on `main` covers it, as confirmed by the user.
- [x] 6.2 Delegate a bounded behaviour-preserving cleanup pass to a-refactor after focused tests pass. Verify it changes only trial presentation and rerun affected files separately; resolve any test failure before continuing.
- [x] 6.3 Run the OpenSpec verify workflow and strict validation. Verify every requirement has source or runtime evidence and leave any missing check explicitly unfinished.
- [x] 6.4 Report worktree, branch, approval status, files, exact command results, screenshots, and remaining concerns. Verify no commit, push, PR, merge, archive, full suite, install, or live-data operation occurred without its required permission; stop after this trial.
