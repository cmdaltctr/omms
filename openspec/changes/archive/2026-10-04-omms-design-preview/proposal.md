# Proposal

## Why

OMMS's current green terminal palette and global monospace font differ from the selected OpenChamber-inspired guidance. This isolated trial will apply that guidance across existing screens and verify readability without changing how users complete tasks.

## What Changes

- Apply the canonical warm light/dark palette through existing semantic CSS variables.
- Use the system sans-serif stack for UI text. Retain JetBrains Mono for code, commands, identifiers, and paths.
- Update shared buttons, inputs, textareas, selects, and related control states. Use tinted primary actions and neutral navigation selection.
- Adjust presentation in the existing sidebar, settings rows, memory/profile content, and dialogs only where needed for the shared foundations and controls.
- Preserve routes, navigation, sidebar dimensions and breakpoints, section order, visible wording and casing, helpers, warnings, validation, save timing, API calls, and destructive confirmations.
- Keep the existing theme store, preference keys, legacy migration, translation systems, Arabic document direction, Radix primitives, and Lucide icons.
- Translate the shared dialog's existing accessible close label and use logical end positioning. The user also approved correcting the existing controlled-dialog focus-return defect during verification. Restore a connected opener while preserving consumer focus handlers.
- Prepare an isolated, synthetic-data Vite preview for matched before/after evidence. Disable live API proxying in that preview configuration only.
- Preserve the canonical guidance's attribution. The user confirmed that `main` already contains the OpenChamber MIT notice; do not duplicate it in this trial.

No screen restructuring, task-flow changes, new theme engine, icon pipeline, dependencies, backend changes, or unrelated cleanup are included. Ask for approval before any structural or behavioural change.

## Capabilities

### New Capabilities

- `web-visual-design`: Warm semantic themes, system UI typography, shared control presentation, and safe verification across existing OMMS screens.

### Modified Capabilities

None. Existing `web-settings` and `web-language-selection` requirements remain unchanged. Their navigation, saving, confirmation, and language-selection scenarios constrain this trial.

## Impact

- Worktree: `/Users/aizat/Development/PROJECTS/omms-feat-omms-design-preview`, branch `feat/omms-design-preview`, based on `feat/omms-design-skill` at `059da2d`.
- The source checkout was clean on `main` at `e73e068`; the canonical skill was already tracked. Only `.agents/skills/omms-design/` was copied. `.claude/skills/omms-design` is the requested relative symlink.
- Main owners: `web/src/app.css`, existing primitives under `web/src/lib/components/ui/`, `AppSidebar.tsx`, and existing settings presentation. Limited class changes in `App.tsx`, memory/profile owners, and dialog callers may remove conflicting presentation or retain technical-text typography.
- Verification support may add a test-only Vite configuration and synthetic fixtures under `web/tests/`. Normal Vite proxying and runtime API clients remain unchanged.
- Documentation: `docs/web-ui.md` and a focused trial verification record with screenshot references. No duplicate licence-notice file is planned.
- No changes to `src/` backend code, package manifests, lockfiles, credentials, databases, or memory stores.
- The user accepts browser mobile-viewport checks for task 5.3 and waived physical-device and emulator testing. Actual software-keyboard behaviour remains NOT RUN.
- The user approved implementation through `/opsx-apply` and separately authorised root/web frozen-lockfile installs. They subsequently authorised commit, push through a PR to `main`, local CI, and GitHub checks. They approved syncing the eight design requirements, archiving the change, and including the existing local-main attribution commits. ADR-022 records the shared-owner design decision. Live-data operations require separate permission.
