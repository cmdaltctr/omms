# Tasks

## 1. Pill state

- [x] 1.1 Add `pillView(job, checked)` to `ai-cleanup-job-state.ts`, with tests in `tests/ai-cleanup-job-state.test.ts` for running, done, failed, not read yet and no job. Verify the new tests fail before the function exists and pass after.
- [x] 1.2 Add a `checked` flag to `useAiCleanupJob` that turns true after the first successful status read. Verify with `bun run check`.

## 2. Minimise and pill UI

- [x] 2.1 Add `aiCleanupMinimised` to `useUserProfile`. Opening the dialog clears it. Verify with `bun run check`.
- [x] 2.2 Add a Minimise button to the AI Cleanup dialog header while a job runs. It closes the dialog and sets the minimised flag. Verify in the browser that the job keeps running.
- [x] 2.3 Add the `AiCleanupPill` component, mount it in `App.tsx` while minimised. Show progress, ready and failed states. Selecting it opens the dialog. Remove it when no job exists. Verify in the browser at 1280 px and 390 px.
- [x] 2.4 Add the new strings to every locale in `translations.ts`. Verify with `tests/web-translations-parity.test.ts`.

## 3. Docs and gate

- [x] 3.1 Update the AI Cleanup steps in `docs/web-ui.md`. Verify by reading the section.
- [x] 3.2 Run `bun run ci:local` and `openspec validate minimise-ai-cleanup --strict`. Both pass.

## Workflow follow-up

- Archive the change before the pull request.
