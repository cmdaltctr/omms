# Design

## Context

See proposal.md for the motivation. Current state:

- `src/services/web-autostart.ts` writes the login item with a fixed path, `<package>/dist/cli/index.js`. `preferredPackageRoot` picks the newest of three copies at install time. The item has `KeepAlive` off, and a rewrite does not restart a running web app.
- `src/services/web-ensure.ts` (`ensureWebApp`) is the shared start rule for OpenCode, Pi, and the Claude Code hook client. When any OMMS web app answers, it returns `running`.
- `src/cli/web-command.ts` already has a version handover for `web install`: `readWebVersion` (`/api/settings/version`), then `POST /api/web/step-aside` with the local token headers, then a wait until the port is free.
- `hooks/hooks.json` runs `om-memory-system claude-hook <event>` from `PATH`. The Claude Code plugin is the whole repository (`marketplace.json` `source: "./"`). It has no `dist/`, so the plugin cannot run OMMS code from its own folder.
- OpenCode keeps old copies in `~/.cache/opencode/npm/om-memory-system@latest/<timestamp>/` and can delete them.

## Goals / Non-Goals

**Goals:**

- One rule decides which copy runs, and the terminal command, the hooks, and the login item all use it.
- No network, no `sudo`, and no write outside `~/.omms` for local copies.
- An old copy never needs an update before it runs new code.

**Non-Goals:**

- Running `npm i -g` for the user.
- Deleting old host copies or cleaning OpenCode's cache.
- Pinning a version for rollback. `OMMS_NO_HANDOFF=1` is the only escape hatch.
- Hot reload of OMMS code inside a running OpenCode or Pi session. The host still loads its own copy.

## Decisions

### 1. A record file instead of a search of known cache folders

`~/.omms/runtime.json` holds `{ root, version, updatedAt }`. Each copy writes itself when it is newer, or when the record's copy is gone or not valid.

- Alternative: the launcher scans OpenCode's and Pi's cache folders. Rejected: the folder layouts belong to the hosts and change between releases, and a scan costs time on every hook.
- Writes use `.tmp` and rename, mode 0600, in the existing 0700 `~/.omms` folder. Concurrent writers compare then rename. The last rename wins, and the next start corrects a lower version. The spec allows this because the record always names a valid copy.
- Tie on version: keep the record. This stops churn when two copies of the same version start.

### 2. One launcher file, shared by the hooks, the login item, and the hand-off

`bin/omms-launch.mjs` is a plain ES module with Node built-ins only, committed in the repo (so the Claude Code plugin has it) and listed in `package.json` `files` (so every npm copy has it). It exports a pure `chooseCopy(candidates, minVersion)` and has a `main` that runs when the file is run directly.

- It carries its own small SemVer compare (about 20 lines). It cannot import `src/services/version-compare.ts`, because the plugin has no `dist/`. A test runs both compares over the same version list to keep them the same.
- It runs the chosen copy with `child_process.spawn(process.execPath, [<root>/dist/cli/index.js, ...args], { stdio: "inherit" })` and exits with the child's code. Standard input flows through, and the hooks need that for their JSON input.
- Candidates, in order: the record, the global install beside `process.execPath` (same rule as `globalPackageRoot`), and the launcher's own package root when that root has `dist/`.
- `npx` fallback: only with the `--at-least-own-version` flag, which the hooks pass. The launcher then reads the version from the `package.json` beside it (the plugin's version). When no candidate reaches that version, it runs `npx --yes om-memory-system@<version> <args>`. `hooks.json` holds no version number.
- The newest copy copies its launcher to `~/.omms/bin/omms-launch.mjs` when it writes the record, or when the file there differs. The login item runs `node ~/.omms/bin/omms-launch.mjs web --login-item`. That path never changes, so the item stops going stale.

### 3. The CLI hand-off reuses the launcher's choice

At the top of `runCli`, before any other import: when `OMMS_NO_HANDOFF` is not `1` and `OMMS_HANDED_OFF` is not set, read the record. If it names a valid copy that is newer than `packageVersion()`, spawn that copy with `OMMS_HANDED_OFF=1` and return its exit code. `OMMS_HANDED_OFF` stops a loop when two records disagree. Otherwise, register the own copy (decision 1) and continue. Record reading lives in `src/services/runtime-record.ts`, a pure module that takes its paths and file functions as arguments, so tests need no real home folder and `config.ts` stubs do not matter.

- Alternative: always go through the launcher (make `bin` point at it). Rejected: npm's `bin` must point inside the package, and an old global install is exactly the copy that never gets the new `bin` entry. The hand-off must live in code that old installs gain on their next update, and every new version has it.

### 4. Replace an older web app through the existing step-aside route

Move `readWebVersion` and `negotiateOwner` from `web-command.ts` to `src/services/web-handover.ts`. `ensureWebApp` gains an option `replaceOlder: { version, headers }`. When the running version is older than `version`, it takes the start lock, runs the handover, and then follows the empty-port path. The spawn target becomes `~/.omms/bin/omms-launch.mjs web` when that file exists, and the own CLI script otherwise.

- OpenCode and Pi pass `replaceOlder` with the record's version at session start. The Claude Code client passes it only for `session-start`.
- The start lock already makes concurrent replacements safe. The second host takes the `waitForOther` path and finds the new version.
- Alternative: `launchctl kickstart -k`. Rejected: the running web app is often a detached host start, not the launchd job, so kickstart would start a second process that loses the port.

### 5. Global version from `package.json`

`global-version.ts` stops running `om-memory-system --version`, because after the hand-off that prints the newest version. It finds the command on `PATH` as now, resolves the symlink to the package folder, and reads `package.json`.

## Risks / Trade-offs

- [A host cache copy is deleted while the record names it] → Every reader checks that the copy is valid and falls back. The next start rewrites the record.
- [`npx` download is slow on the first hook after a plugin update] → `SessionStart` has a 20 s timeout and usually warms the npx cache. A `UserPromptSubmit` that times out returns no context, which the spec already allows.
- [`npx` needs network and npm] → Only used when no local copy is new enough. When it fails, the hook returns nothing.
- [Node.js missing for Claude Code users without a global install] → The same as today: the hook fails and Claude Code continues. The docs state that Node.js 22.14 or later is required.
- [Running code from another program's cache folder] → The code is the same signed npm package. The copy must pass the validity check, and the record is private to the user.
- [Rollback is harder: a newer copy keeps winning] → `OMMS_NO_HANDOFF=1` for one command. A full rollback means removing the newer copy. Recorded in the ADR.
- [Extra process on every hook when the global install is old] → About 50–100 ms of Node start. The cost goes away once the global install is updated or removed.
- [Overlap with `claude-code-status-line`] → Both edit `hooks/hooks.json`. The second change to merge rebases, and its `status` command runs through the launcher.

## Migration Plan

1. Release as a minor version. Each copy at the new version writes the record and the launcher on its first start.
2. The first OpenCode or Pi start rewrites the login item to the launcher and replaces an older running web app.
3. Old global installs (4.3.x and earlier) have no hand-off code. They keep running their own code for terminal commands until the user updates them once. After that, every later update flows through the record. The Claude Code hooks stop using them at once, because the launcher in the plugin chooses the copy.
4. Rollback: release a fix forward, or set `OMMS_NO_HANDOFF=1` and remove the newer copy. Run `om-memory-system web install` from the copy to keep. Removing `~/.omms/runtime.json` and `~/.omms/bin/` returns to the old behaviour for copies without the record.
