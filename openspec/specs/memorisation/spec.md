# memorisation Specification

## Purpose

Memorisations are exact, pinned records that a user or agent saves on purpose and fetches on purpose by ID or by text, kept apart from automatic memory recall on every host.

## Requirements

### Requirement: Memorise saves an exact record with a short ID

The `memory` tool on OpenCode V2, Pi and Claude Code, and the `om-memory-system memory` CLI, SHALL offer a `memorise` mode. It SHALL store the given text word for word in the active memory space, after `<private>` removal, and return a short ID made of the prefix `ms-` and six lower-case letters or digits. `memorize` SHALL be accepted as the same mode.

#### Scenario: Explicit memorisation

- **WHEN** the agent calls `memory` with mode `memorise` and content "use port 4747 for the scratch web app"
- **THEN** OMMS stores that text unchanged and returns an ID such as `ms-4k7q2p`

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

#### Scenario: Snapshot fields without a mode

- **WHEN** the agent calls `memory` with `topic`, `done`, `doing` or `next` and no `mode`
- **THEN** the call returns `success: false` with the error "mode is required: use memorise for snapshot fields" and nothing is stored

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

#### Scenario: Add refuses the memorisation kind

- **WHEN** the agent calls `memory` with mode `add` and type `memorisation`
- **THEN** OMMS refuses, tells the agent to use `memorise`, and stores nothing

### Requirement: Recall by ID is exact

The `memory` tool and the CLI SHALL offer a `recall` mode. When its input is a memorisation ID, `recall` SHALL return that record's full stored text unchanged, with its ID and creation time, and no other record. The lookup SHALL cover every project in the active and linked spaces, the same as recall by text.

#### Scenario: Quoted ID

- **WHEN** the agent calls `recall` with `ms-4k7q2p`
- **THEN** OMMS returns exactly the text stored under `ms-4k7q2p`

#### Scenario: Unknown ID

- **WHEN** `recall` receives an ID in the `ms-` form that does not exist in the active or linked spaces
- **THEN** OMMS replies that no memorisation has that ID

#### Scenario: ID from another project

- **WHEN** `recall` runs in the `omms` repository and receives the ID of a memorisation saved in the `omrs` repository of the same space
- **THEN** OMMS returns that memorisation

#### Scenario: ID from another space

- **WHEN** `recall` receives the ID of a memorisation that exists only in a space that is neither active nor linked
- **THEN** OMMS replies that no memorisation has that ID

### Requirement: Recall by text searches memorisations only

When `recall` receives text that is not a memorisation ID, OMMS SHALL search memorisation records only, in every project of the active and linked spaces, and return each match with its ID, full text and a confidence score from 0 to 100. Profile items, workflows and other memories SHALL never appear in the result.

#### Scenario: General question

- **WHEN** the user asks "what were we gonna do with the release notes" and the agent calls `recall` with "release notes"
- **THEN** OMMS returns matching memorisations ranked by confidence and no ordinary memory

#### Scenario: Nothing close enough

- **WHEN** no memorisation clears the search threshold
- **THEN** OMMS replies that no memorisation matched

#### Scenario: Match from another project

- **WHEN** the web app runs in `/` and the user recalls "runpod auto deploy", which matches a memorisation saved in the `omrs` repository
- **THEN** OMMS returns that memorisation with its confidence score

### Requirement: Recall returns one strong match alone

When the top text match has a confidence of 80 or more and leads the second match by 10 points or more, `recall` SHALL return only that match. Otherwise it SHALL return three matches by default, or up to the caller's `limit` when one is given, whether that limit is above or below three.

#### Scenario: Clear winner

- **WHEN** the top match scores 88 and the next scores 61
- **THEN** `recall` returns only the top match

#### Scenario: Close matches

- **WHEN** the top three matches score 72, 70 and 65
- **THEN** `recall` returns all three with their scores

#### Scenario: Limit above three

- **WHEN** six matches score between 72 and 50 and the caller passes `limit` 5
- **THEN** `recall` returns the top five with their scores

### Requirement: Memorisations stay out of automatic memory

Memorisations SHALL NOT appear in per-prompt recall, opening context, compaction or resume restore, capture context, the web memory chat, or the `search` and `list` modes. They SHALL reach an agent only through `recall`.

#### Scenario: Matching prompt

- **WHEN** a prompt's words closely match a stored memorisation
- **THEN** the injected memory context does not contain that memorisation

#### Scenario: Normal search

- **WHEN** the agent calls `memory` with mode `search` and a query that matches a memorisation
- **THEN** the results do not include that memorisation

### Requirement: Capture skips a memorise turn

Automatic capture SHALL skip a turn in which the agent saved a memorisation, on every host and in the history import. A failed memorise call SHALL NOT cause a skip. OMMS SHALL log the skip with the reason code `memorisation-turn` and no turn text.

#### Scenario: Turn with a saved memorisation

- **WHEN** an agent calls `memory` with mode `memorise` or `memorize` and the call returns `success: true`
- **THEN** automatic capture does not call the capture model, saves no ordinary memory for that turn, and logs one skipped attempt with the reason `memorisation-turn`

#### Scenario: Failed memorise call

- **WHEN** an agent calls `memory` with mode `memorise` and the call returns `success: false` or a host error
- **THEN** automatic capture handles the turn as an ordinary turn

#### Scenario: Ordinary turn

- **WHEN** a turn holds no memorise call
- **THEN** automatic capture handles it as before

#### Scenario: Claude Code command

- **WHEN** a Claude Code agent saves a memorisation with the `mcp__omms__memory` tool or a Bash call to `om-memory-system memory memorise`
- **THEN** the turn is skipped in the same way

#### Scenario: History import

- **WHEN** the history import reads a turn that holds a saved memorise call
- **THEN** the import skips the turn and records the reason `memorisation-turn` in its ledger

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

- **WHEN** `memorisationRepeat` is `replace` and the agent memorises a snapshot for a session that already has `ms-4k7q2p`
- **THEN** the store holds only the new snapshot, under the ID `ms-4k7q2p`

#### Scenario: Add on the same session

- **WHEN** `memorisationRepeat` is `add` and the agent memorises a second snapshot for the same session
- **THEN** both snapshots are kept with different IDs

#### Scenario: Host gives no session ID

- **WHEN** `memorisationRepeat` is `replace` and the host provides no session ID
- **THEN** OMMS adds the snapshot and its reply says it could not replace because the session is unknown

### Requirement: User labels are kept when memorising

`memorise` SHALL accept `tags`, a comma-separated list, on every host and in the CLI (`--tags`). OMMS SHALL store every label the caller gives, in addition to any label the agent adds itself and the fixed tag `memorisation`. OMMS SHALL trim each label, lower-case it, and keep one copy of a repeated label. OMMS SHALL return the stored tags in its reply.

#### Scenario: User labels beside agent labels

- **WHEN** the user says "memorise this, label it release, wip" and the agent calls `memorise` with tags "release,wip,auth"
- **THEN** the stored record has the tags `memorisation`, `release`, `wip` and `auth`

#### Scenario: Case and repeats

- **WHEN** `memorise` is called with tags "Release, WIP, release"
- **THEN** the stored record has the tags `memorisation`, `release` and `wip`

### Requirement: Recall by labels

`recall` SHALL accept `tags`, a comma-separated list, on every host and in the CLI (`--tags`). A memorisation SHALL match only when it carries every listed label. OMMS SHALL ignore case and surrounding spaces, and SHALL NOT treat the fixed tag `memorisation` as a label. Each match SHALL list its labels without the fixed tag. Matches SHALL come from every project of the active and linked spaces. `recall` with neither `query` nor `tags` SHALL refuse and name both.

#### Scenario: Labels only

- **WHEN** the agent calls `recall` with tags "release" and no query
- **THEN** OMMS returns the newest memorisations that carry `release`, up to the caller's `limit` or 10 when none is given, with no confidence score

#### Scenario: Several labels

- **WHEN** the agent calls `recall` with tags "auth,wip"
- **THEN** OMMS returns only memorisations that carry both `auth` and `wip`

#### Scenario: Labels and text

- **WHEN** the agent calls `recall` with query "token refresh" and tags "auth"
- **THEN** OMMS ranks memorisations by text, keeps only those that carry `auth`, and shows a confidence score on each
- **AND** a labelled match that ranks below the usual result limit is still found, because OMMS reads up to 200 text hits before it filters by label

#### Scenario: Exact ID

- **WHEN** `recall` receives an `ms-` ID and tags that the record does not carry
- **THEN** OMMS returns that record, because an ID ignores `tags`

#### Scenario: Nothing carries the labels

- **WHEN** no memorisation carries every listed label
- **THEN** OMMS replies that no memorisation matched, and the reply is not an error

#### Scenario: Project label from another folder

- **WHEN** the agent runs in the `omms` repository and calls `recall` with tags "omrs"
- **THEN** OMMS returns the memorisations that carry `omrs`, from whichever project saved them

### Requirement: List route accepts labels

`GET /api/memorisations` SHALL accept `tags`, a comma-separated list of labels, and return only records that carry every label, newest first, from every project of the active and linked spaces. The label filter SHALL run before the cap of 200 rows. An empty `tags` value SHALL mean no filter. Each row SHALL carry its labels without the fixed tag.

#### Scenario: List filtered by labels

- **WHEN** the page asks for `GET /api/memorisations?tags=auth,wip`
- **THEN** the reply holds only the records that carry `auth` and `wip`

#### Scenario: Old labelled record

- **WHEN** the space holds more than 200 newer records without the label, and one older record with it
- **THEN** the filtered list still holds the older record

#### Scenario: Web app outside a project

- **WHEN** the web app runs in `/` and the active space holds two memorisations saved in the `omrs` repository
- **THEN** `GET /api/memorisations` returns both records

### Requirement: Recall route accepts labels

`GET /api/memorisations/recall` SHALL accept `q`, `tags` and `limit`. It SHALL answer 400 when both `q` and `tags` are empty, and 404 for an `ms-` ID that does not exist. Otherwise it SHALL return the same matches as the `recall` mode.

#### Scenario: Recall with no query and no labels

- **WHEN** a client calls `GET /api/memorisations/recall` with an empty `q` and no `tags`
- **THEN** the reply is 400 and names `q` and `tags`

#### Scenario: Labels only

- **WHEN** a client calls `GET /api/memorisations/recall?tags=release`
- **THEN** the reply holds the newest memorisations that carry `release`

### Requirement: Bulk delete request

`POST /api/memorisations/bulk-delete` SHALL accept a JSON body `{ "ids": [...] }` of 1 to 500 memorisation IDs, each made of `ms-` and six lower-case letters or digits. OMMS SHALL count the IDs as sent, before it removes repeats. A body outside those rules SHALL get status 400, and OMMS SHALL delete nothing. Otherwise the reply SHALL be status 200 with `{ "success": true, "data": { "deleted": [ids], "skipped": [{ "id", "reason" }] } }`.

#### Scenario: Delete several

- **WHEN** the page posts two IDs of memorisations in the active space
- **THEN** both are deleted and the reply lists both in `deleted` and none in `skipped`

#### Scenario: Body out of range

- **WHEN** `ids` is empty, holds 501 IDs, holds a value that is not an `ms-` ID, or is not a list
- **THEN** the reply is status 400 and nothing is deleted

#### Scenario: Upper limit

- **WHEN** `ids` holds exactly 500 valid IDs
- **THEN** OMMS processes all 500

#### Scenario: Repeated ID

- **WHEN** the same ID appears twice in `ids`
- **THEN** OMMS deletes it once and lists it once in `deleted`

### Requirement: Bulk delete scope

Bulk delete SHALL remove memorisations of any project from the active memory space only. It SHALL keep every skipped record unchanged, and a skipped ID SHALL NOT stop the others. The general `/api/memories` bulk delete SHALL keep refusing memorisations.

#### Scenario: Another project

- **WHEN** the web app runs in `/` and an ID names a memorisation saved in the `omrs` repository of the active space
- **THEN** OMMS deletes it and lists it in `deleted`

### Requirement: Bulk delete skipped reasons

Each skipped ID SHALL carry one reason. `not-found` means no record in the active or linked spaces has that ID. `linked` means the record lives only in a read-only linked space. `not-memorisation` means the record has another type.

#### Scenario: Unknown ID

- **WHEN** the body holds an ID that does not exist and an ID that does
- **THEN** the existing record is deleted and the unknown ID is skipped as `not-found`

#### Scenario: Linked space

- **WHEN** an ID names a record that exists only in a linked space
- **THEN** OMMS skips it as `linked` and the linked space is unchanged

#### Scenario: Not a memorisation

- **WHEN** an ID names an ordinary memory
- **THEN** OMMS skips it as `not-memorisation` and keeps it

### Requirement: Project label on save

`memorise` SHALL add the name of the project it runs in as a label, after trimming and lower-casing it like any other label. The name SHALL be the repository folder name for every worktree and branch of one git repository, and the folder name outside git. OMMS SHALL NOT add the label when the caller already gave it.

#### Scenario: Worktree on a feature branch

- **WHEN** the agent memorises from a worktree of the `omrs` repository on branch `feat/exp35`
- **THEN** the stored record carries the label `omrs`

#### Scenario: Caller already gave the label

- **WHEN** the agent memorises from the `omrs` repository with tags "omrs,runpod"
- **THEN** the stored record has the labels `omrs` and `runpod`, each once

#### Scenario: Folder outside git

- **WHEN** the agent memorises from the folder `notes` that is not in a git repository
- **THEN** the stored record carries the label `notes`

### Requirement: Rerank setting for text recall

A global setting `memorisationRerank` SHALL take `true` or `false`, with `false` as the default. A project config SHALL NOT change it. Text recall SHALL use the reranker only when `memorisationRerank` is `true` and the reranker server URL and model are set. The general `rerankerEnabled` setting SHALL NOT change memorisation recall.

#### Scenario: Default

- **WHEN** `memorisationRerank` is not set and `rerankerEnabled` is `true`
- **THEN** text recall orders matches by confidence and does not call the reranker

#### Scenario: Turned on without a server

- **WHEN** `memorisationRerank` is `true` and no reranker model is set
- **THEN** text recall orders matches by confidence and does not call the reranker

#### Scenario: Project config

- **WHEN** a project config sets `memorisationRerank` to `true`
- **THEN** OMMS ignores it and keeps the global value

### Requirement: Reranked recall order

When text recall uses the reranker, OMMS SHALL return the matches in the reranker's order and SHALL keep each match's confidence score. The one-strong-match rule SHALL compare the first and second matches in that order. When the reranker fails, recall SHALL return the matches ordered by confidence, and OMMS SHALL log the failure code without query or memorisation text.

#### Scenario: Reranker reorders

- **WHEN** reranking is on, and the reranker puts a match with confidence 70 above a match with confidence 74
- **THEN** recall lists the 70 match first, with its score of 70

#### Scenario: Reranker unreachable

- **WHEN** reranking is on and the reranker server does not answer
- **THEN** recall returns the matches ordered by confidence and the log holds one failure code
