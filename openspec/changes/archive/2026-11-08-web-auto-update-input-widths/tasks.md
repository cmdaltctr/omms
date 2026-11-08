# Tasks

## 1. Server: the web app installs a newer release by itself

- [x] 1.1 Write failing tests in `tests/web-auto-update.test.ts` (new file, follow `tests/web-update-check.test.ts` stub style): a check that finds a release starts the install by itself; `enabled: false` starts nothing; a failed `canInstall` gate starts nothing and leaves the release reported; a failed automatic install sets a 30-minute backoff (a later check inside the window starts nothing, a manual `requestInstall` still starts); the automatic start logs one record with `from`/`to`. Verify: `bash scripts/run-tests-isolated.sh tests/web-auto-update.test.ts` fails on current code for these reasons.
- [x] 1.2 Implement in `src/services/web-update.ts`: after a successful check sets the release, start the same install the route starts when every gate holds; keep a 30-minute in-memory backoff for automatic retries only; log one record per automatic start. Verify: the new test file passes and `tests/web-update-check.test.ts` and `tests/web-update-install.test.ts` still pass.
- [x] 1.3 Cover the status-driven recheck: an open page's status read that triggers a fresh check can also start the automatic install. Add the case to `tests/web-auto-update.test.ts`. Verify: the focused run passes.

## 2. Web UI: the page reloads after an unattended update

- [x] 2.1 Write a failing web spec (new file under `web/tests/`) for the shared status store: a reply with a new non-null `instance` after a previous non-null one reloads the page; the first answer, a failed call, and an unchanged instance do not. Verify: the spec fails on current code.
- [x] 2.2 Implement the reload in `web/src/lib/web-status.ts`. Verify: the new spec passes and `web/tests/power-api.spec.tsx`, `web/tests/power-button.spec.tsx`, and `web/tests/update-button.spec.tsx` still pass.

## 3. Web UI: Settings controls follow the Provider width

- [x] 3.1 Write a failing web spec asserting the compact wrapper (`w-72 max-w-full`) around API URL, Model, and the key-source group in `ExternalApiSection.tsx`, and around the Model choice dropdown in `ModelsSection.tsx`; assert the manual model picker and the typed provider/model input keep full width. Follow the `web/tests/keyword-mode-section.spec.tsx` source-assertion style. Verify: the spec fails on current code.
- [x] 3.2 Wrap those controls in `ExternalApiSection.tsx` and `ModelsSection.tsx` with the shared `compactField` wrapper. Verify: the new spec passes, `web/tests/settings-page-fixes.spec.tsx` and `web/tests/keyword-mode-section.spec.tsx` still pass, and the web typecheck is clean.
- [x] 3.3 Visual check: run the web app in the worktree, screenshot the External API card and both model cards at 1280 px and 390 px widths; no horizontal scroll, widths match Provider. Evaluate the screenshots with the GLM vision tool. Verify: screenshots confirm the compact width and no horizontal scroll.
- [x] 3.4 Cap the API key fieldset itself at the compact width: the bordered box hugs the compact column instead of spanning the card. Extend the spec scenario, update the source-assertion spec, prove it fails, then move `compactField` from the inner wrapper onto the fieldset. Verify: the focused spec passes and the neighbours (`settings-page-fixes`, `keyword-mode-section`) still pass.

## 4. Docs

- [x] 4.1 Add `docs/adr/046-*.md` (the web app updates itself: gates, 30-minute backoff, one off switch, relation to ADR-045) and its entry in the ADR index. Verify: the index lists it and the file follows the ADR template.
- [x] 4.2 Update `UPDATES.md`, `docs/upgrading.md`, and `docs/web-ui.md`: the web app now installs newer releases by itself, the page reloads after the restart, the button stays for manual retry, and the gates and backoff as specified. Verify: `grep -rn "web update" UPDATES.md docs/upgrading.md docs/web-ui.md` shows no stale manual-only wording.

## 5. Integration

- [x] 5.1 Run `openspec validate web-auto-update-input-widths --strict` and fix every finding. Verify: the command exits clean.
- [x] 5.2 Run `bun run ci:local` in the worktree and read the real exit line. Verify: exit 0 (this also covers the translation-parity test, since the change adds no new strings).
