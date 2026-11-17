# host-neutral-memory-core Specification

## Purpose

Defines reusable memory services that let OpenCode and Pi share one compatible store without host-specific lifecycle dependencies.

## Requirements

### Requirement: Shared memory operations are host-neutral

The system SHALL expose reusable memory operations without requiring OpenCode or Pi lifecycle types.

The shared operations SHALL cover, where applicable, memory persistence, retrieval, vector search, embeddings, privacy filtering, deduplication, project identity, user profiles, cleanup, portability, and capture/extraction orchestration.

#### Scenario: Pi stores a memory without an OpenCode plugin context

- **WHEN** the Pi adapter submits a valid normalized memory/capture request for a project
- **THEN** the shared core SHALL process it without requiring OpenCode `PluginInput`
- **AND** it SHALL persist to the same configured memory store used by OpenCode

### Requirement: Capture accepts a normalized host-neutral work unit

Automatic capture SHALL accept a normalized work unit that contains visible user, assistant, tool, source-identity, project, session, and provenance data without host SDK objects.

#### Scenario: A host includes hidden reasoning in its native transcript

- **WHEN** the host adapter builds a capture work unit
- **THEN** hidden thinking/reasoning SHALL be excluded before the work unit enters shared extraction
- **AND** the shared pipeline SHALL operate only on the normalized visible content

### Requirement: Provider-specific extraction is behind a narrow port

The shared capture/profile pipeline SHALL depend on a provider-neutral structured-extraction interface rather than directly on OpenCode or Pi model APIs. Shared code in `src/core/`, `src/services/`, `src/types/`, `src/utils/`, `src/shared/`, `src/importer/` and `src/config.ts` SHALL NOT import a host adapter module. Shared code in `src/core/`, `src/services/`, `src/types/`, `src/utils/`, `src/shared/` and `src/config.ts` SHALL NOT import a host SDK (`@opencode/*`, `@opencode-ai/*` or `@earendil-works/*`), statically, type-only or dynamically. The importer MAY load a host SDK with dynamic `import()` only in its named modules that read host data without the host running. A host SHALL give shared code its model calls through the `ModelPort` and capture provider ports, or by registering them with the importer. A boundary test SHALL check every shared file for these rules.

#### Scenario: Pi extraction fails

- **WHEN** the Pi provider bridge cannot complete a structured extraction request
- **THEN** automatic capture MAY fail or defer for that work unit
- **AND** local manual memory search, list, add, and delete operations SHALL remain available

#### Scenario: Shared code imports a host SDK

- **WHEN** a file in `src/services/` imports `@opencode/plugin`, with a value, type-only or dynamic import
- **THEN** the boundary test SHALL fail and name the file

#### Scenario: Profile learning on OpenCode

- **WHEN** OpenCode runs profile learning or AI profile cleanup with an OpenCode host model
- **THEN** the shared profile code SHALL call the model through a `ModelPort` that the OpenCode adapter registers
- **AND** the result SHALL be the same as before the move

### Requirement: Existing OpenCode storage remains compatible

The shared core SHALL preserve compatibility with the current OpenCode memory data and project identity.

#### Scenario: An existing project has memories before the refactor

- **WHEN** OpenCode starts after Phase 1
- **THEN** those memories SHALL remain searchable without mandatory export/re-import
- **AND** their project scope SHALL resolve to the same logical project

### Requirement: omms storage default migrates safely from the opencode-mem layout

From Phase 4 the default shared store SHALL be `~/.omms/data`, established by a one-time migration from `~/.opencode-mem/data`. The existing project tag derivation with the default `opencode` container prefix SHALL remain the on-disk format; the prefix SHALL NOT be rewritten by the migration.

#### Scenario: Pi and OpenCode open the same project

- **WHEN** both adapters resolve the same project directory/repository under equivalent configuration
- **THEN** both SHALL resolve the same project memory namespace
- **AND** neither SHALL create a host-specific shadow namespace solely because the host differs

#### Scenario: A legacy opencode-mem store exists and omms starts for the first time

- **WHEN** `~/.omms/data` does not exist and `~/.opencode-mem/data` does
- **THEN** the system SHALL create a timestamped, checksum-verified backup of the entire legacy directory before copying anything
- **AND** it SHALL copy (never move) the store to `~/.omms/data`, verifying every copied file against its source
- **AND** it SHALL write a migration marker so subsequent runs are no-ops
- **AND** the legacy directory SHALL remain byte-for-byte unchanged

#### Scenario: The backup cannot be created or a copied file fails verification

- **WHEN** backup creation or per-file verification fails
- **THEN** the migration SHALL abort before the new store is used
- **AND** the system SHALL keep resolving storage against the legacy layout
- **AND** the legacy directory SHALL remain untouched

#### Scenario: A fresh install with no legacy store

- **WHEN** neither directory exists
- **THEN** the system SHALL start directly at `~/.omms/data` with no migration artefacts

### Requirement: Cross-host provenance is backward-compatible

New automatic memories SHALL support host/source provenance in backward-compatible metadata.

#### Scenario: A legacy memory has no host field

- **WHEN** the shared core reads or searches that memory
- **THEN** the memory SHALL remain valid
- **AND** absence of host provenance SHALL NOT make it unreadable

### Requirement: Shared-store multi-process safety is verified

The implementation SHALL verify behavior when OpenCode and Pi access the same store from separate processes.

#### Scenario: Two processes write the same project concurrently

- **WHEN** OpenCode and Pi initialize and persist memories concurrently
- **THEN** shard metadata and memory rows SHALL remain consistent
- **AND** successful writes SHALL remain readable after both processes close and reopen the store

#### Scenario: Existing in-process locking is insufficient

- **WHEN** two-process tests demonstrate a race that cannot be prevented by current libSQL transaction behavior
- **THEN** the implementation SHALL add cross-process coordination around the affected operation
- **AND** it SHALL use the narrowest mechanism that preserves existing data compatibility

### Requirement: The repository remains non-monorepo by default

This change SHALL NOT require restructuring the repository into a monorepo.

#### Scenario: Shared services can be imported by both adapters in one package

- **WHEN** one-package internal boundaries satisfy OpenCode and Pi
- **THEN** implementation SHALL keep that simpler repository shape
- **AND** a package split SHALL require separate evidence and design work

### Requirement: Web/backend services are reusable where practical

The existing memory web backend SHALL remain compatible with the shared store and MAY be started or attached by host adapters through shared lifecycle code.

#### Scenario: OpenCode and Pi are both running

- **WHEN** both are configured to expose the memory web backend
- **THEN** they SHALL use the same memory data
- **AND** existing ownership/takeover behavior SHALL prevent them from creating divergent host-specific stores

### Requirement: Extraction tolerates skip replies and reports unparseable ones

Capture extraction SHALL accept a model reply whose type is `skip` even when `summary` or `tags` are missing, and SHALL treat it as a skip. When a reply cannot be parsed into a capture summary, the system SHALL report it through the capture attempt diagnostics record defined by the `capture-diagnostics` capability, with outcome `failed` and a failure reason code. The OMMS log SHALL NOT contain any part of the reply text. Reply text SHALL be written only to the capture trace file, and only when the user has turned on capture tracing.

#### Scenario: The model replies with a bare skip

- **WHEN** the extraction reply is `{"type":"skip"}`
- **THEN** the work unit SHALL be recorded as skipped
- **AND** it SHALL NOT be counted as a failure

#### Scenario: The model replies with prose

- **WHEN** the extraction reply contains no usable JSON
- **THEN** the unit SHALL fail as before
- **AND** the OMMS log SHALL include a diagnostics record with the provider, the model, the reply length, outcome `failed`, and reason `invalid-json`
- **AND** the OMMS log SHALL NOT include any reply text

#### Scenario: Tracing is on when a reply is unparseable

- **WHEN** capture tracing is on and the extraction reply contains no usable JSON
- **THEN** the trace file SHALL contain the redacted reply text for that attempt
- **AND** the OMMS log SHALL still contain no reply text

### Requirement: Live capture uses one model rule on both hosts

OpenCode and Pi SHALL choose the model for automatic capture and profile learning in the same order:

1. the host model: `opencodeProvider`/`opencodeModel` on OpenCode, `piProvider`/`piModel` on Pi, where the model value `inherit` means the session's model and the model value `external` means the external API
2. the external API (`memoryModel`, `memoryApiUrl`, `memoryApiKey`), when no host model is set
3. the session's own model, when neither is set

When the host model is `external`, the provider value SHALL be ignored and every call SHALL go to the external API. When the host model is `external` and the external API is not fully configured, automatic capture on that host SHALL be disabled and the missing settings SHALL be reported. When another host model fails and the external API is fully configured, the call SHALL use the external API and the user SHALL be notified. When the external API is only partly configured and no host model is set, automatic capture SHALL be disabled and the missing settings SHALL be reported.

Claude Code SHALL use step 2 only. It SHALL have no host model setting and no session model path, because its hooks cannot call the session's model. When the external API is not fully configured, Claude Code automatic capture and profile learning SHALL be disabled and the missing settings SHALL be reported. The order for OpenCode and Pi SHALL NOT change.

#### Scenario: Nothing is configured

- **WHEN** no host model and no external API settings exist
- **THEN** automatic capture on either host SHALL use the session's model

#### Scenario: The pinned host model fails

- **WHEN** the configured host model call fails and the external API is fully configured
- **THEN** the capture SHALL be retried through the external API
- **AND** a "Using fallback provider" notification SHALL be shown

#### Scenario: The external API is half configured

- **WHEN** `memoryModel` is set but `memoryApiKey` is not, and no host model is set
- **THEN** automatic capture SHALL be disabled and the missing settings SHALL be reported

#### Scenario: A host chooses the external API

- **WHEN** `piModel` is `external` and the external API is fully configured
- **THEN** Pi's automatic capture and profile learning SHALL call the external API
- **AND** OpenCode SHALL keep using its own host model

#### Scenario: The same choice on both hosts

- **WHEN** `opencodeModel` is `external` on OpenCode and `piModel` is `external` on Pi, with the same external API settings
- **THEN** both hosts SHALL call the same external model

#### Scenario: A host chooses an unconfigured external API

- **WHEN** `opencodeModel` is `external` and `memoryApiUrl` is not set
- **THEN** OpenCode's automatic capture SHALL be disabled and `memoryApiUrl` SHALL be reported as missing

#### Scenario: Claude Code with nothing configured

- **WHEN** no external API settings exist and a Claude Code turn ends
- **THEN** no model call SHALL be made
- **AND** the missing settings SHALL be reported

#### Scenario: Claude Code with the external API configured

- **WHEN** the external API is fully configured and a Claude Code turn ends
- **THEN** the capture SHALL call the external API
- **AND** the OpenCode and Pi model choice SHALL be unchanged

### Requirement: History import has the same options on both hosts

The OpenCode, Pi, and Claude Code history imports SHALL accept one option set, parsed by one shared parser, both in a session and from the terminal. Only the history location flag SHALL differ: `--db` for OpenCode, `--root` for Pi, and `--root` for Claude Code. The default scope SHALL be the current project on every host. Claude Code SHALL have a terminal import only, because it has no in-session command surface.

#### Scenario: The same flags on both hosts

- **WHEN** the maintainer passes `--dry-run --scope all-projects --since 2026-01-01 --skip-memories` to either import
- **THEN** both imports SHALL apply the same filters and report in the same format

#### Scenario: A bare end date

- **WHEN** `--until 2026-03-31` is given
- **THEN** work units from the whole of 31 March 2026 SHALL be included

#### Scenario: The same flags on the Claude Code import

- **WHEN** the maintainer passes `--dry-run --scope all-projects --since 2026-01-01` to `import-claude-history`
- **THEN** the import SHALL apply the same filters and report in the same format as the other two

### Requirement: Injected memories carry their ids

Each memory that OMMS adds to a session's context SHALL carry its memory id beside its relevance: `<memory id="<id>" relevance="<N>%">`. Pi, OpenCode and Claude Code SHALL use the same format. Adding the id SHALL keep the context within the same size budget, so a section that is full SHALL hold fewer memories rather than grow.

#### Scenario: A prompt's recall

- **WHEN** OMMS adds matching memories for a prompt in any host
- **THEN** each memory in the section SHALL show its id and its relevance

#### Scenario: Forgetting a recalled memory

- **WHEN** the agent wants to remove a memory that it read in the injected context
- **THEN** it SHALL be able to pass that memory's id to the `memory` tool's `forget` mode with no search first

### Requirement: OpenCode v2 reaches the shared memory behaviour through native hooks

The OpenCode v2 entry SHALL reach the shared memory behaviour through native v2 hooks: per-prompt retrieval, compaction hooks, the event stream and sessionless structured output. OMMS SHALL NOT keep an OpenCode V1 entry or V1-only behaviour.

#### Scenario: OpenCode v2 invokes the memory plugin

- **WHEN** the v2 adapter handles a v2 lifecycle hook or tool call
- **THEN** the request SHALL reach the shared memory behaviour
- **AND** the memory tool's operations and results SHALL match the Pi tool for the same arguments

#### Scenario: No V1 entry

- **WHEN** a host looks for a V1 `server` entry in the package
- **THEN** it SHALL find none
- **AND** no host SHALL add a first-message recent-memory list

### Requirement: Host identity comes from one registry

The system SHALL define the supported hosts in one list. The host type, the host guard, and each host's label and capabilities SHALL come from that list. Shared code and the web app SHALL use this list and SHALL NOT declare their own host union or host list. Each layer that needs per-host facts SHALL key them by the host type, so that a host without an entry fails the type check.

#### Scenario: A request names an unknown host

- **WHEN** a web API request names a host that is not in the list
- **THEN** the server SHALL refuse it with the same status and message as before this change

#### Scenario: A host entry is missing

- **WHEN** a developer adds a host to the list and leaves out its entry in a per-host table
- **THEN** `bun run typecheck` SHALL fail and name the table

#### Scenario: Claude Code imports use the external API

- **WHEN** a Claude Code import, backfill or readiness check runs
- **THEN** it SHALL use the external API only, as before, because the registry marks Claude Code as a host with no session model

### Requirement: Shared code does not branch on host names

Shared code outside the host adapters, the OpenCode entry (`src/v2/`, `src/plugin.ts`), the host registry and the live-model rule SHALL NOT compare a value with a host id or list host ids. A test SHALL read the syntax tree of every `src/` file and fail on a host-id comparison, a host-id `case` clause, or two or more host ids in one array, union type, regex, `Set` or `Map` keys. The ids include the command name `claude`.

#### Scenario: A host branch is added to the importer

- **WHEN** a file in `src/importer/` adds `if (host === "pi")`
- **THEN** the host-branch test SHALL fail and name the file and line

#### Scenario: A host union or host regex is added to a service

- **WHEN** a file in `src/services/` adds `host: "pi" | "opencode"` or `/^(pi|opencode)$/`
- **THEN** the host-branch test SHALL fail and name the file and line

#### Scenario: A host name appears in prose

- **WHEN** a shared file has the word `opencode` in a comment or inside a longer message
- **THEN** the host-branch test SHALL pass

### Requirement: Host adapters do not import each other

No file of one host adapter SHALL import a file of another host adapter. The OpenCode host includes `src/adapters/opencode/`, `src/v2/` and `src/plugin.ts`. No file outside the OpenCode host SHALL import `src/v2/` or `src/plugin.ts`. A test SHALL check every pair of adapter folders, read from disk, so a new adapter folder is covered without a test edit.

#### Scenario: The Pi adapter imports an OpenCode adapter module

- **WHEN** a file in `src/adapters/pi/` imports a module in `src/adapters/opencode/`
- **THEN** the adapter boundary test SHALL fail and name both files

#### Scenario: Shared code imports the OpenCode entry

- **WHEN** a file in `src/services/` imports `src/v2/adapter.ts`
- **THEN** the boundary test SHALL fail and name the file

### Requirement: Utilities and config do not load host code

Files in `src/utils/` and `src/config.ts` SHALL NOT import `src/adapters/`, `src/v2/` or `src/plugin.ts`. A test SHALL check this.

#### Scenario: Config imports a host adapter

- **WHEN** `src/config.ts` imports `src/adapters/pi/live-model.ts`
- **THEN** the boundary test SHALL fail and name the import

### Requirement: The shared folder is a leaf

Files in `src/shared/` SHALL import only other files in `src/shared/` and packages. A test SHALL check this, because the web app loads `src/shared/` directly.

#### Scenario: A shared module imports config

- **WHEN** a file in `src/shared/` imports `src/config.ts`
- **THEN** the boundary test SHALL fail and name the file

### Requirement: Loading config loads no importer code

`src/config.ts` SHALL NOT import any module in `src/importer/`. A test SHALL check this.

#### Scenario: Config imports an importer module

- **WHEN** `src/config.ts` imports a file in `src/importer/`
- **THEN** the boundary test SHALL fail and name the import

### Requirement: Known modularity debts can only shrink

Each ratchet test SHALL hold a baseline of files with a count per file. A file not in the baseline SHALL have a count of zero. A listed file SHALL NOT exceed its count. A listed file whose count reaches zero SHALL fail the test until its entry is removed. A listed file whose count drops below its entry SHALL fail the test with the new count to write. Each test SHALL fail if its scan finds fewer files than a set minimum.

#### Scenario: A file stops importing the storage engine

- **WHEN** a file in the storage-import baseline no longer imports the storage engine
- **THEN** the storage-import ratchet SHALL fail until its baseline entry is removed

#### Scenario: A listed file shrinks

- **WHEN** a file listed with 12 `CONFIG` imports drops to 5
- **THEN** the `CONFIG` ratchet SHALL fail with "lower the baseline to 5"

#### Scenario: The scan finds nothing

- **WHEN** a ratchet's scan finds fewer files than its minimum
- **THEN** the ratchet SHALL fail, so an empty scan cannot pass

### Requirement: Core and services CONFIG imports can only shrink

A ratchet test SHALL count non-type imports of `src/config.ts` in `src/core/` and `src/services/`. No file other than `src/config.ts` SHALL re-export `CONFIG`, so the count cannot be bypassed through another module. A test SHALL check this.

#### Scenario: A new service imports CONFIG

- **WHEN** a new file in `src/services/` imports `CONFIG` from `src/config.ts`
- **THEN** the `CONFIG` ratchet SHALL fail and name the file

#### Scenario: A utility re-exports CONFIG

- **WHEN** a file in `src/utils/` has `export { CONFIG } from "../config.js"`
- **THEN** the re-export test SHALL fail and name the file and line

### Requirement: Storage engine imports can only shrink

A ratchet test SHALL count imports of `@libsql/client` and of `src/services/turso/*` in `src/` outside `src/services/turso/`, type-only imports included.

#### Scenario: A type-only engine import

- **WHEN** a file outside the storage folder adds `import type { Client } from "@libsql/client"`
- **THEN** the storage-import ratchet SHALL fail and name the file

### Requirement: Raw SQL outside the storage folder can only shrink

A ratchet test SHALL count raw SQL statement literals in `src/` outside `src/services/turso/`. It SHALL NOT count text in comments.

#### Scenario: A listed file adds SQL

- **WHEN** a file in the raw-SQL baseline adds one more SQL statement literal
- **THEN** the raw-SQL ratchet SHALL fail and show the new count and the allowed count

#### Scenario: SQL text in a comment

- **WHEN** a file outside the storage folder has `SELECT` in a comment
- **THEN** the raw-SQL ratchet SHALL NOT count it

### Requirement: Web memory edits take the scope write lock

When the web app replaces a memory's content, type or tags, it SHALL delete and insert the row inside `withScopeWriteLock` for the memory's scope, the same lock that every other memory write takes. The embedding SHALL run before the lock is taken. The response and the stored row SHALL be the same as before for an edit that does not race with another write.

#### Scenario: Another writer holds the scope lock

- **WHEN** another write holds the lock for the memory's scope and the user saves an edit on the web page
- **THEN** the edit SHALL wait for the lock
- **AND** the stored row SHALL change only after the other write releases the lock

#### Scenario: The memory is deleted before the lock is taken

- **WHEN** the memory is deleted after the edit reads it and before the edit takes the lock
- **THEN** the edit SHALL return "Memory not found" and SHALL NOT insert a row
