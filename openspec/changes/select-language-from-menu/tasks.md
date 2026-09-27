# Tasks

## 1. Behaviour tests

- [x] 1.1 Add a focused test for menu opening without a language change; confirm it fails against the current sidebar.
- [x] 1.2 Add tests for EN/ZH/AR display, explicit selection, saved preference, keyboard dismissal, and Arabic direction; confirm each catches missing behaviour.

## 2. Web UI

- [x] 2.1 Replace the cycling sidebar action with a compact code trigger and upward menu; verify the focused menu tests pass.
- [x] 2.2 Connect menu selection to `setLanguage` and existing data refresh, with accessible selection and dismissal; verify the focused interaction tests pass.
- [x] 2.3 Update `docs/web-ui.md` with the language menu instructions; verify the instructions match the UI.

## 3. Verification

- [x] 3.1 Run focused tests and `bun run check` from the feature worktree; verify they pass.
- [x] 3.2 Inspect mobile and right-to-left menu placement and keyboard use; verify options remain reachable without changing language on dismissal.
