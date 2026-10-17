# Spec Delta

## MODIFIED Requirements

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
