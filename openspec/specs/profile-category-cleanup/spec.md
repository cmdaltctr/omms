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

Building a cleanup preview SHALL NOT change the stored profile. The preview SHALL show, for each group, its labels, their item counts and the proposed name. The user SHALL be able to reject a group and to edit a group's name before applying. The preview SHALL show the number of categories before and after the accepted groups, and SHALL state that later learning merges near-duplicate memories more readily inside one category. A group that the model checked SHALL start accepted. A group that the model did not check SHALL start rejected, and the user SHALL be able to accept it.

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

#### Scenario: Groups the model did not check

- **WHEN** a preview holds 40 checked groups and 284 groups the model did not check
- **THEN** the 40 checked groups SHALL start accepted
- **AND** the 284 unchecked groups SHALL start rejected
- **AND** the category count after SHALL count only the 40 accepted groups

#### Scenario: The user accepts an unchecked group

- **WHEN** a user accepts one unchecked group and applies
- **THEN** every item in that group SHALL get the group's name

### Requirement: Applying a cleanup only renames categories

Applying a cleanup SHALL set the category of each item in each accepted group to the group's name, after the label tidying rules, on the profile as it is stored when the user applies. It SHALL NOT change any item's description, evidence, frequency, confidence or vectors, and SHALL NOT add, merge or remove any item. The change SHALL be saved as one profile changelog entry that names it as a category cleanup. Applying SHALL NOT require the profile to be unchanged since the preview was built. Applying SHALL fail without changes when another save lands while it writes.

#### Scenario: Items keep their content

- **WHEN** a cleanup renames 12 items
- **THEN** the profile SHALL hold the same number of items as before
- **AND** each renamed item SHALL keep its description, evidence and frequency

#### Scenario: The profile changed after the preview

- **WHEN** profile learning saves a new version between the preview and the apply
- **THEN** applying SHALL succeed
- **AND** every item in the newer profile whose category is a label of an accepted group SHALL get the group's name
- **AND** items that learning added or changed SHALL keep everything except that category

#### Scenario: A label no longer exists

- **WHEN** learning removed every item of an accepted group's labels after the preview
- **THEN** applying SHALL succeed and report 0 items renamed
- **AND** SHALL NOT write a changelog entry

#### Scenario: A save lands while applying

- **WHEN** another save changes the stored profile between the moment apply reads it and the moment apply writes it
- **THEN** applying SHALL fail with a message to try again
- **AND** the stored profile SHALL keep the version that the other save wrote

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

### Requirement: Model verdicts are reused between previews

The profile model's answer for a group (the labels it kept and the proposed name) SHALL be saved when the model returns it. A later preview SHALL reuse the saved answer for each group whose set of labels is unchanged, and SHALL ask the model only about the other groups. A group the model did not answer, because the call failed, timed out or returned no entry for it, SHALL NOT be saved. A saved answer SHALL be discarded after 30 days and when its group no longer appears in a preview. A saved answer SHALL hold category names only, never item descriptions, prompts or raw model replies.

#### Scenario: A rebuild after learning

- **WHEN** a preview checked 300 groups, learning then changed the labels so that 12 groups are new, and the user builds a new preview
- **THEN** the model SHALL be asked about the 12 new groups only
- **AND** the other groups SHALL show the names from the earlier preview

#### Scenario: Retry only what failed

- **WHEN** a preview had 6 batches time out, so their groups were not checked, and the user builds a new preview
- **THEN** the model SHALL be asked about the groups of those 6 batches only
- **AND** the groups checked in the earlier preview SHALL NOT be sent again

#### Scenario: A crash during a preview

- **WHEN** the app stops after 8 of 16 batches returned and the user opens the preview again
- **THEN** the model SHALL be asked about the groups of the 8 batches that did not return

#### Scenario: A changed label set

- **WHEN** a group now holds a label that the earlier group did not
- **THEN** the model SHALL be asked about that group again

#### Scenario: A saved drop

- **WHEN** the model removed all but one label from a group in an earlier preview, so the group was dropped
- **THEN** a new preview SHALL NOT ask the model about that label set again
- **AND** the preview SHALL NOT show the group

#### Scenario: Expiry

- **WHEN** a saved answer is 31 days old
- **THEN** the next preview SHALL ask the model about that group again
- **AND** SHALL delete the old answer

#### Scenario: Progress of a rebuild

- **WHEN** 40 of 300 groups need the model
- **THEN** the progress SHALL count the 2 batches that will run, not the 15 batches of a full check

### Requirement: The Profile page shows the state of a cleanup preview

The web app SHALL show a banner on the Profile page while the user's cleanup preview job exists. The banner SHALL show the job's state: running with its progress, ready with the number of groups, or failed with the error. The banner SHALL offer a button that opens the review dialog. The banner SHALL only read the job state. It SHALL NOT start a job or call the profile model.

#### Scenario: Running preview with the dialog closed

- **WHEN** the job is checking groups and the user has closed the review dialog
- **THEN** the banner SHALL show the batches done and the total
- **AND** SHALL update without a page reload
- **AND** its button SHALL open the review dialog

#### Scenario: Grouping names

- **WHEN** the job is grouping category names
- **THEN** the banner SHALL say that names are being grouped
- **AND** SHALL NOT show a batch count

#### Scenario: Preview finishes

- **WHEN** the job finishes while the user is on the Profile page
- **THEN** the banner SHALL change to say that a preview is ready, with the number of groups
- **AND** SHALL stop asking the web app for the job state

#### Scenario: Preview fails

- **WHEN** the job fails
- **THEN** the banner SHALL show the error
- **AND** its button SHALL open the review dialog, where a new preview can be built

#### Scenario: No job

- **WHEN** no job exists, after a restart of the web app or after Apply or Undo
- **THEN** the Profile page SHALL show no banner

#### Scenario: Dialog open

- **WHEN** the review dialog is open
- **THEN** the banner SHALL be hidden
- **AND** SHALL show the current job state when the dialog closes

#### Scenario: The status request fails

- **WHEN** the request for the job state fails, for example because the web app stopped
- **THEN** the Profile page SHALL show no banner
- **AND** SHALL show no error message
- **AND** SHALL NOT ask again until the page opens again or the review dialog closes

#### Scenario: Leaving the Profile page

- **WHEN** the user moves from the Profile page to another page while a job runs
- **THEN** the web app SHALL stop asking for the job state
- **AND** the job SHALL continue on the server

#### Scenario: Opening the page starts nothing

- **WHEN** the user opens the Profile page and no job exists
- **THEN** the system SHALL NOT start a job
- **AND** SHALL make no model call
