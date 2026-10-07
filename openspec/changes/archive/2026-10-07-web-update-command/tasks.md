# Tasks

## 1. Shared npm install runner

- [x] 1.1 Move the npm install steps out of `WebUpdate` into an exported function in `src/services/web-update.ts` that returns `{ code, exitCode }`; make `WebUpdate.install` call it. Verify: `bun test tests/web-update-install.test.ts`, `tests/web-update-check.test.ts` and `tests/web-update-route.test.ts` pass unchanged.
- [x] 1.2 Add tests for the exported runner: success, `permission`, `network`, `npm-exit`, `spawn-error`, `timeout`. Verify each test fails when the runner returns a wrong code.

## 2. Forced replace and retire marker in the web app

- [x] 2.1 Accept `replace: true` on `POST /api/web/step-aside` from a loopback caller with the token, for any caller version; keep the "caller is newer" rule without it. Verify: tests for same-version replace (`202`), same-version plain request (refused), and replace without token (refused) in `tests/web-step-aside.test.ts`.
- [x] 2.2 Add a retire marker module (path `~/.omms/web-retire.json`, atomic write, safe read that returns null on a missing or bad file). Verify: unit tests for write, read, and a corrupt file.
- [x] 2.3 In the waiting loop, run the step-aside callback when the marker's `before` is later than this web app's start time; ignore the marker when no callback is set. Verify: tests with a fake clock for an older waiting web app (retires), a newer one (stays), and one without a callback (stays).

## 3. The `web update` command

- [x] 3.1 Add `src/cli/web-update-command.ts` with injected dependencies: read npm `latest`, compare with the global install, run the shared runner when older, and check the version after npm. Verify: tests for older global (npm runs), same version (npm skipped), registry down (npm skipped, flow continues), npm failure (exit `1`, no web app touched), version mismatch (exit `1`).
- [x] 3.2 Add the replace step: write the start lock, write the retire marker, send a replace step-aside to the owner (an owner before `replace` applies its newer-caller rule), report a stuck owner with its version and exit `1`. Verify: tests for a same-version owner, an older owner without `replace`, a same-version owner without `replace` (stuck), a stuck owner, and no owner.
- [x] 3.3 Add the start and wait step: restart the login item when installed, else spawn the launcher detached; poll up to 15 seconds for a new instance; send one replace request to an older web app that took the port; remove the start lock; print `OMMS web app: <url> (version <version>)`. Verify: tests for the login item path, the launcher path, a timeout (exit `1`), and a waiting web app that took the port first.
- [x] 3.4 Route `update` in `src/cli/web-command.ts`, refuse it when `webServerEnabled` is `false`, and change the usage line to `om-memory-system web [install|uninstall|status|update]`. Update the help text in `src/cli/index.ts`. Verify: `tests/web-command.test.ts` cases for the usage line and the disabled case.
- [x] 3.5 Log one record per run with codes, versions, and durations, and no npm output or token. Verify: a test that checks the log data keys.

## 4. Documentation

- [x] 4.1 Add `web update` to the command table and the web app section of `docs/cli.md`, and to `docs/upgrading.md` as the one command that updates the global install and the web app. Verify: `bun run check` passes (Prettier on Markdown).

## 5. Integration check

- [x] 5.1 Run `bun run ci:local` in the worktree. Verify: it passes.
- [x] 5.2 Run the built command on this Mac: `node dist/cli/index.js web update` with a web app and a waiting login item running. Verify: the global install reports npm `latest`, `lsof -iTCP:4747` shows one new PID, and the old waiting process has exited.
