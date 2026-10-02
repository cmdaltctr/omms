# Tasks

## 1. Newest-copy record

- [x] 1.1 Write `tests/runtime-record.test.ts`: valid-copy check, write when missing, write when newer, keep on a tie, replace a record whose copy is gone, skip an unparsable version, atomic write (no `.tmp` left), mode 0600, read failure returns null and logs a code. Verify: it fails before 1.2.
- [x] 1.2 Add `src/services/runtime-record.ts` as a pure module (paths and file functions passed in, no `config.ts` import). Verify: 1.1 passes, and `bun test tests/host-neutral-capture-boundary.test.ts` passes.

## 2. Launcher

- [x] 2.1 Write `tests/omms-launch.test.ts`: `chooseCopy` picks the newest valid candidate, skips a missing record copy, honours `--at-least-own-version`, chooses `npx` only when no candidate reaches it; its SemVer compare agrees with `compareVersions` over a shared list that includes prereleases; `main` passes arguments, standard input, and the exit code through (spawn a fake copy in a temp folder). Verify: it fails before 2.2.
- [x] 2.2 Add `bin/omms-launch.mjs` (Node built-ins only) and a `.d.mts` type file if the TypeScript build needs one. Add `bin` to `package.json` `files`. Verify: 2.1 passes, `bun run build`, then `bun run check:package` passes and lists `bin/omms-launch.mjs`.
- [x] 2.3 Extend 1.1/1.2: when a copy writes the record, it copies its launcher to `~/.omms/bin/omms-launch.mjs` if the file there is missing or different. An older copy never replaces it. Verify: new cases in `tests/runtime-record.test.ts` fail first, then pass.

## 3. CLI hand-off

- [x] 3.1 Write `tests/cli-handoff.test.ts`: with a newer valid record, `runCli` runs that copy and returns its exit code; it does not hand off when the record is its own copy, when `OMMS_NO_HANDOFF=1`, or when `OMMS_HANDED_OFF` is set; `--version` prints the newer version after the hand-off; with an older record, it registers itself. Verify: it fails before 3.2.
- [x] 3.2 Add the hand-off and self-registration at the top of `runCli` in `src/cli/index.ts`. Verify: 3.1 passes, and `bun test tests/cli-memory.test.ts` and `bun test tests/opencode-cli.test.ts` still pass.

## 4. Host registration

- [ ] 4.1 Add tests that an OpenCode start and a Pi start write their copy into the record through the shared service, and that a record failure does not fail the start. Verify: they fail before 4.2.
- [ ] 4.2 Call the shared registration from `src/index.ts` and `src/adapters/pi/extension.ts` with dynamic `import()`, next to `reconcileWebAutostart`. Verify: 4.1 passes, and `bun test tests/plugin-bundle-boundary.test.ts` and `bun test tests/pi-adapter-boundary.test.ts` pass.

## 5. Login item runs the launcher

- [ ] 5.1 Update `tests/web-autostart.test.ts`: the item runs `~/.omms/bin/omms-launch.mjs web --login-item` on macOS, Linux, and Windows; an item that runs `dist/cli/index.js` directly is rewritten; install creates the launcher first; status reports what the launcher starts. Verify: the new cases fail before 5.2.
- [ ] 5.2 Change `itemContent`, `details`, and `webAutostartStatus` in `src/services/web-autostart.ts`. Remove `preferredPackageRoot` only if nothing else uses it. Verify: 5.1 passes, and `bun test tests/web-autostart-missing-package.test.ts` passes.

## 6. Replace an older web app

- [ ] 6.1 Move `readWebVersion` and `negotiateOwner` from `src/cli/web-command.ts` to `src/services/web-handover.ts` with no behaviour change. Verify: `bun test tests/web-command.test.ts` passes unchanged.
- [ ] 6.2 Write cases in `tests/web-ensure.test.ts`: with `replaceOlder`, an older web app gets a step-aside request, then a start through the launcher; a same or newer or unparsable version is used as is; a failed step-aside returns `running` and logs a code; two callers replace it only once; without `replaceOlder`, nothing changes. Verify: they fail before 6.3.
- [ ] 6.3 Add `replaceOlder` to `ensureWebApp` in `src/services/web-ensure.ts`, and spawn `~/.omms/bin/omms-launch.mjs web` when it exists. Verify: 6.2 passes, and `bun test tests/web-ensure-real-process.test.ts` and `bun test tests/opencode-web-ensure.test.ts` pass.
- [ ] 6.4 Pass `replaceOlder` from the OpenCode start, the Pi start, and the Claude Code `session-start` hook only. Add a hook client test that `user-prompt-submit` does not pass it. Verify: `bun test tests/claude-hook-client.test.ts` passes.

## 7. Claude Code plugin

- [ ] 7.1 Change `hooks/hooks.json` to run `node "${CLAUDE_PLUGIN_ROOT}/bin/omms-launch.mjs" --at-least-own-version claude-hook <event>`, keeping the timeouts and `async`. Update the description in `.claude-plugin/plugin.json`: the global install is optional. Verify: `claude plugin validate .` passes.
- [ ] 7.2 Add a test that the launcher reads the plugin version from the repository `package.json` and runs `npx --yes om-memory-system@<version>` when every local copy is older. Verify: the test fails before the flag works, then passes.

## 8. Settings page global version

- [ ] 8.1 Update `tests/global-version.test.ts`: the version comes from the global install's `package.json` through the `PATH` symlink, and the command is not run. Add web UI cases for "runs in place of the older global", "global is newer", and "not installed, optional". Verify: they fail before 8.2.
- [ ] 8.2 Change `src/services/global-version.ts` and the **Web app** section text, with strings in every language file under `web/src/lib/i18n/`. Verify: 8.1 passes, and `(cd web && bun run build)` passes.

## 9. Docs and decision record

- [ ] 9.1 Update `docs/upgrading.md`, `docs/claude-code-adapter.md` (new hook entries for hand-written settings, Node.js requirement, `npx` fallback), `docs/cli.md` (hand-off, `OMMS_NO_HANDOFF`), `docs/web-ui-settings.md`, `UPDATES.md`, and `README.md` (global install optional). Verify: `bun run check` passes.
- [ ] 9.2 Write `docs/adr/018-newest-copy-runtime.md` and add it to `docs/adr/ADR_README.md`. Verify: the file exists and the index lists it.

## 10. Verify

- [ ] 10.1 Run `bun run ci:local`. Verify: exit 0.
- [ ] 10.2 Live check on macOS. Set up the global install at an older version than a local build copy. Start Pi from the build copy. Check that `~/.omms/runtime.json` names it, that the plist runs `~/.omms/bin/omms-launch.mjs`, that `curl /api/settings/version` reports the new version without a new login, and that the global `om-memory-system --version` prints the new version. Then run one Claude Code session with the plugin loaded through `--plugin-dir` and check that the hooks return memories. Verify: record the commands and output in the PR.
