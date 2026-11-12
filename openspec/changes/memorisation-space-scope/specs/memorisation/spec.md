## ADDED Requirements

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

## MODIFIED Requirements

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
