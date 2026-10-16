# Proposal

## Why

A category cleanup preview runs as a background job and can take 30 minutes on a large profile (TDR-044). Only the review dialog shows its progress. When the user closes the dialog, the Profile page shows nothing. The user cannot tell whether a preview is running, finished or failed, and has to reopen the dialog to find out. The user asked for a visible indicator on the page.

## What Changes

- The Profile page shows a **banner** while a category cleanup preview exists in the web app. The banner has three states:
  - **Running:** shows the job's progress (grouping names, or "batch X of Y") and a button that opens the review dialog.
  - **Ready:** says that a preview is ready, with the number of groups, and a button that opens the review dialog.
  - **Failed:** shows the error and a button that opens the review dialog, where **Build a new preview** is available.
- The banner reads the job state only. It never starts a job, and it makes no model call.
- The banner updates by itself while a job runs, and stops asking once the job is done or failed.
- The banner is hidden while the review dialog is open, because the dialog shows the same progress. It appears again, with fresh state, when the dialog closes.
- The banner disappears when no job exists: after a restart of the web app, and after Apply or Undo (both clear the job).
- Banner text is added in English, Chinese and Arabic.

No change to the job, the API, the CLI or the other hosts. The CLI already prints its own progress.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `profile-category-cleanup`: gains one new requirement, the banner on the Profile page. The requirement "A long preview runs in the background with progress" stays as it is; it covers the job and the dialog.

## Impact

- Web UI: a new banner component, shown on the Profile page by `ProfileView`; `App.tsx` passes it whether the review dialog is open.
- Web API: none. The banner uses the existing `GET /api/user-profile/category-cleanup`.
- Translations: new keys in `web/src/lib/i18n/translations.ts` for the three languages.
- Docs: `docs/web-ui.md` describes the banner.
- No new dependencies. No storage change.
