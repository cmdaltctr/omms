# TDR-087: A test web app half-wrote the real global install

**Date:** 2026-11-17
**Status:** Proposed
**Deciders:** OMMS maintainers
**Tags:** tests, test-runner, web-update, npm

## Context

On 17 November 2026 the global install of `om-memory-system` (`/opt/homebrew/lib/node_modules/om-memory-system`) was left half written twice, at about 14:37 and at 15:50. Many dependency folders were empty and the `om-memory-system` command link was missing. The real OMMS log had no update entry at either time, and the real npm log folder had no global install. Both times matched the end of a full `bun run ci:local` run in a worktree.

### Root Cause Analysis

- `tests/web-install-handover.test.ts` starts a real standalone web app through `startStandaloneWeb("0.0.1")` in `tests/standalone-web-fixture.ts`. The app runs on the real `node` and reports version `0.0.1`.
- The test environment did not set `OMMS_DISABLE_UPDATE_CHECK`, so the app read npm `latest` at start. An install needs a launcher in `~/.omms/bin`. The test's `web install` step writes that launcher into the app's temporary home.
- When the registry reply arrived after the launcher was written, the app started its automatic update: `npm install -g om-memory-system@6.5.0`. It runs the npm beside its Node.js by absolute path (`npmBesideRuntime`), so a PATH change cannot stop it. That npm's built-in prefix is `/opt/homebrew`.
- The test then stopped the app and deleted its temporary home. npm kept running, lost its cache and log folder (both under that home) and left the global install half written. Its log was deleted with the home, so no trace stayed.
- Proof: with a fake `npm` beside a copy of `node` first on PATH and a registry reply delayed by 1 to 2.5 seconds through a proxy, the test logged `install -g om-memory-system@6.5.0` from `node dist/cli/index.js web` under `bun test tests/web-install-handover.test.ts`, every time. A normal run on a busy machine gives the same delay.

## Decision

1. `.env.test` sets `OMMS_DISABLE_UPDATE_CHECK=1`. Every test process and every child that copies its environment skips the npm release check, so no test web app starts an update.
2. `scripts/run-tests-isolated.sh` sets `npm_config_prefix` and `NPM_CONFIG_PREFIX` to `$OMMS_TEST_HOME/.omms-test-npm/prefix`. Any npm that still runs, also one found by absolute path, installs there.
3. On macOS and Linux the runner also puts a refusing `npm` and `npx` first on PATH. Windows finds npm as `npm.cmd`, so it relies on the prefix alone.
4. A test that needs npm for read-only local work opts in with `OMMS_TEST_REAL_NPM`, the npm the runner found before it changed PATH. `tests/package-skills.test.ts` uses it for `npm pack --dry-run`.
5. `tests/preload.ts` refuses a test process whose npm prefix is outside the test home. `tests/test-home-isolation.test.ts` checks the update check switch, the prefix and the refusing npm.

## Consequences

### Positive

- No test can write the real global install, whichever test starts npm.
- A future test that starts a web app needs no extra setting.

### Negative

- A test that wants the real update check must set `OMMS_DISABLE_UPDATE_CHECK` itself in a child environment.

### Neutral

- The install lock from TDR-086 lives in `~/.omms`. A test web app has its own home, so that lock would not have stopped this case.

## Alternatives Considered

| Option                                      | Rejected Because                                                      |
| ------------------------------------------- | --------------------------------------------------------------------- |
| Fake npm on PATH only                       | The web app runs the npm beside its Node.js by absolute path          |
| Set the update switch in the fixture only   | Any new test that starts a web app would bring the problem back       |
| Refuse every npm call, including `npm pack` | `tests/package-skills.test.ts` needs a read-only `npm pack --dry-run` |

## How to Recognise / Handle This Again

1. Symptom: the global install has empty dependency folders or no command link, and the OMMS log shows no update at that time.
2. Check whether a full test run ended at that time, and whether a test starts a web app or npm with an environment that drops `OMMS_DISABLE_UPDATE_CHECK` or `npm_config_prefix`.
3. Repair with `npm install -g om-memory-system@<version>` from Homebrew npm.

## Revisit Triggers

- A test needs a web app with a live update check.
- The runner moves away from `scripts/run-tests-isolated.sh`.
