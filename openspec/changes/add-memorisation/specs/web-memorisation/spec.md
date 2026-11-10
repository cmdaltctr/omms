# Spec Delta

## Purpose

The web app's Memorisation page lets the user browse, recall, copy and delete memorisations, and choose what happens when a session is memorised again.

## ADDED Requirements

### Requirement: Sidebar Memorisation entry

The sidebar main list SHALL show a **Memorisation** entry directly after the project entry, with an icon and an accessible label in every supported language. Selecting it SHALL open `/memorisation`. Opening `/memorisation` directly or reloading SHALL show the same page.

#### Scenario: Open from the sidebar

- **WHEN** the user selects **Memorisation** in the sidebar
- **THEN** the browser shows `/memorisation` and the Memorisation page

#### Scenario: Reload

- **WHEN** the user reloads `/memorisation`
- **THEN** the Memorisation page appears again

### Requirement: Memorisation list

The page SHALL list the memorisations of the current project in the active and linked spaces, newest first. Each row SHALL show the ID, the topic or first line, the host, and the creation time. Opening a row SHALL show the full stored text.

#### Scenario: Rows show IDs

- **WHEN** the project has two memorisations
- **THEN** the page shows two rows, each with its `mz-` ID

#### Scenario: No memorisations

- **WHEN** the project has no memorisations
- **THEN** the page tells the user how to memorise from an agent or the CLI

### Requirement: Recall search on the page

The page SHALL have a search box that runs the same recall as the `recall` mode. An ID SHALL show that one record. Text SHALL show the matches with their confidence scores.

#### Scenario: Search by ID

- **WHEN** the user types `mz-4k7q2p`
- **THEN** the page shows only that memorisation

#### Scenario: Search by text

- **WHEN** the user types "release notes"
- **THEN** the page shows matching memorisations with a confidence score on each

### Requirement: Copy ID and delete

Each memorisation SHALL offer **Copy ID**, which puts the ID on the clipboard, and **Delete**, which asks for confirmation and then removes the record.

#### Scenario: Copy

- **WHEN** the user selects **Copy ID** on `mz-4k7q2p`
- **THEN** the clipboard holds `mz-4k7q2p`

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
