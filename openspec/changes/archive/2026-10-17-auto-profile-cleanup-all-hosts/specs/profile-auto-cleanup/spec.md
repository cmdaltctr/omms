# Spec Delta

## Purpose

OMMS cleans up the user profile by itself on OpenCode, Pi and Claude Code. It merges duplicate memories and removes useless ones every 500 analysed prompts by default. Every run leaves a restore record, so the user can undo the last automatic cleanup from the Profile page.

## ADDED Requirements

### Requirement: An automatic cleanup runs on every host after live learning

After a live profile learning pass on OpenCode, Pi or Claude Code saves its result, the host SHALL start an automatic cleanup when the count of analysed prompts of the profile has passed a multiple of `userProfileAutoCleanupInterval`. The setting `userProfileAutoCleanupEnabled` SHALL default to on and `userProfileAutoCleanupInterval` SHALL default to 500. The host SHALL NOT start an automatic cleanup when the setting is off or the interval is not a positive whole number. Learning from a history import, a backfill or a catch-up run SHALL NOT start one. The automatic cleanup SHALL run in the background, SHALL NOT delay learning or capture, and SHALL NOT start while another automatic cleanup runs in the same host process. A profile with fewer than 2 items SHALL be skipped. A failure of the automatic cleanup SHALL NOT change learning, capture or the manual memory tool.

#### Scenario: The count passes a multiple of the interval

- **WHEN** a live learning pass on any of the three hosts takes the count from 95 to 105 analysed prompts and the interval is 100
- **THEN** the host SHALL start an automatic cleanup

#### Scenario: The count does not pass a multiple

- **WHEN** a live learning pass takes the count from 100 to 110 and the interval is 100
- **THEN** the host SHALL NOT start an automatic cleanup

#### Scenario: The setting is off

- **WHEN** `userProfileAutoCleanupEnabled` is false and the count passes a multiple of the interval
- **THEN** no automatic cleanup SHALL start

#### Scenario: A history import crosses the interval

- **WHEN** a history import or backfill adds 300 analysed prompts to the count
- **THEN** no automatic cleanup SHALL start

#### Scenario: A cleanup is already running

- **WHEN** the count passes a multiple of the interval while an automatic cleanup runs in the same host process
- **THEN** the host SHALL NOT start a second one

### Requirement: The automatic cleanup covers the whole profile in batches

The automatic cleanup SHALL send every item of the profile to the profile model in batches, with the batch rules of AI Cleanup in `profile-ai-cleanup`. It SHALL NOT send more than 100 items in one request. It SHALL use the model that the host uses for profile learning: the host model, then the external API, then the session model, as the live model rule sets. Claude Code SHALL use the external API only, with the same external model that its profile learning uses. A batch that fails SHALL leave its items unchanged, and the run SHALL continue. When every batch fails, or no model is available, the run SHALL change nothing and SHALL leave no restore record. The log SHALL record the batch number, the item count and a fixed reason code, which is `no-provider` when no model is set. The log SHALL NOT contain item text, prompts or replies.

#### Scenario: A large profile

- **WHEN** the profile holds 2,260 items
- **THEN** the profile model SHALL receive no request with more than 100 items
- **AND** every item SHALL be in exactly one request

#### Scenario: Pi uses its own model

- **WHEN** an automatic cleanup runs in Pi and no external API is set
- **THEN** it SHALL use the model that Pi uses for profile learning

#### Scenario: Every batch fails

- **WHEN** every batch times out
- **THEN** the profile SHALL stay as it was
- **AND** no restore record SHALL exist for the run

#### Scenario: No model

- **WHEN** neither a host model nor an external API is set on Claude Code
- **THEN** the run SHALL end without a change
- **AND** the log SHALL say that no provider is set

### Requirement: The automatic cleanup saves its changes into the newest profile

The automatic cleanup SHALL save every merge and every removal that the model proposed, with no review. It SHALL put them into the newest stored profile, even when its version differs from the version the run read. It SHALL find each item by its section, category and description, and for workflows also its steps. Two spellings of one category that differ only in case, spacing, hyphens or underscores count as the same category. It SHALL skip a change when any of its items is no longer found. It SHALL change only the items of applied changes. Every other item SHALL stay as stored, including selected items the model kept or reworded, and items that learning added or updated during the run. The save SHALL check the version. When the save meets a newer version, the run SHALL load the profile and put the changes in again, at most three times. When all three fail, the profile SHALL stay unchanged and no restore record SHALL remain. When the proposed changes would remove, or merge into another item, more than 25% of the items the run sent, the run SHALL apply none of them, SHALL leave no restore record, and SHALL log the reason `too-many-changes`.

#### Scenario: The model proposes too much

- **WHEN** the run sent 2,000 items and the model proposes to remove or merge away 600 of them
- **THEN** the run SHALL change nothing
- **AND** SHALL log the reason `too-many-changes` and no item text

#### Scenario: Learning saves during the run

- **WHEN** learning adds an item and raises the frequency of a selected item while the run goes on
- **THEN** the run SHALL save its changes
- **AND** the new item SHALL be kept

#### Scenario: The model rewords a kept item

- **WHEN** the model returns an item as kept but with new wording
- **THEN** the run SHALL keep the stored wording

#### Scenario: Learning rewrites an item of a merge

- **WHEN** learning changes the description of one item of a proposed merge during the run
- **THEN** the run SHALL skip that merge
- **AND** the profile SHALL hold no duplicate of that item

#### Scenario: Saves keep colliding

- **WHEN** three save attempts in a row meet a newer version
- **THEN** the profile SHALL stay as the last writer left it
- **AND** no restore record SHALL remain

### Requirement: Every automatic cleanup that changes the profile leaves a restore record

Before the save, the automatic cleanup SHALL store a restore record. For each applied change, the record SHALL hold the items as they were stored and, for a merge, the merged item that the run writes. The record SHALL NOT hold items that the run did not change. The record SHALL be kept for 30 days and then deleted. A run that applies no change SHALL leave no record. The text of a record SHALL NOT appear in the log.

#### Scenario: A run with one merge and one removal

- **WHEN** a run merges 2 items into 1 and removes 1 item
- **THEN** the record SHALL hold the 2 original items, the merged item and the removed item
- **AND** the record SHALL hold no other item of the profile

#### Scenario: A run that changes nothing

- **WHEN** the model proposes no merge and no removal
- **THEN** no record SHALL be stored

#### Scenario: A record expires

- **WHEN** a record is 31 days old
- **THEN** the system SHALL delete it and SHALL NOT offer it for undo

### Requirement: The last automatic cleanup can be undone

The user SHALL be able to undo the newest automatic cleanup that has not been undone. Undo SHALL put the original items of each change back into the newest stored profile and SHALL remove the merged item that the run wrote. It SHALL leave every other item as stored, including items that learning added or updated since the run. Undo SHALL find items the same way as the run, by section, category and description, and for workflows also steps, with the same rule for category spellings. A change SHALL be reported as not found, and SHALL NOT be restored, when the merged item can no longer be matched as the run left it, or when an original item is already in the profile. Undo SHALL NOT create a duplicate. Undo SHALL save with the version check and SHALL try again on a conflict, at most three times. Undo SHALL report how many changes it restored and how many it did not find. After an undo the system SHALL NOT offer that record again.

#### Scenario: Undo after learning ran

- **WHEN** a run merged 4 groups and removed 3 items, later learning added 5 items and merged one of the merge results into another item, and the user undoes the run
- **THEN** undo SHALL restore the 3 merges and 3 removals it still finds
- **AND** the 5 new items SHALL stay
- **AND** undo SHALL report 6 restored and 1 not found

#### Scenario: A save rewrote a category spelling

- **WHEN** the run wrote a merged item with the category `git_workflow` and a later save stored it as `Git workflow`
- **THEN** undo SHALL still find the merged item and restore the originals

#### Scenario: An original item is already back

- **WHEN** learning created an item equal to a removed original, and the user undoes the run
- **THEN** undo SHALL NOT add a second copy
- **AND** SHALL count that change as not found

#### Scenario: Nothing to undo

- **WHEN** no record exists that is not undone
- **THEN** undo SHALL say that there is nothing to undo

#### Scenario: Undo twice

- **WHEN** the user undoes the newest run and then asks again
- **THEN** the second undo SHALL act on the next older record, or say that there is nothing to undo

### Requirement: The Profile page offers the undo

The Profile page SHALL show an Undo last automatic cleanup button only while a record exists that is not undone. Selecting the button SHALL open a confirmation that says when the run happened and how many items it merged and removed. The system SHALL undo only after the user confirms. After the undo, the page SHALL show how many changes were restored and how many were not found, and SHALL reload the profile.

#### Scenario: No record

- **WHEN** the profile has no record that is not undone
- **THEN** the Profile page SHALL NOT show the button

#### Scenario: Confirm

- **WHEN** a record exists from a run that merged 4 groups and removed 3 items
- **THEN** selecting the button SHALL show the time of the run, 4 merged and 3 removed
- **AND** nothing SHALL change until the user confirms

#### Scenario: Cancel

- **WHEN** the user cancels the confirmation
- **THEN** the profile SHALL stay as it is
- **AND** the record SHALL stay available

### Requirement: The Memory page controls the automatic cleanup

The Profile learning card of the Memory page SHALL show a switch for `userProfileAutoCleanupEnabled` and a field for `userProfileAutoCleanupInterval`, with their saved values, and SHALL say that each run makes about one model call for every 100 profile items. The page SHALL save them with the safe global save of the other settings, which refuses a stale config revision and keeps comments and other keys. The page SHALL accept an interval that is a whole number from 50 to 100000 and SHALL refuse any other value with a message beside the field, without writing. A project config SHALL NOT override either setting, and the page SHALL show the global value. A saved change SHALL apply to the next learning pass, without a restart.

#### Scenario: Turn it off

- **WHEN** the user clears the switch
- **THEN** the page SHALL save `userProfileAutoCleanupEnabled` as false
- **AND** the next learning pass that crosses the interval SHALL start no cleanup

#### Scenario: Change the interval

- **WHEN** the user enters 300 and saves
- **THEN** the page SHALL save `userProfileAutoCleanupInterval` as 300

#### Scenario: A value that is not allowed

- **WHEN** the user enters 10, 2.5, 0 or text
- **THEN** the page SHALL show a message beside the field
- **AND** SHALL write nothing

#### Scenario: A project config sets a value

- **WHEN** a project config sets `userProfileAutoCleanupInterval`
- **THEN** the running hosts SHALL keep using the global value
