# web-memorisation Specification

## Purpose

The web app's Memorisation page lets the user browse, recall, copy and delete memorisations, and choose what happens when a session is memorised again.

## Requirements

### Requirement: Sidebar Memorisation entry

The sidebar main list SHALL show a **Memorisation** entry directly after the user profile entry, with an icon and an accessible label in every supported language. Selecting it SHALL open `/memorisation`. Opening `/memorisation` directly or reloading SHALL show the same page.

#### Scenario: Open from the sidebar

- **WHEN** the user selects **Memorisation** in the sidebar
- **THEN** the browser shows `/memorisation` and the Memorisation page

#### Scenario: Reload

- **WHEN** the user reloads `/memorisation`
- **THEN** the Memorisation page appears again

### Requirement: Memorisation list

The page SHALL list the memorisations of every project in the active and linked spaces, newest first, whatever folder the web app runs in. Each row SHALL show the ID, the topic or first line, the host, and the creation time. Opening a row SHALL show the full stored text.

#### Scenario: Rows show IDs

- **WHEN** the active space has two memorisations
- **THEN** the page shows two rows, each with its `ms-` ID

#### Scenario: No memorisations

- **WHEN** the active and linked spaces have no memorisations
- **THEN** the page tells the user how to memorise from an agent or the CLI

#### Scenario: Web app started as a login item

- **WHEN** the web app runs in `/` and the active space holds memorisations saved in the `omrs` repository
- **THEN** the page lists them

### Requirement: Recall search on the page

The page SHALL have a search box that runs the same recall as the `recall` mode. An ID SHALL show that one record. Text SHALL show the matches with their confidence scores.

#### Scenario: Search by ID

- **WHEN** the user types `ms-4k7q2p`
- **THEN** the page shows only that memorisation

#### Scenario: Search by text

- **WHEN** the user types "release notes"
- **THEN** the page shows matching memorisations with a confidence score on each

### Requirement: Copy ID and delete

Each memorisation SHALL offer **Copy ID**, which puts the ID on the clipboard, and **Delete**, which asks for confirmation and then removes the record.

#### Scenario: Copy

- **WHEN** the user selects **Copy ID** on `ms-4k7q2p`
- **THEN** the clipboard holds `ms-4k7q2p`

#### Scenario: Delete after confirmation

- **WHEN** the user selects **Delete** and confirms
- **THEN** the memorisation is removed and the row disappears

### Requirement: Repeat choice on the page

The page SHALL show the `memorisationRepeat` setting as two choices, **Add a new memorisation** and **Replace the earlier one**, each with a short description. A change SHALL save to the global config and apply to the next snapshot.

#### Scenario: Switch to replace

- **WHEN** the user chooses **Replace the earlier one**
- **THEN** the global config holds `memorisationRepeat: "replace"` and the choice stays after a reload

### Requirement: Size cap on the page

The page SHALL show the size cap as a number box and a **Characters** or **Tokens** choice, with a short description that tokens are an estimate. Saving SHALL write `memorisationMaxSize` and `memorisationSizeUnit` to the global config. A value outside the allowed range SHALL show the range and SHALL NOT save.

#### Scenario: Save a token cap

- **WHEN** the user enters 500, chooses **Tokens** and saves
- **THEN** the global config holds `memorisationMaxSize: 500` and `memorisationSizeUnit: "tokens"`, and the values stay after a reload

#### Scenario: Too small

- **WHEN** the user enters 10 with **Characters**
- **THEN** the page shows the allowed range of 100 to 20,000 characters and saves nothing

### Requirement: Memorisation page in every language

Every label, description and message on the Memorisation page SHALL exist in English, Chinese and Arabic. The English text SHALL use British spelling.

#### Scenario: Arabic interface

- **WHEN** the user selects Arabic
- **THEN** the sidebar entry and every page label show in Arabic, right to left

### Requirement: Label pills on memorisation cards

Each memorisation card, in the list and in recall results, SHALL show its labels as pills beside the kind and host pills. The pills SHALL NOT include the fixed tag `memorisation`. A label SHALL always show in the same colour, whatever the card. Each pill SHALL be a button named "Filter by label X".

#### Scenario: Labels shown

- **WHEN** a memorisation has the labels `release` and `auth`
- **THEN** its card shows a `release` pill and an `auth` pill, and no `memorisation` pill

### Requirement: Filter the list by label

Selecting a label pill SHALL add that label to the list filter. The page SHALL ask `GET /api/memorisations` with `tags` set to the filter, so the list holds only memorisations that carry every label in it. A label already in the filter SHALL show as pressed. A label pill in the recall results SHALL add to the same filter.

#### Scenario: Add a label

- **WHEN** the user selects the `release` pill on a card
- **THEN** the list shows only memorisations with `release`

#### Scenario: Two labels

- **WHEN** the user then selects `auth` on a card
- **THEN** the list shows only memorisations with both labels

#### Scenario: Nothing carries the labels

- **WHEN** no memorisation carries every label in the filter
- **THEN** the page says that no memorisation has all of those labels

### Requirement: Clear the label filter

A bar above the list SHALL show each label of the filter as a chip with a remove control, and a **Clear labels** button. Removing a chip SHALL widen the list to the labels that remain. A change of filter SHALL return the list to page 1.

#### Scenario: Remove one or clear all

- **WHEN** the user removes the `release` chip, then selects **Clear labels**
- **THEN** the list widens to the `auth` records, then to every record

### Requirement: Label filter stays in the address

The filter SHALL live in the address as `?labels=a,b`. The page SHALL write each change without a new history entry. Other query parameters SHALL stay. Opening or reloading an address with `labels` SHALL apply that filter.

#### Scenario: Address follows the filter

- **WHEN** the user adds `release` and then `auth`
- **THEN** the address ends with `?labels=release,auth`

#### Scenario: Reload

- **WHEN** the user reloads `/memorisation?labels=release`
- **THEN** the page shows the `release` chip and the filtered list

#### Scenario: Cleared

- **WHEN** the user selects **Clear labels**
- **THEN** the `labels` parameter leaves the address

### Requirement: Labels in the recall box

The recall box SHALL read `label:name` as a label, and `label:"two words"` for a label with spaces. The user MAY repeat `label:`. OMMS SHALL read the prefix in any letter case, only at the start of the text or after a space. The rest of the text SHALL be the query. The page SHALL send the labels as `tags` and the rest as `q` to `GET /api/memorisations/recall`.

#### Scenario: Text and a label

- **WHEN** the user types `label:release notes plan` and searches
- **THEN** the page asks for `q` "notes plan" with `tags` "release"

#### Scenario: Label only

- **WHEN** the user types `label:"two words"` and searches
- **THEN** the page asks for the newest memorisations with the label `two words`

### Requirement: Comma-separated labels in the recall box

When the recall box text, after any `label:` terms, contains a comma, the page SHALL read each comma-separated part as a label and send no query. Spaces around a comma SHALL NOT matter. Empty parts and repeats, ignoring case, SHALL be dropped.

#### Scenario: Labels with commas

- **WHEN** the user types `runpod, server, 4090` or `runpod,server,4090` and searches
- **THEN** the page asks for the newest memorisations with the labels `runpod`, `server` and `4090`

### Requirement: Recall box help for labels

The **Search** button SHALL work with labels and no text. The placeholder and the help text SHALL describe `label:`. A `label:` term in the recall box SHALL NOT change the list filter.

#### Scenario: Help text

- **WHEN** the page shows the recall box
- **THEN** its placeholder and help text mention `label:name`

#### Scenario: List unchanged

- **WHEN** the user searches with `label:release`
- **THEN** the list filter and the address stay as they were

### Requirement: Select mode

The list SHALL have a **Select** button. In select mode each card SHALL show a checkbox, and the bar SHALL show **Select all**, the count of selected cards, **Delete selected** and **Cancel**. **Select all** SHALL tick every selectable card on the current page. **Delete selected** SHALL stay off while the count is 0. **Cancel** SHALL leave select mode and drop every tick.

#### Scenario: Select all

- **WHEN** the user selects **Select** and then **Select all** on a page of two selectable cards
- **THEN** both cards are ticked and the bar shows "2 selected"

#### Scenario: Cancel

- **WHEN** the user selects **Cancel** in select mode
- **THEN** the checkboxes disappear and no card stays ticked

### Requirement: Linked cards cannot be selected

A card from a linked space SHALL NOT be selectable. Its checkbox SHALL show but stay off, with the reason beside it. A filter change or a refresh SHALL drop ticks on cards that are no longer in the list.

#### Scenario: Linked card

- **WHEN** one of the cards belongs to a linked space
- **THEN** its checkbox is off and **Select all** ticks the other cards only

#### Scenario: Filter hides a ticked card

- **WHEN** a card is ticked and a new label filter hides it
- **THEN** the count drops by one

### Requirement: Bulk delete confirmation and result

**Delete selected** SHALL open one confirmation that states how many memorisations will go, and SHALL send nothing until the user confirms. Confirming SHALL post the IDs to `POST /api/memorisations/bulk-delete`. On a reply, the page SHALL leave select mode, reload the list, and show a result line with the number deleted and, for each skipped ID, the ID and its reason. If the request fails, the dialog SHALL stay open with an error and the selection SHALL stay.

#### Scenario: One confirmation

- **WHEN** the user selects **Delete selected**
- **THEN** one dialog states the count, and nothing is sent until the user confirms

#### Scenario: Result line

- **WHEN** the user confirms and the reply holds two deleted IDs and one skipped ID
- **THEN** the page shows "Deleted 2." and a line that names the skipped ID with its reason, and the list reloads

#### Scenario: Request fails

- **WHEN** the bulk delete request fails
- **THEN** the dialog stays open with an error, the cards stay ticked and nothing leaves the list

### Requirement: Rerank switch on the page

The settings card SHALL show `memorisationRerank` as a switch labelled **Rerank text recall (experimental)**, with a short description that the reranker reorders text matches and that the setting is experimental. A change SHALL save to the global config and apply to the next recall.

#### Scenario: Turn on

- **WHEN** a reranker URL and model are set and the user turns the switch on
- **THEN** the global config holds `memorisationRerank: true` and the switch stays on after a reload

#### Scenario: Save fails

- **WHEN** the save request fails
- **THEN** the switch returns to its earlier position and the page shows the server's reason

### Requirement: Rerank switch needs a reranker server

The switch SHALL stay visible and disabled while the reranker URL or model is missing. Its tooltip and an accessible description SHALL say in words that the reranker server must be set on the Memory settings page first.

#### Scenario: No reranker server

- **WHEN** no reranker model is set
- **THEN** the switch is disabled and its tooltip names the missing reranker server
