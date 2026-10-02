# Design

## Context

Pi shows OMMS state through its extension status API. OpenCode v2 loads a TUI plugin from a package's `./tui` export. OpenCode caches a plugin from npm once and keeps it until `opencode plugin update`. The login item was written by whichever OMMS copy started a host.

## Goals / Non-Goals

**Goals:** footer status and update notice in OpenCode; a login item that never downgrades; fix two Settings display defects.

**Non-Goals:** updating OpenCode's cached plugin automatically; an update notice for Claude Code (its plugin manager already reports updates).

## Decisions

1. **TUI entry.** `opencode/tui.tsx` is exported as `./tui` and shipped in `files`. Pure logic lives in `src/adapters/opencode/tui-status.ts` (`tuiStatusText`, `latestNpmVersion`, `availableUpdate`), so tests need no OpenCode runtime.
2. **Update check.** One GET to the npm registry `latest` endpoint with a 5 second timeout, at start and every 6 hours. Prereleases are ignored. Failures show nothing.
3. **Login item copy.** `preferredPackageRoot` compares the versions of three candidates with `compareVersions` and keeps the newest valid one. `itemPackageRoot` reads the current copy back from the written item.
4. **Wording.** Plural chosen by count in the components; confidence rounded with `Math.round`.

## Risks / Trade-offs

- [The footer needs OpenCode's TUI plugin API.] → It loads only from the npm package, which has the `./tui` export. Older OpenCode versions ignore it.
- [The update check makes a network call.] → It reads one public version number, and the environment variable turns it off.
