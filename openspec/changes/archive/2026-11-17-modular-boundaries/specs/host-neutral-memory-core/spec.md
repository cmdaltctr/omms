## MODIFIED Requirements

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

## ADDED Requirements

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
