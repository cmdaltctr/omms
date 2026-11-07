# TDR-068: The Claude recall parser fixes the space attribute order

**Date:** 2026-11-06
**Status:** Accepted
**Deciders:** Aizat Hawari
**Tags:** claude-code, recall, linked-spaces, parser

## Context

A recalled memory from a linked space must carry the name of its space in the memory context block (design D6). `src/services/context.ts` builds the `<memory>` element; the Claude Code hook `hooks/omms-recall-parse.js` parses the block back into rows for the visible recall list.

### Root Cause Analysis

The hook parses with one regex, and the regex pins the attribute order of the opening tag: `id` first, then `relevance`, then an optional `space`:

```js
/<memory (?:id="([^"]*)" )?relevance="(\d+)%"(?: space="[^"]*")?>/g;
```

The label therefore must print after `relevance`. Printed before it, the regex stops matching the opening tag, the whole element is skipped, and the memory text never reaches the recall rows — the memory is recalled in Pi and OpenCode and silently dropped in Claude Code.

The gap would ship unnoticed: `ci:local` runs `check`, `build` and the isolated test files (`scripts/local-ci.sh`), and never runs `scripts/test-claude-mod.sh`, which is the only gate that exercises the hook parser.

## Decision

- `src/services/context.ts` prints the label last: `<memory id="..." relevance="87%" space="Name">`. A comment in both files states that the order is load-bearing.
- `hooks/omms-recall-parse.js` accepts the optional `space="..."` attribute and ignores its value; the recall rows do not show it.
- `bash scripts/test-claude-mod.sh` stays a required gate after any change to the context block.

## Consequences

### Positive

- Linked memories recall in Claude Code with their label, and own-space memories recall unchanged.
- The constraint is written where the next change will read it.

### Negative

- The attribute order of `<memory>` is frozen: a new attribute must go after `relevance` and must be optional in the regex.
- A parser change can still ship unguarded, because `ci:local` does not run the mod tests.

### Neutral

- Pi and OpenCode read the block as text, so the order does not matter to them.

## Alternatives Considered

| Option                              | Rejected Because                                                           |
| ----------------------------------- | -------------------------------------------------------------------------- |
| Parse attributes in any order       | Needs a real HTML parser in a hook that must stay fast and dependency-free |
| Put the space name in the body text | Mixes metadata with memory text, and every host would show it              |

## How to Recognise / Handle This Again

1. Symptom: a recalled memory appears in Pi or OpenCode but not in Claude Code's recall rows.
2. Diff the `<memory>` opening tag against the regex in `hooks/omms-recall-parse.js`.
3. Run `bash scripts/test-claude-mod.sh` after any change to `src/services/context.ts`.

## Revisit Triggers

- A new attribute on the `<memory>` element.
- A shape change to the recall block.
- `test-claude-mod.sh` joining `ci:local`, which would close the gate gap.
