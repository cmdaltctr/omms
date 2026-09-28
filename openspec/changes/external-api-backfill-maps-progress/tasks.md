# Tasks

## 1. Config and model rule

- [x] 1.1 Accept `external` for `opencodeModel`, `piModel`, `opencodeBackfillModel`, and `piBackfillModel`, and add `importPathMaps` (global only, `~` expanded, entries validated) in `src/config.ts`; verify with config validation tests for valid and invalid values and that a project config's `importPathMaps` is ignored
- [x] 1.2 Handle `external` in `live-model-choice.ts` (ready → manual mode, unready → missing settings, no fallback retry) for both hosts; verify with parity tests that OpenCode and Pi give the same result for the same config, including a half-configured external API
- [x] 1.3 Return an `external` variant from `parseBackfillModel` and map it to the external provider in both adapters' backfill model resolvers; verify with backfill model tests that an unconfigured external API stops the run with the missing setting named
- [x] 1.4 Wire the OpenCode and Pi live capture paths to the `external` choice; verify with adapter tests that each host calls the external provider and that the other host is unaffected

## 2. Directory maps

- [x] 2.1 Merge saved `importPathMaps` with run maps (run maps win by `from`) in `run-import.ts` for CLI, slash-command, web, and automatic runs; verify with tests for merge order and a missing target staying unresolved
- [x] 2.2 Store a bounded list of unresolved directories with session counts in the backfill state; verify with a test that paths and counts are stored, capped at 200, and no conversation content is stored
- [x] 2.3 Implement target suggestions (longest existing prefix repository across ancestor names, then OpenCode's recorded project worktree read-only); verify with fixture tests for `app-feat-x`, `workspaces/app/feat-x`, a temporary directory with no suggestion, and a check that OpenCode's database is opened read-only

## 3. Progress, lock, and controls

- [x] 3.1 Add the `import_runs` table and a throttled progress writer fed by `onProgress` (numbers only, recent samples, PID); verify with tests that `promptPreview` is never stored and writes are throttled
- [x] 3.2 Make every model-calling run (automatic, web, CLI, slash command) acquire the host's `backfill_locks` row and report stale runs as stopped; verify with a two-process test that a second run for the same host is refused and that a dead PID's run shows as stopped
- [x] 3.3 Compute percentage and minutes left from the sample window, unknown until 5 samples over 60 seconds; verify with unit tests for the 400/1,000 at 5 per minute example and the early unknown case
- [x] 3.4 Add the paused flag: pause aborts an in-process run or is honoured between exchanges by another process, host start skips a paused backfill, resume clears it and starts a run; verify with tests for pause across a simulated restart on both hosts
- [x] 3.5 Add Run now, Pause, and Resume endpoints that start the backfill in the web server process, refuse when a run for the host is active, and are unavailable without a host unless the backfill model resolves to `external`; verify with endpoint tests including origin and auth rejection

## 4. External API settings and key handling

- [x] 4.1 Extend the global config writer allow-list with `memoryProvider`, `memoryApiUrl`, `memoryModel`, `memoryApiKey`, and `importPathMaps`, and reject a literal `memoryApiKey`; verify with writer tests that comments survive and a literal key is refused without writing
- [x] 4.2 Move the Windows user-only ACL code from `capture-diagnostics.ts` into a shared module and keep capture traces protected; verify with the existing capture trace ACL tests
- [x] 4.3 Add the key-source endpoint (env name, existing file path, pasted key saved to `~/.config/omms/secrets/<name>.key` with folder `700` and file `600`, or the Windows ACL, confirmation before replace, refusal on a network bind without Basic Auth); verify with tests that the key never appears in responses, logs, or config and that permissions are user-only
- [x] 4.4 Report the key source type, reference, and whether it resolves in the web server process, with the shell-profile warning for `env://`; verify with a readiness test where the variable is missing in the server process
- [x] 4.5 Add the Test call for the saved external API with a small output limit and redacted errors; verify with a test that a rejected key produces a redacted error

## 5. Web UI

- [x] 5.1 Build the External API card with the three key sources and the Test button; verify with web component tests and a manual check in the running web app
- [x] 5.2 Add the External API option to both hosts' capture model cards and backfill model choices, disabled with the missing setting when not configured; verify with web tests
- [x] 5.3 Build the Directory maps section (saved maps, unresolved directories per host with counts, suggestions to accept, edit, or reject, save); verify with web tests and a manual check against a fixture history
- [x] 5.4 Add progress bars, percentage, done/total, minutes left, surface, and Run now/Pause/Resume to the Automatic import section, refreshing while a run is active; verify with web tests and by watching a CLI run on the page
- [x] 5.5 Show the running and global command versions with the mismatch warning and install or upgrade command in the Web app section; verify with web tests for equal, different, and missing global versions
- [x] 5.6 Add the new strings to every language the Settings page supports; verify with the existing i18n completeness test

## 6. CLI

- [x] 6.1 Add `--version` and `-v` to `om-memory-system`; verify with a CLI test that it prints the `package.json` version and exits `0`
- [x] 6.2 Implement the web server's global version lookup (no shell, 3-second timeout, 10-minute cache); verify with tests for found, missing, and timed-out commands, including on Windows paths

## 7. Documentation

- [x] 7.1 Rewrite `docs/cli.md` with a complete command reference: every terminal command, subcommand, and option, `--version`, and both hosts' slash commands; verify by comparing it against `src/cli/index.ts` and both adapters' command registrations
- [x] 7.2 Document global install as optional but highly recommended (`npm i -g om-memory-system` or `bun add -g om-memory-system`, upgrading, `om-memory-system --version`, the mismatch warning) in `docs/web-ui.md`, `README.md` setup, and `docs/upgrading.md`; verify the commands run
- [x] 7.3 Add the terminal proxy note (for example Orca's `*.orca.localhost` addresses differ from the printed `127.0.0.1` URL) to `docs/web-ui.md`
- [x] 7.4 Document the External API card, key sources, `external` model values, `importPathMaps`, progress, and Run now/Pause/Resume in `docs/configuration.md`, `docs/web-ui.md`, and both history import guides; verify with `bun run check`
- [x] 7.5 Record the key-file decision in `docs/adr/` and add it to the index

## 8. Verification

- [x] 8.1 Run the boundary tests (`host-neutral-capture-boundary`, `pi-adapter-boundary`, `plugin-bundle-boundary`) and confirm no new host imports in `src/core/` or `src/services/`
- [x] 8.2 Run `bun run ci:local` and `bun run check:package`, and run the security scan on changed files
- [x] 8.3 End-to-end: in the login web app with Pi and OpenCode closed, configure the external API with a key file, set Pi's backfill to `external`, add a suggested map, Run now, pause, resume, and confirm progress and the ledger match
