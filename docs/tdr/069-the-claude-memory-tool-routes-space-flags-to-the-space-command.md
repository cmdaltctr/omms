# TDR-069: The Claude memory tool routes space transfer flags to the space command

**Date:** 2026-11-07
**Status:** Accepted
**Deciders:** Aizat Hawari
**Tags:** claude-code, memory-tool, spaces, transfer, cli

## Context

The Claude Code `memory` tool has one `space` mode for every space action (design D8 of the `memory-space-transfer` change). The hook (`hooks/omms-memory-tool.jsx`) turns the tool's arguments into a CLI command line and runs it. The transfer flags of the change — `to`, `since`, `until`, `project`, `in` — are parsed only by the `space <action>` CLI command (`src/cli/space-command.ts`); `memory space <action>` predates them and does not accept them.

### Root Cause Analysis

One tool schema serves two CLI parsers. A call such as `space preview Alpha --to Beta` cannot run as `memory space --action preview --name Alpha --to Beta`: the `memory space` parser rejects the unknown `--to` flag. Duplicating the flag parsing inside `memory space` would put the same rules in two places, and the `space` command already runs the same shared operation (`src/services/spaces/operations.ts`) with the CLI's portability bridge attached.

## Decision

`memoryArgs` routes per call:

- With none of `to`, `since`, `until`, `project`, `in`, the call stays `memory space --action ... --name ...` exactly as before.
- With any of them, the call becomes the `space` command directly: `space <action> <name> --to ...`. A comment in the hook states the rule.

The tool's refusal of whole-store actions still holds, for three reasons checked in the code:

1. `move` is refused by the shared operation with the web app message, whatever route reached it.
2. `export` needs `--out <file>` and `import` needs a file path; neither flag exists in the tool schema, so a dual-routed call cannot supply what those runners require.
3. The schema's `space` description names the offered actions and points move, delete, export and import at the web app or the CLI.

## Consequences

### Positive

- The transfer flags are parsed in exactly one place (`space-command.ts`), and the tool gains preview, copy, link and unlink without a second parser.
- Calls without transfer flags are byte-identical to the previous command line, so existing behaviour and tests are untouched.

### Negative

- The routing rule lives in the hook, not in a shared module; the Pi and OpenCode schemas declare the same arguments but build their calls in their own adapters.
- A future flag added to `space` must be added to the hook's dual-route list by hand, or tool calls carrying it fall back to `memory space` and fail on the unknown flag.
