# memory-space-transfer Specification

## Purpose

Lets a user copy or move memories from one memory space to another by date range, with a preview before any write, so a memory saved in the wrong space can be fixed and two lines of work can be merged.

## Requirements

### Requirement: A transfer names a source, a target and a filter

A transfer SHALL name a source space, a different target space and a mode of copy or move. It MAY filter by a date range on the creation time of a memory and by source project. The source and the target MAY be any space that is not archived, and neither needs to be the active space. A transfer between a space and itself SHALL be refused.

#### Scenario: Transfer between two spaces that are not active

- **WHEN** `Default` is active and the user previews a transfer from `Client work` to `Experiments`
- **THEN** OMMS SHALL read `Client work` and SHALL report the result without switching the active space

#### Scenario: Same space

- **WHEN** the source and the target are the same space
- **THEN** OMMS SHALL refuse and SHALL say that the source and the target must differ

#### Scenario: Archived space

- **WHEN** the source or the target is archived
- **THEN** OMMS SHALL refuse and SHALL name the archived space

### Requirement: A preview comes before every write

OMMS SHALL give a preview for a transfer before it writes. The preview SHALL show the count of memories, the source projects with a count each, up to five example memories, and the count of exact duplicates that the target already holds. A preview SHALL NOT change either space. An apply SHALL use the same filter as the preview and SHALL report any difference in count.

#### Scenario: Preview by date range

- **WHEN** the user previews a copy of memories created from 2026-10-01 to 2026-10-31
- **THEN** OMMS SHALL return the count, the source projects, the examples and the duplicate count for that range
- **AND** both spaces SHALL stay unchanged

#### Scenario: Empty result

- **WHEN** the filter matches no memory
- **THEN** OMMS SHALL report a count of zero and SHALL offer no apply

#### Scenario: The source changed after the preview

- **WHEN** a memory matching the filter is added to the source between the preview and the apply
- **THEN** OMMS SHALL apply to the memories that match at apply time and SHALL report the changed count

### Requirement: Exact duplicates are skipped

OMMS SHALL skip a memory when the target already holds a memory with the same id, or a memory with the same project tag and the same text. OMMS SHALL keep a memory that is only similar. The result SHALL report how many memories OMMS copied and how many it skipped.

#### Scenario: Same id in the target

- **WHEN** the target already holds a memory with the id of a source memory
- **THEN** OMMS SHALL skip that memory and SHALL count it as skipped

#### Scenario: Same text under the same tag

- **WHEN** the target holds a memory with the same project tag and the same text as a source memory, under another id
- **THEN** OMMS SHALL skip that memory

#### Scenario: Similar text

- **WHEN** the target holds a memory with similar but not identical text
- **THEN** OMMS SHALL copy the source memory

### Requirement: A copy keeps the source unchanged

A copy SHALL add the selected memories to the target with their text, tags, type, creation and update times, pin state, metadata and project tag unchanged. A copy SHALL NOT change the source. The copy SHALL reuse the stored vectors when both spaces use the same embedding model and dimensions, and SHALL embed again otherwise.

#### Scenario: Copy keeps the fields

- **WHEN** the user copies a pinned memory created on 2026-10-05
- **THEN** the target SHALL hold that memory, pinned, with the creation time 2026-10-05
- **AND** the source SHALL still hold it

#### Scenario: Copy fails part-way

- **WHEN** a write to the target fails
- **THEN** OMMS SHALL leave no partial batch in the target and SHALL report the failure

### Requirement: A move removes from the source only after a verified copy

A move SHALL copy first. OMMS SHALL then check that each copied memory is in the target. Only then SHALL it remove those memories from the source, and it SHALL remove only memories it has checked. A skipped duplicate SHALL stay in the source. If the check fails, OMMS SHALL remove nothing from the source.

#### Scenario: Move succeeds

- **WHEN** the user moves 20 memories and all 20 are in the target after the copy
- **THEN** OMMS SHALL remove those 20 from the source and SHALL report 20 moved

#### Scenario: Check fails

- **WHEN** one copied memory is missing from the target at the check
- **THEN** OMMS SHALL remove nothing from the source and SHALL report the missing memory

#### Scenario: Move with duplicates

- **WHEN** 3 of 20 memories are exact duplicates in the target
- **THEN** OMMS SHALL copy 17, remove those 17 from the source and keep the 3 in the source

### Requirement: Only the web app may move

The web app SHALL offer preview, copy and move. The CLI and the `memory` tool `space` mode SHALL offer preview and copy. They SHALL refuse a move and SHALL say that only the web app can move memories between spaces. Pi, OpenCode V2 and Claude Code SHALL offer the same preview and copy operations.

#### Scenario: The agent asks for a move

- **WHEN** the agent calls the `memory` tool in `space` mode with a move action
- **THEN** OMMS SHALL refuse and SHALL say that only the web app can move memories

#### Scenario: The agent copies

- **WHEN** the agent previews and then copies the memories of `Experiments` created in October into `Default`
- **THEN** OMMS SHALL add them to `Default` and SHALL leave `Experiments` unchanged

#### Scenario: The CLI previews

- **WHEN** the user runs `om-memory-system space preview` with a source, a target and a date range
- **THEN** OMMS SHALL print the preview and SHALL change nothing

### Requirement: A transfer does not log memory text

OMMS SHALL NOT write memory text to the log during a transfer. The log SHALL hold counts, space ids and error codes only.

#### Scenario: Log after a copy

- **WHEN** a copy of 12 memories ends
- **THEN** the log entry SHALL hold the counts and the space ids and SHALL hold no memory text
