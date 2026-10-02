# ADR-018: Every part of OMMS runs the newest copy on the machine

**Date:** 2026-10-02
**Status:** Proposed
**Deciders:** OMMS maintainers

## Context

OMMS has one npm package and several copies of it on one machine. OpenCode, Pi, and the global install each hold a copy. The Claude Code plugin holds a git checkout with no `dist/`.

- Only `npm i -g om-memory-system@latest` updated the global install. `opencode plugin update`, `pi update`, and the Claude Code plugin update did not touch it.
- Three parts ran the global install: the terminal command, the Claude Code hooks, and the web app login item. On 2026-10-02 OpenCode and Pi ran 4.3.2, the Claude Code plugin was 4.3.3, and those three parts still ran 4.3.0.
- A host start rewrote the login item, but the running web app did not restart. A new version loaded only at the next login.
- [TDR-022](../tdr/022-login-item-keeps-newest-copy.md) chose the newest copy at install time. It had no answer for the terminal command, the hooks, or a running web app.

## Decision

1. **A record names the newest copy.** `~/.omms/runtime.json` holds the package folder and version of the newest valid copy. A copy is valid when its `package.json` names `om-memory-system`, its version can be compared, and it has `dist/cli/index.js`. Each OpenCode start, each Pi start, and each `om-memory-system` run write their own copy when the record is missing, names a copy that is not valid, or names an older version. An equal version keeps the record. A write goes to a temporary file, then a rename. The file is private to the user. A read or write failure is logged with a code and never stops a session or a command.
2. **One launcher runs the newest copy.** `bin/omms-launch.mjs` uses only Node.js built-in modules. It picks the newest valid copy among the record, the global install beside the running Node.js, and the copy that holds the launcher. It runs that copy's CLI with the same arguments, input, and exit code. The copy that writes the record also places its launcher at `~/.omms/bin/omms-launch.mjs`. An older copy never replaces it.
3. **The login item runs the fixed launcher.** The item runs `node ~/.omms/bin/omms-launch.mjs web --login-item`. That path never changes, so the item does not go stale. `web install` places the launcher before it writes the item.
4. **A host start replaces an older running web app.** OpenCode start, Pi start, and Claude Code `SessionStart` read the version of the running web app. When it is older than the newest recorded copy, they ask it to step aside through the route that `web install` already uses. They then start the web app through the launcher. The start lock keeps two hosts from replacing it twice. `UserPromptSubmit` and `Stop` use any running web app.
5. **An old command hands off.** At the top of `runCli`, a command whose record names a newer valid copy runs that copy and returns its exit code. `OMMS_HANDED_OFF` stops a loop when two records disagree. `OMMS_NO_HANDOFF=1` turns the hand-off off for one process.
6. **The Claude Code hooks run the plugin launcher.** Each hook runs `node "${CLAUDE_PLUGIN_ROOT}/bin/omms-launch.mjs" --at-least-own-version claude-hook <event>`. The flag makes the version in the `package.json` beside the launcher the minimum. When no local copy reaches it, the launcher runs `npx --yes om-memory-system@<plugin version>`. The plugin needs no global install.
7. **The Settings page reads the global version from `package.json`.** After a hand-off, `om-memory-system --version` prints the newest copy's version, so it no longer shows the global install. The server resolves the command on `PATH` to its package folder and reads the file. It reports how the global install compares with the running version.

## Consequences

### Positive

- An update to any one host updates the terminal command, the hooks, and the web app. No manual `npm i -g` is needed.
- The global install is optional.
- The login item never points at a deleted host cache folder.

### Negative

- A global install from 4.3 or earlier has no hand-off code. The user updates it once.
- The `npx` fallback needs network access the first time. A `UserPromptSubmit` can run out of time while `npx` downloads, and then returns no context.
- The hooks need Node.js 22.14 or later on `PATH`.
- Rollback is harder, because the newer copy keeps winning. `OMMS_NO_HANDOFF=1` covers one command. A full rollback removes the newer copy. `om-memory-system web install` then rewrites the item.
- Every hook from an old global install costs one extra Node.js start (about 50 to 100 ms) until the user updates or removes it.
- A copy can run code from another program's cache folder. The code is the same npm package, the copy must pass the validity check, and the record is private to the user.

### Neutral

- A running OpenCode or Pi session keeps the copy it loaded. The record changes what starts next, not what runs now.
- Both this change and the Claude Code status line edit `hooks/hooks.json`. The change that merges second rebases.

## Alternatives Considered

| Option                                     | Rejected Because                                                                                                                  |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| Scan the OpenCode and Pi cache folders     | The layouts belong to those hosts and change between releases. A scan costs time on every hook.                                   |
| Point the `bin` entry at the launcher      | npm's `bin` must point inside the package, and an old global install is the copy that never gets the new entry.                   |
| `launchctl kickstart -k` for the web app   | The running web app is often a detached host start, not the launchd job. A kickstart starts a second process that loses the port. |
| Run `npm i -g` for the user                | It needs write access to the global prefix, can need `sudo`, and changes the machine without a request.                           |
| Pin one version on the machine             | It blocks the update the user asked for. `OMMS_NO_HANDOFF=1` is the only escape hatch.                                            |
| Keep TDR-022's install-time choice of copy | It leaves the terminal command, the hooks, and a running web app on the old copy.                                                 |
