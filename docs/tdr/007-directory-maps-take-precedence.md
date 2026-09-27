# TDR-007: Directory maps take precedence on both hosts, and a Pi root may be one file

**Date:** 2026-09-27
**Status:** Accepted
**Deciders:** Aizat Hawari
**Tags:** importer, opencode, pi, web-settings

## Context

The web Settings page lists sessions and later imports the selected ones. The list and the importer must resolve each session's project the same way, or a selection could import sessions the user never saw. The hosts disagreed:

- Pi used an exact `--map` first, then the recorded directory.
- OpenCode used the recorded directory first when it still existed, then a map, then the project worktree. A map for a recorded path that still existed was ignored without a warning.

Separately, `--root <file.jsonl>` found no sessions and reported no error, because discovery treated the root as a folder.

## Decision

One resolver, `src/importer/import-project.ts`, serves the session list and both importers:

1. An exact directory map. If its target is not a directory, the session is unresolved; it does not fall back.
2. The recorded directory, if it exists.
3. OpenCode only: the project worktree, if it exists and is not `/`.
4. Otherwise unresolved.

Pi discovery accepts a file root and reports it as one session. Header reads stop at 64 KB.

## Consequences

### Positive

- The listed set and the imported set always match.
- A map is an explicit instruction, and both hosts now follow it.
- `--root <file>` imports that file.

### Negative

- An OpenCode CLI run with a map whose source path still exists now files memories under the map's target. Before, the map was ignored.
- An OpenCode map whose target is missing now leaves the session unresolved instead of falling back to the worktree.

### Neutral

- Ledger keys do not change, so earlier imports stay recognised.

## Alternatives Considered

| Option                                | Rejected Because                                                            |
| ------------------------------------- | --------------------------------------------------------------------------- |
| Keep OpenCode's order and document it | The page would need per-host rules, and an explicit map would stay a no-op. |
| Make Pi follow OpenCode's order       | Changes Pi, whose order already matched user intent.                        |

## How to Recognise / Handle This Again

1. Symptom: memories from an OpenCode import land under an unexpected project after adding `--map`.
2. Check whether the map's `old` path matches the recorded directory exactly.
3. Remove or correct the map; the ledger keeps already imported units from repeating.

## Revisit Triggers

Prefix maps (mapping a parent folder) or a new host with its own project model.

## References

- `src/importer/import-project.ts`
- `openspec/changes/web-settings/design.md` (Project resolution)
- `tests/import-sources.test.ts`, `tests/opencode-reader.test.ts`, `tests/pi-importer.test.ts`
