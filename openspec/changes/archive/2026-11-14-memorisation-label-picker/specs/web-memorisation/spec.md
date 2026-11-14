## ADDED Requirements

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
