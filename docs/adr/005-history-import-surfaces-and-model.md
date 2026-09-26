# ADR-005: One import command per host, using the session's model by default

**Date:** 2026-09-26
**Status:** Accepted
**Deciders:** Project maintainer
**Supersedes:** ADR-002 in part (import entry points and model choice)

## Context

ADR-002 gave the two hosts different entry points. OpenCode history imported only from a terminal CLI, which called the external model configured in OMMS. Pi history imported only from a Pi slash command, which used Pi's `piProvider`/`piModel` setting before the active model. In practice the saved OMMS model is often an expensive one, and a user importing OpenCode history had to create and pass a separate API key to avoid it. The two hosts also accepted different flags and date rules. The maintainer asked for three things. Each host should use the current session's model by default. A different model should apply only when `--model provider/id` names it. Pi and OpenCode should have the same capabilities.

## Decision

Both hosts offer the same two surfaces with one shared option grammar (`src/importer/import-args.ts`) and one runner and report (`src/importer/run-import.ts`):

- **In a session:** `/memory-import-pi-history` and `/memory-import-opencode-history`.
  - **Default model:** the invoking session's current model, called through the host's own sign-in, so no OMMS API key is needed. `piProvider`/`piModel` still steer live capture but not an import.
  - **`--model provider/id`:** selects another model the host is signed in to. For Pi this is a model in Pi's model registry; for OpenCode, a connected provider. The session's model is unchanged.
  - **OpenCode V2 plugin API:** runs the command natively and posts the report as a synthetic message.
  - **OpenCode V1 plugin API:** registers the command through the `config` hook, does the import in `command.execute.before`, and gives the turn only the finished report to relay.
- **From a terminal:** `om-memory-system import-opencode-history` and `import-pi-history`. With no session there is no session model, so the CLI uses the saved OMMS model or `--provider`, `--model <id>`, `--api-url` and `--api-key-env`. Those flags are rejected inside a session.

Both hosts default to `current-project` scope, take `--project`, `--skip-memories`, `--skip-profile`, `--map`, the same inclusive date rules, and a host-specific source flag (`--root` for Pi, `--db` for OpenCode).

## Consequences

### Positive

- A user can import at the cost of the model they are already using, or a cheaper signed-in one, without creating a key.
- One parser, one runner and one report format keep both hosts and both surfaces in step.

### Negative

- On the V1 OpenCode API a slash command is a model turn, so relaying the report costs one short call to the session model.
- Current-project scope compares project tags by real path so that symlinked paths such as `/var` and `/private/var` on macOS count as one project.
- The OpenCode CLI now defaults to the current project instead of all projects. It needs `--scope all-projects` for a full backfill.

### Neutral

- The CLI keeps the external-API path for imports run outside any session, such as scripts.
- An in-session import runs inside the host process and blocks the session until it finishes; use `--max-sessions` or date filters to split large backfills.

## Alternatives Considered

| Option                                                                                      | Rejected Because                                                                                    |
| ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Keep the CLI-only OpenCode import and add `--opencode-model` via a spawned `opencode serve` | Starts a second OpenCode with the OMMS plugin loaded, slower, and still no "current session" model. |
| Read provider keys from OpenCode's `auth.json`                                              | Fragile, misses OAuth/subscription providers, and handles secrets OMMS should not touch.            |
| Expose the import as a `memory` tool mode                                                   | Lets an agent start a costly backfill on its own; a slash command keeps it user-initiated.          |
| Remove the CLI                                                                              | Leaves no way to import from scripts or when no session is open.                                    |

## References

- `src/importer/import-args.ts`, `src/importer/run-import.ts`
- `src/adapters/opencode/import-command.ts`, `src/index.ts`, `src/v2/adapter.ts`
- `src/adapters/pi/import-command.ts`, `src/adapters/pi/provider.ts` (`resolveImportModel`)
- `src/cli/index.ts`
- `tests/history-import-commands.test.ts`
- `docs/opencode-history-import.md`, `docs/pi-history-import.md`
- ADR-002, TDR-003, TDR-004
