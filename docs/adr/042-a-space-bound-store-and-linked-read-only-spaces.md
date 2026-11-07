# ADR-042: A space-bound store and linked read-only spaces

- **Date:** 2026-11-06
- **Status:** Proposed
- **Deciders:** Aizat Hawari
- **Change:** [`memory-space-transfer`](../../openspec/changes/memory-space-transfer/proposal.md)

## Context

ADR-041 gave each space its own folder, but every store class still read its root from `CONFIG.storagePath`. A transfer between two spaces, an export and an import all need to open a folder that is not the active space, without switching the active space and without a host turn in the same process writing to the wrong folder.

Spaces also stayed islands. A space that builds on another space's work could not read it, and a search never crossed the gap.

## Decision

1. **A space-bound store takes its root folder as an argument.** `openSpaceStore(folder, mode)` (`src/services/spaces/space-store.ts`) returns its own connection manager, shard manager and locks, rooted at `folder`. To make that possible, `TursoConnectionManager` takes an optional `allowedRoots` provider, `TursoShardManager` takes `{ root, connections }`, the cross-process write lock and the operation lock take a `root`, and `UserProfileManager` takes an optional `root` for profile import. The singletons keep their constructor defaults, so hosts see no change and the existing tests pass unchanged.
2. **Two open modes.** _Write_ (transfer target, import target, move source) creates a shard on demand and takes the write lock per scope. _Read_ (preview, copy source, export, linked search) opens only files that exist, sets `PRAGMA query_only = ON`, creates no file and takes no lock; a missing `metadata.db` means an empty space. A read store for a linked space is cached per folder for the life of the process and registered with `resettable()`. A write store lives for one operation and closes in `finally`.
3. **A space-bound store uses the same lock files as a host that has that space active.** A transfer and a capture on the same space exclude each other, across processes.
4. **Links live in the registry.** `SpaceEntry` gains `links?: string[]` (space ids). A link to a deleted or archived space stays in `spaces.json` and reads as unavailable. An older file without `links` stays valid.
5. **The Default space cannot own links.** Any other space can list linked spaces; Default can be the _target_ of a link but never the owner. Default is the fall-back store every host reads, so a link list on it would change recall for every project at once.
6. **Linked search is opt-in per caller.** `searchMemories` and `listMemories` take `{ includeLinked }`, default `false`. Only the recall surfaces pass `true`: the retrieval sections, the session-start recent list, the `memory` tool `search` and `list`, and the chat retrieve. The capture step, the profile step, the dedupe reads and the duplicate checks keep the default, so a capture never decides on a linked memory and never writes to one.
7. **Own results rank first.** Linked results append after the own results, sorted by similarity, up to the result limit. The reranker does not see them. Each linked result carries the name of its space, printed as `space="<name>"` after the `relevance` attribute on the `<memory>` element — the Claude Code recall parser matches attributes in that order.
8. **A linked space is searched under a stricter model rule.** The dimensions must match and, when the linked space records an embedding model, the model too. A model mismatch with equal dimensions returns wrong results with no error, and a linked space is searched with a vector it never produced. A space that records no model (a legacy shard) passes on the dimensions alone.
9. **`forget` and `edit` refuse a memory of a linked space**, naming the space. Linked spaces are read-only through and through.

## Alternatives rejected

- **Swap `CONFIG.storagePath` for the length of a call.** It is global state. A host turn or a web request in the same process would read or write the wrong space.
- **Require the target space to be active.** A move between two non-active spaces would need a switch, which hits every host.
- **Run the transfer in a child process with another storage path.** Slow to start, hard to report progress, and it duplicates the config loading.
- **Always search linked spaces.** The capture step would skip a memory that exists only in a linked space, so a link would silently stop capture.
- **Transitive links.** A link reaches its target and no further. Depth is unbounded otherwise, and a cycle would loop.

## Consequences

Positive:

- A transfer, an export and an import open any two spaces without a switch and without touching the hosts' store.
- A read-only open cannot corrupt a linked space: no lock taken, no file created, no schema change.
- One implementation of each operation serves the web app, the CLI and the tool.

Negative:

- The root parameter touches the shared store classes. The defaults keep today's behaviour and the existing tests pass unchanged, but every new store class must keep taking its root as an argument or the space store cannot open it.
- A cached read store holds file handles. `resettable()` closes them on a switch or a registry change, and a delete of a linked space closes its cached store first.
- The Default space cannot own links, so a user who wants Default to read another space must switch to a different space as the working store.
- A capture never sees linked memories, by design. A memory that exists only in a linked space is captured again into the own space.
