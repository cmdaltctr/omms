# Tasks

## 1. Job state decisions and polling

- [x] 1.1 Write `web/tests/category-cleanup-banner.spec.tsx` cases for the pure module first: `bannerView` returns nothing for `null`, grouping without a count, checking with done and total, ready with the number of groups, and failed with the error; `keepPolling` is true for grouping and checking only. Run `bash scripts/run-tests-isolated.sh web/tests/category-cleanup-banner.spec.tsx` and verify the cases fail before the module exists.
- [x] 1.2 Add `web/src/lib/category-cleanup-status.ts` with `bannerView` and `keepPolling`, with no React or config import. Verify task 1.1 passes.
- [x] 1.3 Write hook cases in the same file, using the collected-effects pattern of `web/tests/directory-map-review.spec.tsx`: the effect sends one `GET` and no `POST`; it schedules the next request only when `keepPolling` is true; while paused it sends nothing; a failed request sets the state to `null`, schedules nothing and shows no toast; the effect's cleanup clears the timer. Verify the cases fail before the hook exists.
- [x] 1.4 Add `web/src/hooks/useCategoryCleanupStatus.ts` (`paused` argument, 3-second interval as the dialog's `POLL_MS`). Verify task 1.3 passes.

## 2. Banner component

- [x] 2.1 Write tests for `CategoryCleanupBanner` first: nothing renders for no job or while paused; grouping shows `label-category-cleanup-loading`; checking shows `label-category-cleanup-progress` with done and total; ready shows the group count; failed shows the error inside `<bdi>` with `role="alert"`; running and ready use `role="status"`; the button calls `onOpen`. Verify the tests fail before the component exists.
- [x] 2.2 Add `label-category-cleanup-banner-ready`, `label-category-cleanup-banner-failed` and `btn-category-cleanup-banner-open` to `web/src/lib/i18n/translations.ts` in English, Chinese and Arabic. Verify a test finds each key, non-empty and different from English, in all three languages.
- [x] 2.3 Add `web/src/lib/components/explorer/CategoryCleanupBanner.tsx`. It calls the hook itself and uses the existing `Alert` and `Button`. Verify task 2.1 passes.
- [x] 2.4 Render the banner in `ProfileView` under the identity and metadata row, above the first section. Pass `categoryCleanupOpen` from `App.tsx` as `paused`, and open the dialog from the button with `setCategoryCleanupOpen(true)`. Verify `bash scripts/run-tests-isolated.sh web/tests/heading-hierarchy.spec.tsx web/tests/dialog-focus.spec.tsx web/tests/cleanup-help.spec.tsx` still passes.
- [x] 2.5 Break the work on purpose in four ways: show the banner while paused, keep polling after done, send `POST`, and keep polling after a failed request. Verify that at least one new test fails for each break, then restore each file.

## 3. Documentation

- [x] 3.1 Describe the banner in the Clean up categories steps of `docs/web-ui.md`: its three states, that it hides while the dialog is open, and that it stays until Apply, Undo or a restart of the web app. Replace "you can close the window and open it again later" with the banner wording. Verify with `bun run format:check`.

## 4. Integration checks

- [x] 4.1 Add a `GET /api/user-profile/category-cleanup` fixture to `web/tests/visual/fixtures.ts` that returns a chosen state (grouping, checking, done, failed, none). Run the fake-data dev server with `web/tests/visual/vite.config.ts`, not the live app. Check each state at 1280px in dark and light themes, and at 390px for overflow. Report each check as PASS, FAIL or NOT RUN.
- [x] 4.2 On the same server, check Arabic and Chinese banner text at 390px. Verify no clipped text, no horizontal page scroll, and that the error text keeps its direction inside `<bdi>`.
- [x] 4.3 Run `bun run check`, `(cd web && bun run check)` and `openspec validate profile-cleanup-progress-banner --strict`. Verify all three pass, then run `bun run ci:local` before the pull request.
