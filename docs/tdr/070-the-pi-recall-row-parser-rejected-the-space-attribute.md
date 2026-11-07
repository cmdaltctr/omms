# TDR-070: The Pi recall row parser rejected the space attribute

**Date:** 2026-11-07
**Status:** Accepted
**Deciders:** Aizat Hawari
**Tags:** pi, opencode, recall, linked-spaces, parser, live-check

## Context

The live check of the `memory-space-transfer` change (task 11.1) ran a real Pi turn that recalled a linked memory. The injection worked — the model answered from the linked memory — but no recall row appeared and `omms.log` held no `Pi recall: summary recorded` line, while a turn that recalled two own memories recorded its row.

### Root Cause Analysis

TDR-068 fixed the Claude Code hook parser for the new `space="..."` attribute and recorded that Pi and OpenCode "read the block as text". That holds for the model, which only reads the injected section, but both hosts also parse the section to draw visible recall rows through `buildRecallSummary` in `src/core/recall-summary.ts`. Its `MEMORY_ENTRY` regex required the tag to close right after the relevance:

```
<memory(?:\s+id="([^"]*)")?\s+relevance="(\d+)%">
```

`<memory id="..." relevance="65%" space="ClientX">` therefore never matched. A recall whose results were all linked produced no row at all; a mixed recall drew a row with the linked entries missing from the count. The unit tests covered sections without the attribute, so `ci:local` stayed green.

## Decision

- `MEMORY_ENTRY` accepts any number of extra attributes after the relevance before the tag closes: `(?:\s+[a-z][a-z-]*="[^"]*")*`. The id and relevance captures are unchanged, so the row summary keeps its shape.
- A regression test in `tests/recall-summary.test.ts` feeds a section with `space="ClientX"` and expects the item.
- The comment above the regex now names the linked-space attribute as the reason extra attributes are allowed.

## Consequences

### Positive

- Linked memories draw recall rows in the Pi widget and the OpenCode TUI, with the right count.
- Future optional attributes after `relevance` parse without another change.

### Negative

- The attribute order before `relevance` stays frozen: a new attribute must still go after `relevance` (the rule TDR-068 set).

### Neutral

- The row summary ignores the space name; only the count and headline show.

## Alternatives Considered

| Option                         | Rejected Because                                                           |
| ------------------------------ | -------------------------------------------------------------------------- |
| Show the space name in the row | Out of scope for the fix; the row format is a separate presentation choice |
| Parse attributes in any order  | Same cost/benefit as TDR-068: heavier parser for one known attribute order |

## How to Recognise / Handle This Again

1. Symptom: the model answers from a recalled memory but no recall row appears, or the row count is lower than the injected memories.
2. Diff the `<memory>` opening tag against `MEMORY_ENTRY` in `src/core/recall-summary.ts`.
3. Add the new shape to `tests/recall-summary.test.ts` before changing the regex.

## Revisit Triggers

- A new attribute on the `<memory>` element.
- A host that parses the section with its own regex instead of `buildRecallSummary`.
