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
- **THEN** the page says that no memorisation matches every filter

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

The recall box SHALL read `label:name` as a label, and `label:"two words"` for a label with spaces. The user MAY repeat `label:`. OMMS SHALL read the prefix in any letter case, only at the start of the text or after a space or comma. A bare label ends at a space or comma. The rest of the text SHALL be the query. The page SHALL send the labels as `tags` and the rest as `q` to `GET /api/memorisations/recall`.

#### Scenario: Text and a label

- **WHEN** the user types `label:release notes plan` and searches
- **THEN** the page asks for `q` "notes plan" with `tags` "release"

#### Scenario: Label only

- **WHEN** the user types `label:"two words"` and searches
- **THEN** the page asks for the newest memorisations with the label `two words`

### Requirement: Comma-separated labels in the recall box

When the recall box text, after any `label:` terms, contains a comma (`,`, the Chinese `，` or the Arabic `،`), the page SHALL read each comma-separated part as a label and send no query. Spaces around a comma SHALL NOT matter. Empty parts and repeats, ignoring case, SHALL be dropped. A bar (`|`) between labels SHALL mean OR: the page SHALL send `a|b` as one label, so a record needs only one of its alternatives. A comma means AND. Text with a bar and no comma SHALL also be read as labels and send no query.

#### Scenario: Labels with commas

- **WHEN** the user types `runpod, server, 4090` or `runpod,server,4090` and searches
- **THEN** the page asks for the newest memorisations with the labels `runpod`, `server` and `4090`

#### Scenario: Either of two labels

- **WHEN** the user types `server | reactjs, api` and searches
- **THEN** the page asks for the newest memorisations with the labels `server|reactjs` and `api`, and a record matches when it carries `api` and either `server` or `reactjs`

#### Scenario: A label prefix next to a bar

- **WHEN** the user types `label:runpod | vast` and searches
- **THEN** the page asks for the newest memorisations with the one label `runpod|vast`, so a record needs only one of the two

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

### Requirement: Label list route

`GET /api/memorisations/labels` SHALL return every label that a memorisation of the active space or a linked space carries, each with the number of memorisations that carry it. The route SHALL treat labels that differ only in letter case or surrounding spaces as one label. It SHALL list labels from the highest count to the lowest, and equal counts in alphabetical order. It SHALL NOT return the fixed `memorisation` tag.

#### Scenario: Counts

- **WHEN** three memorisations carry `server`, two of them also carry `api`, and one also carries `ReactJS`
- **THEN** the route returns `server` with 3, `api` with 2 and `ReactJS` with 1, in that order

#### Scenario: Letter case

- **WHEN** one memorisation carries `Server` and another carries `server`
- **THEN** the route returns one label with the count 2

#### Scenario: No memorisations

- **WHEN** no memorisation exists
- **THEN** the route returns an empty list

### Requirement: Label picker

A **Filter by label** button above the list SHALL open a picker that lists the labels from the label list route, each with its count and a check box. The picker SHALL work in groups. A group SHALL hold the labels the user ticks in it, and a record SHALL match a group when it carries at least one of them. Groups SHALL combine with AND. The user SHALL be able to add a group and remove a group. An empty group SHALL count for nothing.

#### Scenario: Open the picker

- **WHEN** the user selects **Filter by label**
- **THEN** the picker shows one group with every label, its count and an unticked check box

#### Scenario: Two groups

- **WHEN** the user ticks `server` and `reactjs` in the first group, adds a second group and ticks `api`
- **THEN** the picker holds the groups `server` or `reactjs`, and `api`

#### Scenario: Remove a group

- **WHEN** the user removes the second group
- **THEN** the picker keeps only the first group

### Requirement: Label picker summary

The picker SHALL show the filter it will apply as one sentence in which the labels of a group are joined by "or", each group is in brackets and groups are joined by "and". It SHALL update the sentence at each change. When no label is ticked, the sentence SHALL say that the list will show every record.

#### Scenario: Summary

- **WHEN** the first group holds `server` and `reactjs` and the second holds `api`
- **THEN** the picker shows "Showing: (server or reactjs) and (api)"

#### Scenario: Nothing ticked

- **WHEN** no label is ticked
- **THEN** the picker says that the list will show every record

### Requirement: Apply the picker

**Apply** SHALL set the list filter to one label per group, with the labels of a group joined by a bar, and close the picker. **Cancel**, the close button and the Escape key SHALL close it and leave the filter as it was. The filter bar, the address and the list SHALL then show the new filter in the way they show any filter. A group with one label SHALL give the same filter as selecting that label's pill.

#### Scenario: Apply two groups

- **WHEN** the first group holds `server` and `reactjs`, the second holds `api`, and the user selects **Apply**
- **THEN** the filter is `server|reactjs` and `api`, the address ends with `?labels=server%7Creactjs,api` and the filter bar shows `server or reactjs` and `api`

#### Scenario: Cancel

- **WHEN** the user ticks a label and selects **Cancel**
- **THEN** the filter and the list stay as they were

### Requirement: Picker starts from the current filter

The picker SHALL open with the current filter. Each label of the filter SHALL become one group, and each alternative of an OR label SHALL be ticked in that group. A label of the filter that no memorisation carries any more SHALL still show, ticked, so the user can remove it.

#### Scenario: Open with a filter

- **WHEN** the filter is `server|reactjs` and `api` and the user opens the picker
- **THEN** the picker shows two groups, with `server` and `reactjs` ticked in the first and `api` ticked in the second

### Requirement: Label picker in every language

The picker, its summary and its buttons SHALL appear in English, Chinese and Arabic. It SHALL fit a 390 px wide screen without sideways scrolling, and in Arabic the layout SHALL read from right to left.

#### Scenario: Narrow screen

- **WHEN** the picker is open on a 390 px wide screen
- **THEN** the page has no sideways scroll and every control can be reached

### Requirement: Label picker needs the label list

When the label list route fails, the picker SHALL say that the labels could not load, offer to try again, and keep **Cancel** working. A failure SHALL NOT change the filter.

#### Scenario: Route fails

- **WHEN** the label list route returns an error
- **THEN** the picker shows a short error with a **Try again** button and the filter stays as it was

### Requirement: Memorisation text renders as Markdown

When the user opens a memorisation card, the page SHALL render the full stored text as Markdown with the same renderer, sanitising and text style as the project memory cards. Headings, bullet lists, numbered lists, emphasis, inline code and code blocks SHALL render. The page SHALL remove scripts and other unsafe HTML from the text before it shows it. Plain text with no Markdown SHALL keep each line break.

#### Scenario: Structured note

- **WHEN** the user opens a memorisation whose text has a `## Plan` heading and three `-` bullet lines
- **THEN** the panel shows a Plan heading and a bullet list with three items

#### Scenario: Unsafe HTML

- **WHEN** the user opens a memorisation whose text contains `<script>alert(1)</script>`
- **THEN** the panel shows no script element and runs no script

#### Scenario: Snapshot saved before the change

- **WHEN** the user opens a memorisation stored as `Topic: release`, `Done: tagged` and `Next: publish` lines
- **THEN** the panel shows the three lines on separate lines

### Requirement: Memorisation card title is plain text

The card title SHALL be plain text with no Markdown symbols. The page SHALL take the text of a legacy `Topic:` line when the record has one. Otherwise it SHALL take the first non-empty line. It SHALL remove heading marks, emphasis marks, inline-code marks, list markers and link syntax from the title, and keep the link text.

#### Scenario: Note with a heading first

- **WHEN** a memorisation starts with the line `## OMRS harness **Docker** image`
- **THEN** the card title reads "OMRS harness Docker image"

#### Scenario: Snapshot saved after the change

- **WHEN** a memorisation starts with the line "omms release" followed by a `## Done` section
- **THEN** the card title reads "omms release"

#### Scenario: Snapshot saved before the change

- **WHEN** a memorisation has the line `Topic: release` after other lines
- **THEN** the card title reads "release"

### Requirement: Note length presets on the page

The Size cap card SHALL show a **Short**, **Medium**, **Long** or **Custom** choice above the number box. Each preset SHALL show its saved value in the chosen unit. Choosing a preset SHALL fill the number box with that value. Typing a number that matches no preset SHALL select **Custom**. Changing the unit while a preset is selected SHALL fill that preset's value in the new unit. Saving the cap SHALL write only `memorisationMaxSize` and `memorisationSizeUnit`.

#### Scenario: Choose Short

- **WHEN** the presets are the defaults and the user chooses **Short** with **Characters** and saves
- **THEN** the number box shows 800 and the global config holds `memorisationMaxSize: 800`

#### Scenario: Type a custom number

- **WHEN** the user types 3000 in the number box
- **THEN** **Custom** is selected

#### Scenario: Saved value matches a preset

- **WHEN** the saved cap is 500 tokens and the user opens the page
- **THEN** **Medium** and **Tokens** are selected

#### Scenario: Switch unit on a preset

- **WHEN** **Long** is selected with **Characters** and the user chooses **Tokens**
- **THEN** the number box shows 1250 and **Long** stays selected

### Requirement: Edit the preset values on the page

The Size cap card SHALL have an **Edit presets** button. It SHALL open three number boxes for Short, Medium and Long, in characters, each with its token estimate beside it, plus **Save**, **Cancel** and **Reset presets**. Save SHALL write `memorisationShortSize`, `memorisationMediumSize` and `memorisationLongSize` to the global config. When the selected preset's value changes, Save SHALL also write the new cap, so that preset stays selected.

#### Scenario: Edit the selected preset

- **WHEN** **Short** is selected with a cap of 800 characters, and the user sets Short to 1000 in the editor and saves
- **THEN** the global config holds `memorisationShortSize: 1000` and `memorisationMaxSize: 1000`, and **Short** stays selected

#### Scenario: Edit another preset

- **WHEN** **Medium** is selected, and the user sets Long to 8000 and saves
- **THEN** the global config holds `memorisationLongSize: 8000`, the cap is unchanged, and **Long** shows 8000

#### Scenario: Token estimate beside each box

- **WHEN** the user types 1000 in the Short box
- **THEN** the box shows "about 250 tokens" beside it

### Requirement: Preset editor checks, reset and cancel

The preset editor SHALL show the broken rule and SHALL NOT save when a value is out of range, the presets are out of order, or two presets have the same token value. **Reset presets** SHALL fill 800, 2000 and 5000 in the boxes without saving. **Cancel** SHALL close the boxes without a write.

#### Scenario: Out of order

- **WHEN** the user sets Short to 2500 while Medium is 2000
- **THEN** the editor says Short must be less than Medium and saves nothing

#### Scenario: Same token value

- **WHEN** the user sets Short to 1997 while Medium is 2000
- **THEN** the editor says Short and Medium must differ by at least one token and saves nothing

#### Scenario: Reset

- **WHEN** the user presses **Reset presets** and then **Save**
- **THEN** the global config holds 800, 2000 and 5000

#### Scenario: Cancel

- **WHEN** the user changes Short in the editor and presses **Cancel**
- **THEN** the boxes close and the global config is unchanged
