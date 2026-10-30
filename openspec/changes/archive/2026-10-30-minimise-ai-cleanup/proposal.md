# Proposal

## Why

AI Cleanup can run for many minutes. The dialog says the user can close it, but after a close the page shows nothing about the run, so the user cannot see that it is still working without opening the dialog again. Users keep the dialog open and wait instead of using the page.

## What Changes

- The AI Cleanup dialog gets a **Minimise** button next to the close button while a cleanup runs.
- Minimise hides the dialog and shows a small status pill at the top right of the window.
- While the cleanup runs, the pill shows the batch progress and updates as batches finish.
- When the cleanup is done, the pill says the review is ready. When it fails, the pill says so in the error colour.
- Selecting the pill opens the dialog again on the current screen (progress, review or error), and the pill goes away.
- If no cleanup job exists any more (stopped elsewhere, or the web app restarted), the pill goes away.
- Closing the dialog with the close button works as before and shows no pill.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `profile-ai-cleanup`: adds a requirement for minimising a running web cleanup to a status pill.

## Impact

- Web UI only: `web/src/lib/components/explorer/AiCleanupDialog.tsx`, a new pill component, `web/src/hooks/useAiCleanupJob.ts`, `web/src/hooks/useUserProfile.ts`, `web/src/App.tsx`, `web/src/lib/components/explorer/ai-cleanup-job-state.ts`, translations in `web/src/lib/i18n/translations.ts`.
- No API, server or storage change. The pill reads the existing `GET /api/user-profile/ai-cleanup` endpoint.
- Docs: `docs/web-ui.md`, AI Cleanup steps.
