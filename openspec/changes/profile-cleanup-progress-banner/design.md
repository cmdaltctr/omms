## Context

See proposal.md, Why. The preview job and its status endpoint exist (`profile-category-cleanup`, TDR-044). `GET /api/user-profile/category-cleanup` returns the job, or `null` when none exists in the web app process. It never starts a job; only `POST` does. The review dialog starts, follows and polls the job every 3 seconds. The Profile page (`ProfileView`) knows nothing about the job.

## Goals / Non-Goals

**Goals:**

- Show the job state on the Profile page without opening the dialog.
- Reuse the existing status endpoint and the existing progress wording.

**Non-Goals:**

- No change to the job, the API, the CLI or the other hosts.
- No banner on other pages, no toast and no notification when a preview finishes.
- No banner for AI Cleanup. Its analysis is one request that the dialog shows while it waits.
- No dismiss button for the ready state (see Risks).

## Decisions

**Poll the existing `GET` endpoint.** The banner asks once when the Profile page opens and once when the review dialog closes. It repeats every 3 seconds only while the state is `grouping` or `checking`, the same interval as the dialog (`POLL_MS`). It stops on `done`, `failed` or `null`. Alternatives: a server push channel (more moving parts for one status line) and a new light status endpoint (the existing response is small while running, and the one large response, a finished preview, is fetched once).

**A pure decision module, a hook and a component, not the dialog's loop.** The dialog's loop starts a job when none exists and holds the preview for review. The banner must never start a job, so it shares no code with that loop.

- `web/src/lib/category-cleanup-status.ts` is pure. `bannerView(job)` maps a job (or `null`) to what the banner shows: nothing, grouping, checking with done and total, ready with the group count, or failed with the error. `keepPolling(job)` is true only for `grouping` and `checking`. The web tests mock React's hooks, so timer logic inside a hook is hard to test; these two functions carry the decisions and are tested directly.
- `web/src/hooks/useCategoryCleanupStatus.ts` holds the timer. It sends only `GET`. A failed request (`success: false`, network error or 401) sets the state to `null` and stops the timer, with no toast. Cleanup on unmount clears the timer, so leaving the Profile page stops the requests.
- `CategoryCleanupBanner` calls the hook itself. `ProfileView` returns early while the profile loads or is empty, so a hook placed in `ProfileView` would break the rules of hooks. The banner therefore shows only once the profile has loaded.

The two pollers do not overlap, because the banner is paused while the dialog is open.

**Hidden while the dialog is open.** `App.tsx` already holds `categoryCleanupOpen`. It passes it to `ProfileView` and on to the banner as `paused`. This avoids two pollers and two copies of the same progress. On close the hook asks once, so the banner shows the state the dialog left behind.

**Placement and element.** The banner sits at the top of the Profile page content, under the identity and metadata row and above the first section. It is not sticky and does not use the sidebar. It uses the existing `Alert` (`web/src/lib/components/ui/alert.tsx`): the default variant for running and ready, the destructive variant for failed. Running and ready use `role="status"`, because the text changes every few seconds and an assertive `role="alert"` would interrupt a screen reader each time. Failed keeps `role="alert"`. The button is a small outline `Button` that opens the existing dialog through `setCategoryCleanupOpen(true)`.

**Wording.** The running state reuses `label-category-cleanup-loading` (grouping) and `label-category-cleanup-progress` (batch X of Y). New keys: `label-category-cleanup-banner-ready` (with `{groups}`), `label-category-cleanup-banner-failed` (with `{error}`) and `btn-category-cleanup-banner-open`. All three get real English, Chinese and Arabic text. The error text comes from the server and is wrapped in `<bdi>`.

**Ready stays until Apply, Undo or restart.** The server keeps the finished job until `Apply` or `Undo` clears it, or the web app restarts. The banner therefore stays after the user reviews the preview and closes the dialog without applying. It states a true fact: an unapplied preview exists. A dismiss button needs state that outlives a page load to be useful and is left out until the user asks for it.

## Risks / Trade-offs

- [A ready banner can be old, because the job lives until restart] → The dialog's **Build a new preview** replaces it. A dismiss button or an age limit can be added later without changing the job.
- [One extra `GET` every 3 seconds while a preview runs, from each open Profile tab] → The request is cheap while running and stops when the job ends. A preview runs for minutes, not continuously.
- [The banner and the dialog could disagree for up to 3 seconds] → The banner is hidden while the dialog is open and asks again on close.
- [The failed message is server text in English] → The same text already appears in the dialog. Translating server errors is outside this change.
- [A finished job's `GET` response carries the whole preview, with up to three example descriptions per name] → The banner fetches it once per page open and reads only the group count. The dialog fetches the same response today.
- [A failed status request hides a running job until the page opens again] → The job keeps running on the server, and the dialog still shows it. A retry loop would add error handling for a rare case.

## Verification approach

Browser checks use the existing fake-data dev server in `web/tests/visual/` (`vite.config.ts` with `fixtureResponse` in `fixtures.ts`), so no check touches the live profile or calls a model. A fixture for `GET /api/user-profile/category-cleanup` returns a chosen state. Checks never use the live web app on port 4747.
