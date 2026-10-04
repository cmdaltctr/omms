# Tasks

## 1. Check the platform

- [x] 1.1 In a throwaway plugin folder, load a `.jsx` module that draws a coloured `Text` in `SessionMode` with `next(e)` first. Confirm it shows with Claude Code 2.1.289, with and without a mode label. Record whether theme keys `success`, `warning`, `error` render, else use raw colours.
      2026-10-04, Claude Code 2.1.289, run in a pseudo-terminal and read with `pyte`. The label draws at the right of the row under the prompt footer rule, above `⏵⏵ auto mode on`. Theme keys render: `success` `#4eba65` (green), `warning` `#ffc107` (yellow, the same colour as the `⚠` row), `error` `#ff6b80` (red). `claude plugin test` with `$.ui.mount`: `next(e)` keeps the engine's `focus` label before ours, and an empty-modes base still draws our label.
- [x] 1.2 Check whether `SessionMode` exists in Claude Code 2.1.287. If not, record the first version that has it and plan the minimum-version change in tasks 3.2 and 4.1.
      The same spike plugin draws all three colours live on Claude Code 2.1.287. The minimum version stays 2.1.287.

## 2. Tests first

- [x] 2.1 Rename `hooks/omms-status.js` to `hooks/omms-status.jsx` and update `hooks/hooks.json` and `scripts/test-claude-mod.sh`. Run `bash scripts/test-claude-mod.sh` and confirm the existing tests still pass.
      Also updated `tests/claude-plugin-assets.test.ts`, `AGENTS.md`, and `CONTRIBUTING.md`. `bash scripts/test-claude-mod.sh`: 24 pass, 0 fail.
- [x] 2.2 Add tests in `hooks/omms-status.test.ts` that mount `SessionMode` and assert: yellow `connecting` before the first health answer, green `connected`, red `web app off`, red `not installed`, dim `· <version> available` with the state colour unchanged, the engine's mode labels kept, and no `$.ui.status` call. Run them and confirm they fail on the current module.
      On the old module, every label test failed (it draws nothing in the footer). Four new tests: no status row and no `⚠`, `connecting` in `warning`, mode labels kept, label alone with no modes.

## 3. Implement

- [x] 3.1 Add the `SessionMode` render hook, the state atom, and the `connecting` state. Remove the `$.ui.status` call. Keep the toast, polling, and launcher code. Run `bash scripts/test-claude-mod.sh` until all tests pass.
      28 pass, 0 fail. Mutation checks: `connected` set to `warning` fails 3 tests; removing the `·` separator fails 1. The early health check is now awaited, because `update()` returns a promise and a dangling one rejected when the test environment unloaded.
- [x] 3.2 If task 1.2 found a newer minimum version, raise it in `.claude-plugin/plugin.json` description and the spec delta.
      Not needed: task 1.2 found `SessionMode` in 2.1.287.

## 4. Docs

- [x] 4.1 Update the "Status line" section of `docs/claude-code-adapter.md`: where the label shows, the three colours, the `connecting` state, and that the old `⚠` row is gone. Update the matching line in `docs/upgrading.md` and the minimum version if it changed.
- [x] 4.2 Update `docs/ci.md` if the test file name or script changed.
      No change: `docs/ci.md` names only the test file, which kept its name.

## 5. Verify

- [x] 5.1 Run `bun run ci:local` in the worktree and confirm it passes.
      2026-10-04: exit 0. 253 test files, 1,682 tests, 0 fail. Bun printed 18 `directory mismatch` internal notes that it marks as needing no action.
- [x] 5.2 Live check with `claude --plugin-dir` on the worktree: see green `● omms: connected` with the real web app, red `● omms: web app off` with a stub launcher naming a dead port, yellow `connecting` at start, and no `⚠` row. Record the screen text in this file.
      2026-10-04, Claude Code 2.1.289, run in a pseudo-terminal and read with `pyte`, no model prompt.
  - Worktree plugin, real launcher, real web app on port 4747: `● omms: connecting` in `#ffc107` at 0.5 s, then `● omms: connected` in `#4eba65` at 1.1 s. No `⚠ omms` row.
  - Plugin copy with a stub launcher that printed `{"healthUrl":"http://127.0.0.1:4799/api/health","version":"4.4.2","latest":"9.9.9"}`, nothing on port 4799: `connecting` (yellow), `connected` (green, from the early check on the default URL), then `● omms: web app off · 9.9.9 available` in `#ff6b80` at 1.2 s.
