## 1. Shared copies helper

- [x] 1.1 Write failing tests in `tests/host-copies.test.ts`: package root from a module path; sibling timestamp copies with versions; a copy without `package.json`; no timestamp folder.
- [x] 1.2 Add `src/services/host-copies.ts` with the copy list and the installed-version check.
- [x] 1.3 Write failing tests for the clean-up: removes older copies; keeps the running, newer, recorded and unreadable copies; keeps everything within 24 hours; a failed removal stays and is counted; one log record with counts.
- [x] 1.4 Add the clean-up to `src/services/host-copies.ts`.

## 2. Confirmed install

- [x] 2.1 Write failing tests in `tests/host-self-update.test.ts`: a marker that says `installed` with no copy at the new version reads as `failed`.
- [x] 2.2 Add the check to `src/services/host-self-update.ts` and use it from `src/adapters/pi/self-update.ts` and `src/adapters/opencode/tui-status.ts`. Add tests for each host.

## 3. OpenCode clean-up wiring

- [x] 3.1 Start the clean-up from `src/v2/plugin.ts` without waiting, with a test that setup does not wait for it and does not fail when it throws.

## 4. Docs and records

- [x] 4.1 Update `docs/upgrading.md`, `docs/opencode-adapter.md` and `UPDATES.md`.
- [x] 4.2 Add an ADR for the host self-update approach and a TDR for the OpenCode 2.2 cache layout and background service. Add both to the folder index files.

## 5. Verify

- [x] 5.1 Run each new and changed test file with `bash scripts/run-tests-isolated.sh`. Break the code once and confirm a test fails.
- [x] 5.2 Run `bun run ci:local` and read the exit line.
