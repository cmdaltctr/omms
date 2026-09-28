# Tasks

## 1. Reasons and fixtures

- [x] 1.1 Export the six reason sentences from design decision 10 as constants in `src/importer/settings-models.ts`. Verify: `bun run typecheck` passes.
- [x] 1.2 Add a v2 `/api/model` fixture in `tests/fixtures/` shaped like the OpenCode v2.0.18 reply, with a fake `settings.apiKey`, plus a v1 `/provider` fixture. Verify: both fixtures load in the tests from group 2.

## 2. Standalone OpenCode reader (test first)

- [x] 2.1 Write failing tests in `tests/opencode-standalone-models.test.ts` with a fake `spawn`, `fetch`, clock, and file check: v2 list mapped to `{ provider, model, name }`, v1 fallback on 404 or HTML, list polled until two replies in a row have the same non-empty count, empty at 5 s gives the "no signed-in models" reason, no start line in 10 s gives the "took too long" reason, unknown shape gives the "cannot read" reason, and program not found starts nothing. Verify: the tests fail before the module exists.
- [x] 2.2 Add tests that the fake key and the generated password never appear in the result, thrown errors, or log calls, and that the child is stopped on every path, with `SIGKILL` after 5 s when `SIGTERM` is ignored, and that the read returns before the stop finishes. Verify: the tests fail before the module exists.
- [x] 2.3 Add tests for the program search order (`~/.opencode/bin`, `PATH`, then the fixed folders) and for Windows `PATHEXT` and `.cmd` handling. Verify: the tests fail before the module exists.
- [x] 2.4 Add tests for sharing and keeping results: two calls at once start one child, a success is reused for 5 minutes, and a failure is reused for 30 seconds. Verify: the tests fail before the module exists.
- [x] 2.5 Implement `src/importer/opencode-standalone-models.ts` as described in design decisions 1 to 9 and 11. Verify: every test from 2.1 to 2.4 passes with `bun test tests/opencode-standalone-models.test.ts`, and each test fails again when its matching code is removed.
- [x] 2.6 Add a stop function for live children and call it from `WebServer.stop()`. Verify: a test starts a read, stops the server, and sees the fake child killed.

## 3. Settings route

- [x] 3.1 Change `listOpencodeSettingsModels` to use the standalone reader only when no client is passed and no OpenCode host is registered, and to return its reason. Verify: new cases in `tests/settings-models.test.ts` pass, and the existing client and registered-host cases still pass.
- [x] 3.2 Change `listPiSettingsModels` to return the two Pi reasons. Verify: `tests/settings-models.test.ts` checks both reasons and still checks that the SDK error text is not returned.
- [x] 3.3 Confirm the importer boundary still holds. Verify: `bun test tests/host-neutral-capture-boundary.test.ts` and `bun test tests/pi-adapter-boundary.test.ts` pass.

## 4. Settings page

- [x] 4.1 Show `list.reason` through `s()` in `ModelsSection.tsx` and `AutoImportSection.tsx`, with the old line only when no reason is given. Verify: `bun run check` passes.
- [x] 4.2 Add Chinese and Arabic text for the six reasons in `web/src/lib/i18n/settings.ts`. Add a test to `tests/web-settings-i18n.test.ts` that imports the reason constants and checks each has both translations. Verify: the test fails with one translation removed and passes with all present.

## 5. Docs and records

- [x] 5.1 Update `docs/web-ui-settings.md`: the login web app lists OpenCode models, what each reason means, and that project-level OpenCode providers must be typed. Verify: `bun run check` passes the Markdown format check.
- [x] 5.2 Add a TDR in `docs/tdr/` about the OpenCode v2 server API: the SDK 1.18 launcher and client mismatch, the password, the empty first reply, and the provider keys in `/api/model`. Add it to `docs/tdr/README.md`. Verify: the file and index entry exist.

## 6. End-to-end check

- [x] 6.1 Run `bun run ci:local`. Verify: it passes.
- [x] 6.2 With OpenCode v2 installed and no session open, run `om-memory-system web` from a test build on a free port, open Settings, and confirm the OpenCode card lists `zai-coding-plan` models. Confirm no `opencode serve` child remains, and the OMMS log has one record with no key or password. Verify: record the counts and log record in the change notes.
- [x] 6.3 Rename the `opencode` program folder out of the search path for the test run, reload Settings, and confirm the "could not find OpenCode" reason appears. Verify: record the shown text.

## Verification notes

Recorded on 2026-09-28 with OpenCode v2.0.18 on macOS. The runs used the built `dist/` on spare ports, with `PATH=/usr/bin:/bin:/usr/sbin:/sbin` like a login item.

- 6.2: `GET /api/settings/models?host=opencode` returned 420 models in 920 ms, including `zai-coding-plan` models such as `glm-5.3`. A reload returned the same list from the cache in 2 ms. The response had no `apiKey` or `settings` field. No `opencode serve` process remained after the server stopped. The single log record was `OpenCode standalone model list: {"outcome":"listed","count":420,"startMs":89,"listMs":818}`, with no key or password.
- 6.3: With `HOME` set to an empty folder and the short `PATH`, the Settings page was opened in Orca's built-in browser. With Manual model chosen, the OpenCode card showed a typed `provider/model` box and this text: "OMMS could not find OpenCode on this computer, so it cannot list OpenCode's models here. Type the model as provider/model, for example zai-coding-plan/glm-5.3. If OpenCode is installed, open an OpenCode session and reload this page." The OpenCode block in Automatic import showed the same text. In Chinese and Arabic, both places showed the translated text. Both sections loaded the list, but the log had one record, `{"outcome":"not_found","count":0}`, so they shared one read.
- Changes made during work: the list is polled until two replies in a row have the same count, because `/api/model` fills in stages (0, then 32, then 420). OpenCode takes about 3.6 s to exit on `SIGTERM`, so the stop runs in the background with a 5 s `SIGKILL` limit. A cold read went from 3,013 ms to 920 ms.
