# profile-identity Specification

## Purpose

Decides which stored user profile belongs to the person using OMMS, and lets that person pick or merge profiles when more than one exists on the machine.

## Requirements

### Requirement: The user's email is found outside a project

OMMS SHALL find the user's email in this order: `userEmailOverride`; the git email of the working directory; the global git email. A working directory with no Git repository and no project marker above it SHALL still allow a `git` executable on `PATH`. The web app SHALL use the same order when it runs from a directory that is not a project, such as `/` for the login item. When no email is found and exactly one active profile exists, the profile page SHALL show that profile.

#### Scenario: Login web app started from the root directory

- **WHEN** the login web app runs with `/` as its working directory, `userEmailOverride` is empty, and the global git email is `me@example.com`
- **THEN** the profile page SHALL show the profile for `me@example.com`

#### Scenario: No email anywhere and one profile

- **WHEN** no email is found and exactly one active profile exists
- **THEN** the profile page SHALL show that profile

#### Scenario: The override wins

- **WHEN** `userEmailOverride` is `me@example.com` and the working directory's git email is `bot@example.com`
- **THEN** capture, profile learning, and the profile page SHALL use `me@example.com`

### Requirement: The Settings page shows profiles when more than one exists

When more than one active profile exists, the Settings page SHALL show a **Profiles** card. It SHALL list each active profile with its email, its numbers of preferences, patterns, and workflows, the number of prompts analysed, and its last update time, and SHALL mark the profile that OMMS uses now. It SHALL say why profiles split: each folder's git email names its owner. When one or no active profile exists, the card SHALL NOT be shown.

#### Scenario: Two profiles after a repository with its own email

- **WHEN** profiles for `me@example.com` and `bot@example.com` are active and OMMS uses `me@example.com`
- **THEN** the Profiles card SHALL list both profiles with their counts
- **AND** SHALL mark `me@example.com` as in use

#### Scenario: One profile

- **WHEN** only one active profile exists
- **THEN** the Profiles card SHALL NOT be shown

### Requirement: The user can choose or merge profiles

The Profiles card SHALL offer **Use this profile** for each profile not in use. It SHALL save that profile's email as `userEmailOverride` in the global config with the same safe-save rules as other settings. The card SHALL offer **Merge into** for each pair of profiles. A merge SHALL combine the source profile's preferences, patterns, and workflows into the target with the same matching rules as profile learning, add the source's analysed prompt count to the target, record a changelog entry on the target, and turn the source profile off without deleting it. The page SHALL ask the user to confirm a merge. Both actions SHALL follow the same origin and authentication rules as other Settings changes.

#### Scenario: Choosing a profile

- **WHEN** the user presses Use this profile for `me@example.com` and confirms
- **THEN** the global config SHALL have `userEmailOverride` set to `me@example.com`
- **AND** the profile page SHALL show that profile

#### Scenario: Merging a stray profile

- **WHEN** the user merges `bot@example.com` into `me@example.com` and confirms
- **THEN** the `me@example.com` profile SHALL hold the combined items and a changelog entry for the merge
- **AND** the `bot@example.com` profile SHALL be inactive and still stored
- **AND** the Profiles card SHALL no longer be shown if one active profile is left

### Requirement: The profile API does not send embedding vectors

The profile API SHALL leave out each item's embedding vectors when it sends a profile to the browser. An edit or delete of a profile item from the page SHALL keep the stored vectors of every other item, and SHALL keep the vectors of the edited item unless its text changes.

#### Scenario: Loading a large profile

- **WHEN** the page loads a profile of 300 items, each with two 1024-number vectors stored
- **THEN** the response SHALL contain no vector fields

#### Scenario: Deleting one item from the page

- **WHEN** the user deletes one preference on the profile page
- **THEN** the stored vectors of the other items SHALL be unchanged

### Requirement: Profile confidence is shown as a coloured badge

The profile page SHALL show each item's confidence as a small rectangular badge with rounded corners. Its colour SHALL show the band: green from 80%, blue from 60% to below 80%, orange from 40% to below 60%, and red below 40%.

#### Scenario: A preference at 99%

- **WHEN** a preference has a confidence of 0.99
- **THEN** the page SHALL show a green 99% badge

#### Scenario: A pattern at 35%

- **WHEN** a pattern has a confidence of 0.35
- **THEN** the page SHALL show a red 35% badge
