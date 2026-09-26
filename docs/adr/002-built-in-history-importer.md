# ADR-002: Replace backfill scripts with a built-in history importer

**Date:** 2026-09-25
**Status:** Accepted (entry points and model choice superseded by [ADR-005](./005-history-import-surfaces-and-model.md))
**Deciders:** Project maintainer

## Context

The previous OpenCode backfill scripts target old storage paths, project tags and an unauthenticated web API. They cannot rebuild memories into OMMS. The Pi importer can rebuild memories but does not feed profile learning. A machine move left historical sessions available while the memory store was empty.

## Decision

Use one shared importer core for both hosts. Expose OpenCode V1 history through a terminal CLI and Pi history through a Pi slash command. Each importer reads its source without changing it, resolves projects, and uses a durable ledger for safe reruns. Build profile learning from recorded user prompts in a host-neutral core module. Both entry points offer a separate import model choice without changing the agent's active model or saved configuration.

The built-in three-step import supersedes `backfill-memories.py`, `backfill-profile.py` and `build-profile.py`.

## Consequences

### Positive

- One pipeline applies the same memory and profile rules to both hosts.
- A preview exposes work and model cost before a real run.

### Negative

- The importer must track source format changes in both hosts.
- Historical model calls can cost money and take time.

### Neutral

- The old scripts remain outside the project but are no longer supported for OMMS.

## Alternatives Considered

| Option                                         | Rejected Because                                                 |
| ---------------------------------------------- | ---------------------------------------------------------------- |
| Repair the three Python scripts                | Keeps duplicate storage and profile logic outside OMMS.          |
| Use the web API for backfill                   | Adds a running server and token dependency to a local migration. |
| Keep separate Pi and OpenCode import pipelines | Duplicates recovery and profile behaviour.                       |

## References

- `openspec/changes/history-import/proposal.md`
- `src/importer/importer.ts`
- `src/importer/opencode-import.ts`
- `src/importer/profile-import.ts`
- `src/core/profile-analysis.ts`
- `docs/opencode-history-import.md`
- `docs/pi-history-import.md`
