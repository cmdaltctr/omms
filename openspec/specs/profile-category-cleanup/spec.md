# profile-category-cleanup Specification

## Purpose

Let a user merge profile category names that mean the same thing into one name, from a preview they control, without changing or removing any profile item, and undo the last cleanup.

## Requirements

### Requirement: A cleanup groups category names by meaning

A category cleanup SHALL consider every distinct category label of the stored preferences and patterns together, after the label rules of the category spelling repair. It SHALL group labels whose names mean the same thing. A group SHALL hold at least two labels; a label with no close match SHALL stay out of every group. The reserved label `explicit` SHALL never join a group. Each group SHALL list its labels with the number of items in each.

#### Scenario: Two wordings of one idea

- **WHEN** a profile holds preferences labelled "Execution" and "Direct execution" whose names the embedder places close together
- **THEN** the preview SHALL show one group holding both labels and their item counts

#### Scenario: A group across sections

- **WHEN** a preference is labelled "Release workflow" and a pattern is labelled "Release process", and the names are close
- **THEN** the preview SHALL show one group holding both labels

#### Scenario: A label with no close match

- **WHEN** a label has no other label close to it
- **THEN** the preview SHALL NOT show that label in any group

#### Scenario: The reserved label

- **WHEN** a profile holds items labelled `explicit`
- **THEN** no group SHALL hold `explicit`

### Requirement: Each group gets one proposed name

The profile model SHALL check each group: it SHALL move out of the group any label that does not mean the same as the others, and SHALL propose one name for the group. A group left with fewer than two labels SHALL be dropped from the preview. When no profile model is available, or a model call fails or times out, the proposed name SHALL be the label with the most items in the group, and the group SHALL be marked as not checked by the model. The model SHALL receive only category names and up to three example descriptions per name. The log SHALL record counts and outcome codes, never names or descriptions.

#### Scenario: The model removes a stray label

- **WHEN** a group holds "Execution", "Direct execution" and "Execution speed", and the model judges "Execution speed" different
- **THEN** the preview SHALL show "Execution" and "Direct execution" in the group
- **AND** SHALL NOT show "Execution speed" in it

#### Scenario: No model available

- **WHEN** a cleanup runs with no usable profile model
- **THEN** each group's proposed name SHALL be its most used label
- **AND** each group SHALL be marked as not checked by the model

### Requirement: The user reviews the cleanup before anything changes

Building a cleanup preview SHALL NOT change the stored profile. The preview SHALL show, for each group, its labels, their item counts and the proposed name. The user SHALL be able to reject a group and to edit a group's name before applying. The preview SHALL show the number of categories before and after the accepted groups, and SHALL state that later learning merges near-duplicate memories more readily inside one category.

#### Scenario: A preview

- **WHEN** a user opens the cleanup preview
- **THEN** the stored profile SHALL stay unchanged
- **AND** the preview SHALL show the category count before and after

#### Scenario: A rejected group

- **WHEN** a user rejects one group and applies the rest
- **THEN** the items in the rejected group SHALL keep their categories

#### Scenario: An edited name

- **WHEN** a user changes a group's name to "Working style" and applies
- **THEN** every item in that group SHALL have the category "Working style"

### Requirement: Applying a cleanup only renames categories

Applying a cleanup SHALL set the category of each item in each accepted group to the group's name, after the label tidying rules. It SHALL NOT change any item's description, evidence, frequency, confidence or vectors, and SHALL NOT add, merge or remove any item. The change SHALL be saved as one profile changelog entry that names it as a category cleanup. Applying SHALL fail without changes when the profile changed after the preview was built.

#### Scenario: Items keep their content

- **WHEN** a cleanup renames 12 items
- **THEN** the profile SHALL hold the same number of items as before
- **AND** each renamed item SHALL keep its description, evidence and frequency

#### Scenario: The profile changed after the preview

- **WHEN** profile learning saves a new version between the preview and the apply
- **THEN** applying SHALL fail with a message to build a new preview
- **AND** the stored profile SHALL keep the version that learning saved

### Requirement: The last cleanup can be undone

The user SHALL be able to undo the most recent category cleanup. Undo SHALL restore the previous category on every item the cleanup renamed that still exists with the category the cleanup gave it, and SHALL leave every other item unchanged, including items that learning added after the cleanup. Undo SHALL report how many items it restored and how many it could not find. Undo SHALL be saved as one profile changelog entry.

#### Scenario: Undo after learning ran

- **WHEN** a cleanup renamed 12 items, later learning merged 2 of them away and added 5 new items, and the user undoes the cleanup
- **THEN** 10 items SHALL get their previous categories back
- **AND** the 5 new items SHALL keep their categories
- **AND** undo SHALL report 10 restored and 2 not found

#### Scenario: Nothing to undo

- **WHEN** no category cleanup has been applied
- **THEN** undo SHALL report that there is nothing to undo
- **AND** SHALL NOT write a changelog entry

### Requirement: A long preview runs in the background with progress

The web app SHALL build the cleanup preview as a background job. Starting a preview SHALL return at once with the job's state. The state SHALL say whether the job is grouping names, checking groups (with batches done and the total), done (with the preview) or failed (with an error). Starting a preview while one runs for the same user SHALL return the running job and SHALL NOT start a second one. Profile model calls SHALL run one at a time, each with a limit of 180 seconds. Closing the review dialog SHALL NOT stop the job; opening it again SHALL show the job's current state.

#### Scenario: Starting a preview

- **WHEN** a user starts a cleanup preview on the Profile page
- **THEN** the request SHALL return before the profile model is called
- **AND** the dialog SHALL show the progress of the job

#### Scenario: Starting twice

- **WHEN** a user starts a preview while one is running
- **THEN** the system SHALL return the running job
- **AND** SHALL make no extra model calls

#### Scenario: Reopening the dialog

- **WHEN** a user closes the dialog during a job and opens it again after the job is done
- **THEN** the dialog SHALL show the finished groups

### Requirement: Every host reaches the same cleanup

The cleanup SHALL be available from the web app Profile page and from the command `om-memory-system profile-cleanup-categories`. Both SHALL use the same shared service and SHALL give the same groups for the same profile and model replies. The command SHALL preview by default, SHALL apply every group with `--yes`, and SHALL undo the last cleanup with `--undo`. The Profile page SHALL show the current number of categories beside the cleanup button. All new web text SHALL be available in English, Chinese and Arabic.

#### Scenario: Command preview

- **WHEN** a user runs `om-memory-system profile-cleanup-categories` without options
- **THEN** the command SHALL print each group with its labels, item counts and proposed name
- **AND** the stored profile SHALL stay unchanged

#### Scenario: Web and command agree

- **WHEN** the same profile is previewed from the web app and from the command with the same model replies
- **THEN** both SHALL show the same groups and proposed names
