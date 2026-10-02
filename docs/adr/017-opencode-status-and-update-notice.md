# ADR-017: OpenCode shows OMMS status and a newer-release notice

**Date:** 2026-10-02
**Status:** Proposed
**Deciders:** OMMS maintainers

## Context

Pi shows OMMS state in its footer and reports package updates at start. OpenCode showed neither.

- OpenCode caches an npm plugin once and keeps it until `opencode plugin update`. It never checks npm again. On 2026-10-01 OpenCode still ran 3.6.2 after 4.2.0 shipped.
- The host parity rule asks for the same user capabilities on Pi and OpenCode.

## Decision

1. Ship an OpenCode TUI entry, `opencode/tui.tsx`, exported as `./tui`. It shows `omms:connected`, or `omms:web app off` when the web app health route does not answer.
2. At start and every 6 hours, read `https://registry.npmjs.org/om-memory-system/latest`. When it is a newer stable version, add `· <version> available` to the footer and show one toast naming `opencode plugin update om-memory-system`.
3. The check sends no session content. `OMMS_DISABLE_UPDATE_CHECK=1` turns it off. A failed check shows nothing.
4. OMMS does not update OpenCode's cached plugin itself. The user runs the command.

## Consequences

### Positive

- OpenCode users see that OMMS is loaded, and learn about new releases.
- Pi and OpenCode reach parity for status and update notices.

### Negative

- OpenCode makes one public network request to npm every 6 hours.
- The footer loads only from the npm package; a local plugin folder needs its own `tui.tsx`.

## Alternatives Considered

| Option                                   | Rejected Because                                                   |
| ---------------------------------------- | ------------------------------------------------------------------ |
| Update OpenCode's plugin cache from OMMS | Writes into another tool's cache and can break a running OpenCode. |
| Toast only, no footer                    | Gives no lasting sign that OMMS is loaded, unlike Pi.              |
| Check on every start only                | Long-running OpenCode servers would not see a release for days.    |
