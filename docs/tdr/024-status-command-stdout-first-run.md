# TDR-024: Keep the first-run config message off the status command's stdout

- **Date:** 2026-10-02
- **Status:** Proposed
- **Deciders:** OMMS maintainers
- **Tags:** Claude Code, status line, config, stdout

## Context

`om-memory-system claude-hook status` must print one JSON line. The Claude Code status module parses it. On a machine with no config file, the first import of `src/config.js` runs `ensureConfigExists()` (`src/config.ts`, called at module load). It writes the template and prints `✓ Created config template: ...` with `console.log`. That text came before the JSON, and `JSON.parse` failed.

### Root Cause Analysis

`tests/cli-handoff.test.ts` ran the command with an empty `HOME`. The output started with `\n✓ Created config template`. The message prints at import time, so wrapping `initConfig` alone did not help.

## Decision

`loadClaudeStatusInputs` in `src/adapters/claude-code/status.ts` sets `console.log = console.error` before it imports `config.js`, and restores it in `finally`. The message goes to stderr. Stdout holds only the JSON line.

`tests/claude-hook-status.test.ts` runs the real command with an empty `HOME` and parses stdout.

## Consequences

### Positive

- A first run on a clean machine still gives valid JSON.
- The user still sees the template message, on stderr.

### Negative

- The redirect is local to the status command. Other hook events import `config.js` through `loadWebSettings` and can still print this message on stdout of a first run.

## Alternatives Considered

| Option                                         | Rejected Because                                                           |
| ---------------------------------------------- | -------------------------------------------------------------------------- |
| Parse the last line of stdout in the module    | Hides the cause, and a future message after the JSON would still break it. |
| Change `ensureConfigExists` to print to stderr | Touches every host's start-up output. Needs its own change and tests.      |
| Silence the message                            | The user would not learn that OMMS wrote a config file.                    |

## How to Recognise / Handle This Again

- Symptom: the status line never shows a version or an update, and `claude-hook status` output does not start with `{`.
- Check: `HOME=$(mktemp -d) om-memory-system claude-hook status`. Stdout must be one JSON line.
- Any new `console.log` reached at import time in the status path needs the same care.

## Revisit Triggers

- `ensureConfigExists` moves to stderr or to an explicit init step.
- Other hook events start to print machine-read output on a first run.

## References

- `src/adapters/claude-code/status.ts`, `src/config.ts` (`ensureConfigExists`)
- `tests/claude-hook-status.test.ts`
- [ADR-019](../adr/019-claude-code-status-line-through-a-plugin-module.md)
