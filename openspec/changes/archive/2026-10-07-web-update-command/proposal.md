# Proposal

## Why

A host update (OpenCode, Pi, Claude Code) can leave the global `om-memory-system` install on an old version, and the web app's **Update web app** button only appears when npm has a release newer than the running web app. On the author's machine the web app ran 4.10.0, npm `latest` was 4.10.0, and the global install stayed on 4.4.1, so no part of OMMS offered a way to update it. Users need one terminal command that brings the global install to npm `latest` and replaces every running web app with a fresh one.

## What Changes

- Add `om-memory-system web update`.
  - Read npm `latest`. When the global install is missing or older, run `npm install -g om-memory-system@<latest>` with the npm beside the Node.js that runs the command. The command works when no web app runs.
  - Stop every standalone OMMS web app on this machine: the web app that serves the port and the web apps that wait for the port.
  - Start one fresh web app through the OMMS launcher, so the newest copy serves. Use the login item when it is installed.
  - Wait until the port answers with the new web app, then print `OMMS web app: <url> (version <version>)`.
  - When the global install is already on `latest`, skip npm and still replace the running web apps.
  - When npm fails, times out, or leaves another version, report the failure code, exit with code `1`, and leave the running web app alone.
- Let a loopback caller with the local API token replace a web app of the same version. Today a step-aside request is refused unless the caller is newer.
- Make a standalone web app that waits for the port exit when `web update` asks every web app started before it to retire.
- Share the npm install steps (timeout, failure codes, version check) between the web app's update button and the new command.
- Add `update` to the `web` usage line, the `--help` text, and `docs/cli.md` and `docs/upgrading.md`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `web-autostart`: the terminal gains `web update`, which updates the global install and replaces every standalone web app, and web apps accept a forced replace from the local terminal.

## Impact

- `src/cli/web-command.ts`, `src/cli/index.ts`: new `update` action and help text.
- New module for the update flow under `src/cli/` (npm step, replace step, start step, wait step), with injected dependencies for tests.
- `src/services/web-update.ts`: the npm install runner moves out of the `WebUpdate` class into a shared function. The update button keeps its behaviour.
- `src/services/web-server.ts`: the step-aside route accepts a forced replace; the waiting loop reads a retire marker in `~/.omms`.
- `docs/cli.md`, `docs/upgrading.md`.
- No new dependency. No change to OpenCode, Pi, or Claude Code adapters: the command is host-neutral.
- Out of scope: `runtime.json` can name a copy in the `~/.npm/_npx` cache, which npm can delete. This change does not move the record to the global install when the versions are equal.
