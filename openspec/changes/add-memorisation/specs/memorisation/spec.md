# Spec Delta

## Purpose

Memorisations are exact, pinned records that a user or agent saves on purpose and fetches on purpose by ID or by text, kept apart from automatic memory recall on every host.

## ADDED Requirements

### Requirement: Memorise saves an exact record with a short ID

The `memory` tool on OpenCode V2, Pi and Claude Code, and the `om-memory-system memory` CLI, SHALL offer a `memorise` mode. It SHALL store the given text word for word in the active memory space, after `<private>` removal, and return a short ID made of the prefix `mz-` and six lower-case letters or digits. `memorize` SHALL be accepted as the same mode.

#### Scenario: Explicit memorisation

- **WHEN** the agent calls `memory` with mode `memorise` and content "use port 4747 for the scratch web app"
- **THEN** OMMS stores that text unchanged and returns an ID such as `mz-4k7q2p`

#### Scenario: American spelling

- **WHEN** the user runs `om-memory-system memory memorize "release on Friday"`
- **THEN** OMMS saves the memorisation exactly as with `memorise`

#### Scenario: Fully private content

- **WHEN** the content is entirely inside `<private>` tags
- **THEN** OMMS refuses with "Private content blocked" and stores nothing

### Requirement: Session snapshot fields

`memorise` SHALL accept a session snapshot made of optional `topic`, `done`, `doing` and `next` text fields instead of free content. OMMS SHALL store the snapshot as one record with labelled sections and SHALL tag it with the host session ID when the host provides one.

#### Scenario: Snapshot from an agent

- **WHEN** the agent calls `memorise` with topic "memorisation proposal", done "proposal written", doing "validating specs" and next "wait for approval"
- **THEN** OMMS stores one record with Topic, Done, Doing and Next sections and returns its ID

#### Scenario: Neither content nor snapshot

- **WHEN** `memorise` is called with no content and no snapshot field
- **THEN** OMMS refuses with an error that names the missing input

### Requirement: Memorisation size cap

OMMS SHALL refuse a memorisation whose stored text is over the size cap, and the error SHALL state the limit, its unit and the actual size. OMMS SHALL never shorten the text by itself.

#### Scenario: Text over the default cap

- **WHEN** the cap is the default 2,000 characters and `memorise` receives 2,600 characters
- **THEN** OMMS stores nothing and replies that the limit is 2,000 characters and the text has 2,600

#### Scenario: Cap counted in tokens

- **WHEN** the cap is 300 tokens and the text estimates at 410 tokens
- **THEN** OMMS stores nothing and replies that the limit is 300 tokens and the text has about 410

### Requirement: Size cap setting

Global settings `memorisationMaxSize` (a whole number, default 2000) and `memorisationSizeUnit` (`characters` or `tokens`, default `characters`) SHALL set the cap. Tokens SHALL use the same estimate as the memory context budget. OMMS SHALL reject a size below 100 characters or 25 tokens, or above 20,000 characters or 5,000 tokens, and keep the previous value.

#### Scenario: Change the unit

- **WHEN** the user sets `memorisationMaxSize` to 500 and `memorisationSizeUnit` to `tokens`
- **THEN** the next `memorise` call measures the text in estimated tokens against 500

#### Scenario: Value out of range

- **WHEN** the user sets `memorisationMaxSize` to 50 with unit `characters`
- **THEN** OMMS refuses the edit with the allowed range and keeps the previous value

#### Scenario: Existing records

- **WHEN** the user lowers the cap below the size of a stored memorisation
- **THEN** the stored memorisation stays unchanged and can still be recalled

### Requirement: Memorisation label

Every memorisation SHALL carry the record kind `memorisation` and the tag `memorisation`, plus any tags the caller gives. No other kind of record SHALL carry that kind.

#### Scenario: Caller tags kept

- **WHEN** `memorise` is called with tags "omms,release"
- **THEN** the stored record has the tags `memorisation`, `omms` and `release`

### Requirement: Recall by ID is exact

The `memory` tool and the CLI SHALL offer a `recall` mode. When its input is a memorisation ID, `recall` SHALL return that record's full stored text unchanged, with its ID and creation time, and no other record.

#### Scenario: Quoted ID

- **WHEN** the agent calls `recall` with `mz-4k7q2p`
- **THEN** OMMS returns exactly the text stored under `mz-4k7q2p`

#### Scenario: Unknown ID

- **WHEN** `recall` receives an ID in the `mz-` form that does not exist in the active or linked spaces
- **THEN** OMMS replies that no memorisation has that ID

### Requirement: Recall by text searches memorisations only

When `recall` receives text that is not a memorisation ID, OMMS SHALL search memorisation records only, in the active and linked spaces, and return each match with its ID, full text and a confidence score from 0 to 100. Profile items, workflows and other memories SHALL never appear in the result.

#### Scenario: General question

- **WHEN** the user asks "what were we gonna do with the release notes" and the agent calls `recall` with "release notes"
- **THEN** OMMS returns matching memorisations ranked by confidence and no ordinary memory

#### Scenario: Nothing close enough

- **WHEN** no memorisation clears the search threshold
- **THEN** OMMS replies that no memorisation matched

### Requirement: Recall returns one strong match alone

When the top text match has a confidence of 80 or more and leads the second match by 10 points or more, `recall` SHALL return only that match. Otherwise it SHALL return up to three matches, or up to the caller's `limit` when one is given.

#### Scenario: Clear winner

- **WHEN** the top match scores 88 and the next scores 61
- **THEN** `recall` returns only the top match

#### Scenario: Close matches

- **WHEN** the top three matches score 72, 70 and 65
- **THEN** `recall` returns all three with their scores

### Requirement: Memorisations stay out of automatic memory

Memorisations SHALL NOT appear in per-prompt recall, opening context, compaction or resume restore, capture context, the web memory chat, or the `search` and `list` modes. They SHALL reach an agent only through `recall`.

#### Scenario: Matching prompt

- **WHEN** a prompt's words closely match a stored memorisation
- **THEN** the injected memory context does not contain that memorisation

#### Scenario: Normal search

- **WHEN** the agent calls `memory` with mode `search` and a query that matches a memorisation
- **THEN** the results do not include that memorisation

### Requirement: Maintenance leaves memorisations unchanged

Duplicate removal, retention cleanup and AI tag backfill SHALL skip memorisations. A memorisation SHALL change only when the user deletes it or the repeat setting replaces it.

#### Scenario: Old memorisation

- **WHEN** retention cleanup runs and a memorisation is older than the retention period
- **THEN** the memorisation is kept

#### Scenario: Two identical memorisations

- **WHEN** duplicate removal runs and two memorisations have the same text
- **THEN** both are kept

### Requirement: Repeat setting for session snapshots

A global setting `memorisationRepeat` SHALL take `add` or `replace`, with `add` as the default. With `replace`, a new snapshot for a host session that already has one SHALL delete the earlier snapshot and keep its ID. Explicit memorisations SHALL always be added.

#### Scenario: Replace on the same session

- **WHEN** `memorisationRepeat` is `replace` and the agent memorises a snapshot for a session that already has `mz-4k7q2p`
- **THEN** the store holds only the new snapshot, under the ID `mz-4k7q2p`

#### Scenario: Add on the same session

- **WHEN** `memorisationRepeat` is `add` and the agent memorises a second snapshot for the same session
- **THEN** both snapshots are kept with different IDs

#### Scenario: Host gives no session ID

- **WHEN** `memorisationRepeat` is `replace` and the host provides no session ID
- **THEN** OMMS adds the snapshot and its reply says it could not replace because the session is unknown
