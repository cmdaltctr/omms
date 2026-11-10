# TDR-075: Claude Code live checks ran the global CLI copy

**Date:** 2026-11-10
**Status:** Accepted
**Deciders:** Aizat Hawari
**Tags:** claude-code, launcher, live-check

## Context

A live check of a change in a worktree loaded the worktree as a Claude Code plugin (`--plugin-dir`). The hooks ran, but the new code never ran. The old behaviour showed in the session, as if the change were missing.

### Root Cause Analysis

1. Each hook in `hooks/hooks.json` runs `bin/omms-launch.mjs --at-least-own-version claude-hook <event>`.
2. The launcher picks the newest valid copy from three candidates: the global install, the copy named in `~/.omms/runtime.json`, and the copy that holds the launcher.
3. On a version tie, the first candidate wins, and the global installs come first (TDR-072).
4. A worktree has the same version as the installed release, because release-please sets the version only on release. The tie goes to the global install, so the hook ran the installed CLI and not the worktree.

## Decision

For a live check, make the worktree copy newer than the installed one. Do not edit the repository version.

1. Copy the plugin to a scratch folder outside the repository, with `dist/`, `hooks/`, `bin/`, `skills/` and `.claude-plugin/`.
2. In the copy only, set `version` in `package.json` and `.claude-plugin/plugin.json` to a higher prerelease. A prerelease of the same version sorts below it, so raise the patch number: for installed 5.9.1, use `5.9.2-live.1`.
3. Start Claude Code with `--plugin-dir <scratch copy>`, in a scratch `HOME` with its own store and port.
4. Confirm which copy ran before you trust the result. Check that the new mode or flag works.

Never edit `version` in `package.json` or `.claude-plugin/plugin.json` in the repository. release-please sets both.

## Consequences

### Positive

- The live check runs the code under test.
- The repository version stays under release-please control.

### Negative

- The scratch copy must be rebuilt after each code change.

### Neutral

- The launcher rule is unchanged: the newest copy wins, and a tie goes to the global install.

## Alternatives Considered

| Option                                     | Rejected Because                                                                      |
| ------------------------------------------ | ------------------------------------------------------------------------------------- |
| Bump the version in the worktree           | release-please owns the version. A hand edit conflicts with the release.              |
| Uninstall the global copy for the check    | It changes the user's machine, and the recorded copy in `runtime.json` can still win. |
| Change the launcher to prefer its own copy | A host cache copy would then never follow the global install (TDR-072).               |

## How to Recognise / Handle This Again

1. Symptom: a live check in Claude Code behaves like the old code, and a new mode or flag is missing.
2. Check the versions: compare the worktree `package.json`, the global install and `~/.omms/runtime.json`. An equal version means the global install ran.
3. Build the scratch copy with a higher prerelease version and run the check again.

## Revisit Triggers

- The launcher changes its tie rule or its candidate order.
- Claude Code gains a plugin flag that forces the plugin's own copy.

## References

- [TDR-072](./072-web-app-handover-left-the-port-empty.md)
- `bin/omms-launch.mjs` (`findCandidates`, `chooseCopy`), `hooks/hooks.json`
- `tests/omms-launch.test.ts`
