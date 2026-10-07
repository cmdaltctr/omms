# Design

## Context

- `PowerButton.tsx` polls `GET /api/web/status` every 15 seconds. The reply holds `version`, `canControl`, and `instance`. `canControl` is true for a loopback caller of a standalone web app.
- The sidebar brand is the `brand` string in `translations.ts`. It is `omms` in `en`, `zh`, and `ar`, coloured with `text-primary-label`.
- `src/services/update-check.ts` has `latestNpmVersion` and `availableUpdate`. Only the Claude Code status line and the OpenCode footer use them.
- The launcher at `~/.omms/bin/omms-launch.mjs` runs the newest valid copy among the runtime record, the global install beside the running Node.js, and its own copy (`omms-runtime` spec). The login item already runs the launcher.
- A detached-copy restart in `web-power.ts` runs `process.argv`. That is the current copy's own `dist/cli/index.js`, so a plain restart after `npm i -g` would start the old copy again.
- The fix on branch `fix/restart-handoff` makes Restart wait for its own copy by instance ID. This change builds on it.

## Goals / Non-Goals

**Goals:**

- One status poll feeds the power button, the header version, and the update button.
- The update runs and restarts without a terminal, and never leaves the port empty.

**Non-Goals:**

- Updating the OpenCode or Pi plugin copies. Those hosts own their package caches. The dialog lists their commands.
- Updating with Bun, or into a prefix other than the one beside the running Node.js.
- A notice for prereleases or the `next` tag.

## Decisions

1. **Shared status hook.** Move the poll out of `PowerButton` into a `useWebStatus` hook with one module-level timer. The header, the power button, and the update button read from it. _Alternative:_ the header calls `/api/settings/version`. Rejected: that adds a second schedule, and that route also reads the global install from disk.
2. **Brand colour as a token.** Add `--brand-label: #678D6C` to both themes in `app.css`, and map it to a Tailwind colour. The brand text becomes `OMMS` in all three languages. On the light background the contrast is about 3.9:1. WCAG 1.4.3 exempts logotypes, and the version next to it keeps the normal text colour. _Alternative:_ reuse `--status-success`. Rejected: the user chose `#678D6C`.
3. **The server checks npm, not the browser.** The web app runs the check at start and then every 6 hours, and keeps the result in memory. This avoids a browser request to `registry.npmjs.org` on every page, follows `OMMS_DISABLE_UPDATE_CHECK`, and lets every open page share one result. `/api/web/status` gains `update: { available, state, code, canInstall }`.
4. **Install with the npm beside Node.js.** The command is `<dirname(process.execPath)>/npm` (`npm.cmd` on Windows) with arguments `["install", "-g", "om-memory-system@<version>"]`. The install runs with a fixed argument list and without a shell, except on Windows, where `npm.cmd` runs only through one. `<version>` must match a plain `x.y.z` pattern before it reaches the argument list, because it comes from the registry. This npm installs into the prefix that the launcher checks for a global install. When the file does not exist, for example under Bun, `canInstall` is false. _Alternative:_ `npm` from `PATH`. Rejected: the login item's `PATH` is short, and a different npm can install into a prefix the launcher never reads.
5. **Check before restart.** After npm exits with code 0, read the version of the install beside the running Node.js with `globalCommandVersion({ find: () => null })`. That is where this npm installs; the first command on `PATH` can belong to another install. Restart only when it equals the target version. Otherwise report `version-mismatch`.
6. **Restart through the launcher.** Add an option to the power action that runs `[launcherPath(~/.omms), "web"]` in place of `process.argv`. A login item restart already runs the launcher through the service manager. The launcher passes the environment through, so the copy keeps `OMMS_WEB_INSTANCE`, and the handoff from `fix/restart-handoff` still matches the copy. When the launcher file is missing, report `no-launcher` and keep serving.
7. **State and failure codes.** The state lives in memory as `idle | installing | restarting | failed`. Codes: `permission` (`EACCES` or `EPERM` in npm's error stream), `network` (`ENOTFOUND`, `ETIMEDOUT`, `ECONNRESET`, `EAI_AGAIN`), `npm-exit`, `timeout`, `spawn-error`, `bad-version`, `version-mismatch`, `no-launcher`, and the restart codes. A missing npm is no code: the route answers `409` and `canInstall` is false. The runner scans npm's error stream in memory to pick a code and then drops it. Log records hold the code, both versions, the exit code, and the duration.
8. **Route guards.** `POST /api/web/update` reuses the Restart guard: loopback and local token. A repeated request while the state is `installing` or `restarting` gets `202` and does nothing.

## Risks / Trade-offs

- [A global npm prefix needs `sudo`] → npm fails with `EACCES`. The dialog shows `permission` and points to the global command, which the user runs with their own setup.
- [npm takes a long time on a slow network] → The 5-minute timeout stops npm. The page shows progress until the state changes.
- [A partial install after a timeout] → npm writes into a staging folder and renames at the end. The check in decision 5 stops a restart onto a broken copy, and the launcher skips copies without `dist/cli/index.js`.
- [Another web app takes the port during the restart] → The `fix/restart-handoff` rules apply. An older owner steps aside, and a same or newer owner keeps the port.
- [The record names a newer cached copy than the new global] → The launcher picks the newest copy, so the header can show a version above the one npm installed. The header still shows the truth.

## Migration Plan

Merge `fix/restart-handoff` first. Rebase this branch on it. No data or config migration is needed. Rollback means reverting the release. Older pages hide the update button because they never read the `update` field.
