# profile-ai-cleanup Specification

## Purpose

AI Cleanup in the web app asks the profile model to merge and remove profile memories after the user reviews the changes. This capability makes a cleanup of any size finish, show its progress, say why it failed, and apply to the newest profile.

## Requirements

### Requirement: A cleanup sends the selected items in batches

AI Cleanup in the web app SHALL send the selected items to the profile model in batches of at most 100 items, one batch for each model request. Batches SHALL run one after another. Each model request SHALL keep the time limit of the external API call. A batch SHALL hold items of one section only: preferences, patterns or workflows. Within a section, items with the same category SHALL be in the same batch when that category has at most 100 selected items. An item SHALL appear in exactly one batch.

#### Scenario: A large selection

- **WHEN** the user selects 2,045 items and starts the analysis
- **THEN** the profile model SHALL receive no request with more than 100 items
- **AND** every selected item SHALL be in exactly one request

#### Scenario: Sections are not mixed

- **WHEN** the selection holds 60 preferences and 30 patterns
- **THEN** the preferences and the patterns SHALL be sent in different requests

#### Scenario: A category stays in one batch

- **WHEN** 30 selected preferences share one category and the selection holds 500 preferences
- **THEN** those 30 preferences SHALL be in the same request

#### Scenario: A small selection

- **WHEN** the user selects 40 preferences
- **THEN** the profile model SHALL receive one request

### Requirement: A web cleanup runs as a background job with progress

The web app SHALL run AI Cleanup as a background job for each user. Starting a cleanup SHALL return at once. The web app SHALL give the job state on request: while it runs, the batches done, the total batches and the failed batches; when it is done, the result; when it failed, the error. If a job is already running for the user, starting a cleanup SHALL return that job and SHALL NOT start another. The loading screen SHALL show the batches done and the total, and a Stop button. Stop SHALL end the job: no new batch SHALL start, and the result of the batch in progress SHALL be discarded. Closing the dialog SHALL NOT stop the job. Jobs SHALL live only in the running web app.

#### Scenario: Progress is visible

- **WHEN** a job has finished 3 of 14 batches
- **THEN** the loading screen SHALL show batch 3 of 14

#### Scenario: Close and reopen during a run

- **WHEN** the user closes the dialog while batch 5 of 14 runs and opens it again later
- **THEN** the dialog SHALL show the progress of the same job
- **AND** no batch SHALL have been sent twice

#### Scenario: Reopen after the job is done

- **WHEN** the job finished while the dialog was closed and the result has not been applied or discarded
- **THEN** opening the dialog SHALL show the review screen with that result

#### Scenario: A second start

- **WHEN** a start request arrives while a job for the same user is running
- **THEN** the web app SHALL return the running job
- **AND** SHALL NOT send another model request for it

#### Scenario: Stop

- **WHEN** the user selects Stop while batch 5 runs
- **THEN** no request for batch 6 SHALL be sent
- **AND** the dialog SHALL return to the selection screen with the same items selected

### Requirement: A failed batch leaves its items unchanged

When a batch fails or times out, the cleanup SHALL keep every item of that batch as it was and SHALL continue with the next batch. The review screen SHALL say how many batches failed and how many items they held. The log SHALL record the batch number, the item count and a fixed reason code: `timeout`, `http-<status>`, `invalid-reply`, `no-provider` or `error`. `no-provider` means that neither a host model nor an external API is set. The log SHALL NOT contain item text, prompts or replies.

#### Scenario: One batch times out

- **WHEN** batch 4 of 14 times out and the others succeed
- **THEN** the review screen SHALL show the changes of 13 batches
- **AND** SHALL say that 1 batch failed and its items are unchanged
- **AND** no item of batch 4 SHALL appear as merged or removed

#### Scenario: No provider is set

- **WHEN** a batch fails because neither a host model nor an external API is set
- **THEN** the log SHALL record the reason code `no-provider`
- **AND** SHALL NOT contain item text

### Requirement: A failed cleanup shows its reason in the dialog

When every batch fails, or the job cannot start, the dialog SHALL show the error text and a Retry button in the dialog body, with a way back to the selection screen. The error SHALL stay until the user acts. A toast alone SHALL NOT be the only sign of the failure. The error text SHALL NOT contain an API key.

#### Scenario: Every batch times out

- **WHEN** all batches time out
- **THEN** the dialog SHALL say that the model did not answer in time
- **AND** SHALL offer Retry and a way back to the selection screen

#### Scenario: Retry

- **WHEN** the user selects Retry after a failure
- **THEN** the web app SHALL start a new job with the same selection

#### Scenario: No provider configured

- **WHEN** neither a host model nor an external API is configured
- **THEN** the dialog SHALL say that no AI provider is configured

### Requirement: Apply puts the ticked changes into the newest profile

The review screen SHALL show the merges and removals of all batches together. A merge SHALL combine items from one batch only. Apply SHALL put the ticked changes into the newest stored profile, even when its version differs from the version the job read. Apply SHALL find each item by its section, category and description, and for workflows also its steps. Two spellings of one category that differ only in case, spacing, hyphens or underscores SHALL count as the same category, because every save keeps one spelling for each category and may rewrite a stored item. A ticked change SHALL be skipped when any of its items is no longer found. Apply SHALL change only the items of ticked changes. Every other item SHALL stay exactly as stored, including selected items the model kept or reworded, unticked changes, and items that learning added or updated during the run. An empty selection SHALL mean every item of the profile when the job starts. The save SHALL check the version. When the save meets a newer version, Apply SHALL load the profile and put the changes in again, at most three times; when all three fail, the profile SHALL stay unchanged and the dialog SHALL ask the user to try again. The result SHALL say how many ticked changes were applied and how many were skipped.

#### Scenario: Merges from two batches

- **WHEN** batch 1 proposes one merge and batch 2 proposes one removal
- **THEN** the review screen SHALL list both changes
- **AND** Apply SHALL save only the changes the user ticked

#### Scenario: Learning saves during the run

- **WHEN** learning adds a new item and raises the frequency of a selected item while the job runs
- **THEN** Apply SHALL save the ticked changes
- **AND** the new item SHALL be kept
- **AND** the selected item SHALL be merged or kept as the ticked changes say

#### Scenario: The model rewords a kept item

- **WHEN** the model returns a selected item as kept but with new wording
- **THEN** Apply SHALL keep the stored wording of that item

#### Scenario: Learning rewrites an item of a ticked merge

- **WHEN** learning changes the description of one item of a ticked merge during the run
- **THEN** Apply SHALL skip that merge
- **AND** the profile SHALL hold no duplicate of that item
- **AND** the result SHALL say that 1 change was skipped

#### Scenario: Saves keep colliding

- **WHEN** three save attempts in a row meet a newer version
- **THEN** the profile SHALL stay as the last writer left it
- **AND** the dialog SHALL ask the user to try again

#### Scenario: A save rewrote a category spelling

- **WHEN** a save during the run rewrote the category of a selected item from `git_workflow` to `Git workflow`
- **THEN** Apply SHALL still find that item
