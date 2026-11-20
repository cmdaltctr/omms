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

### Requirement: A running web cleanup can be minimised

While an AI Cleanup runs, the dialog SHALL show a Minimise button next to its close button. Minimise SHALL hide the dialog, SHALL NOT stop the job, and SHALL show a status pill at the top right of the window. Closing the dialog with the close button SHALL NOT show the pill.

#### Scenario: Minimise during a run

- **WHEN** the user selects Minimise while batch 5 of 14 runs
- **THEN** the dialog SHALL close
- **AND** the job SHALL keep running
- **AND** a pill at the top right SHALL show batch 5 of 14

#### Scenario: Close shows no pill

- **WHEN** the user closes the dialog with the close button while a job runs
- **THEN** no pill SHALL be shown
- **AND** the job SHALL keep running

### Requirement: The status pill follows the cleanup job

While the pill shows, the web app SHALL keep reading the job state. The pill SHALL show the batches done and the total while the job runs, a ready-to-review message when it is done, and a failure message in the error colour when it failed. Selecting the pill SHALL open the dialog on the screen for the current job state and SHALL remove the pill. When a read finds no job, the pill SHALL be removed.

#### Scenario: The pill follows progress

- **WHEN** the dialog is minimised and the job finishes batch 6 of 14
- **THEN** the pill SHALL show batch 6 of 14 without a page reload

#### Scenario: The job finishes while minimised

- **WHEN** the job finishes while the dialog is minimised
- **THEN** the pill SHALL say that the cleanup is ready to review
- **AND** selecting the pill SHALL open the review screen with that result

#### Scenario: The job fails while minimised

- **WHEN** every batch fails while the dialog is minimised
- **THEN** the pill SHALL say that the cleanup failed, in the error colour
- **AND** selecting the pill SHALL open the dialog with the error, Retry and Back

#### Scenario: The job is gone

- **WHEN** the dialog is minimised and a read of the job state finds no job
- **THEN** the pill SHALL be removed

### Requirement: A finished cleanup marks the memories the model left alone

When a cleanup job finishes, the web app SHALL mark as checked each selected memory of a successful batch that the model reply neither merges nor removes. A reply is successful when the batch call returned and the reply held a valid mapping. The mark SHALL NOT depend on the review screen, so it stays when the user presses Back or the review expires.

#### Scenario: A kept memory is marked

- **WHEN** a batch of 100 memories succeeds and the reply merges 6 and removes 4
- **THEN** the other 90 memories SHALL be marked as checked

#### Scenario: Back keeps the marks

- **WHEN** the job is done and the user presses Back on the review screen
- **THEN** the memories marked when the job finished SHALL stay checked
- **AND** the memories of the proposed merges and removals SHALL NOT be marked

### Requirement: A failed or stopped batch marks nothing

A batch that fails, times out or returns a reply with no valid mapping SHALL NOT mark any of its memories. A cleanup that fails in every batch SHALL mark nothing. Stop SHALL mark nothing, including the memories of batches that already finished.

#### Scenario: One batch times out

- **WHEN** batch 4 of 14 times out and the other batches succeed
- **THEN** no memory of batch 4 SHALL be marked
- **AND** the kept memories of the other 13 batches SHALL be marked

#### Scenario: Reply without a mapping

- **WHEN** the model returns JSON that has no valid mapping for a batch
- **THEN** the memories of that batch SHALL stay unmarked

#### Scenario: Stop

- **WHEN** the user selects Stop after 5 of 14 batches finished
- **THEN** no memory SHALL be marked

### Requirement: Apply marks the memories of unticked changes

When the user applies a review, Apply SHALL mark as checked each memory of a proposed merge or removal that the user did not tick. Apply SHALL NOT mark the memories of a ticked change, and SHALL NOT leave a mark on a memory that a ticked merge changed. A ticked change that Apply skips SHALL mark nothing.

#### Scenario: The user unticks a merge

- **WHEN** the review holds one merge of two memories, the user unticks it, and presses Apply with another change ticked
- **THEN** both memories of the unticked merge SHALL be checked

#### Scenario: A ticked merge

- **WHEN** the user ticks a merge and Apply applies it
- **THEN** the merged memory SHALL NOT be checked

#### Scenario: Dismissed proposals stay unchecked

- **WHEN** the user presses Back without Apply
- **THEN** the memories of the proposed changes SHALL stay unchecked

### Requirement: A mark ends when the text or category of a memory changes

A memory SHALL count as checked only while its section, category, description and steps equal their values when it was marked. Two spellings of one category that differ only in case, spacing, hyphens or underscores SHALL count as the same category. An edit of the description or the steps, a category change, or a ticked merge that rewrites the memory SHALL end the mark. A change of frequency alone SHALL NOT end the mark. The position of the memory in the profile SHALL NOT matter.

#### Scenario: A description changes

- **WHEN** a checked memory is edited
- **THEN** the memory SHALL be unchecked

#### Scenario: The category changes

- **WHEN** a checked memory moves from category `git` to category `testing`
- **THEN** the memory SHALL be unchecked

#### Scenario: A new observation

- **WHEN** learning raises the frequency of a checked memory from 2 to 3 and its text and category stay the same
- **THEN** the memory SHALL stay checked

#### Scenario: The profile is reordered

- **WHEN** other memories are added or removed and the checked memory moves to a new position
- **THEN** the memory SHALL stay checked

#### Scenario: A category spelling is rewritten

- **WHEN** a save rewrites the category of a checked memory from `git_workflow` to `Git workflow`
- **THEN** the memory SHALL stay checked

### Requirement: Marks are stored apart from the profile text

The web app SHALL store each mark in the profile database of the active memory space, for one profile, as a one-way hash of the memory and the time of the mark. The store SHALL NOT hold memory text, and SHALL NOT change the profile items, the profile version or the changelog. Each marking run SHALL delete the marks of that profile that match no memory now. A memory space SHALL keep its own marks, and a switch of the active space SHALL show the marks of the new space.

#### Scenario: No profile change

- **WHEN** a cleanup job marks 900 memories
- **THEN** the profile version SHALL stay the same
- **AND** the profile changelog SHALL hold no new entry

#### Scenario: Space switch

- **WHEN** the user switches from space A, where 900 memories are checked, to space B
- **THEN** the dialog SHALL show the checked memories of space B only

#### Scenario: Space switch during a run

- **WHEN** the user switches from space A to space B while a cleanup job runs
- **THEN** the web app SHALL stop and drop the job, as a restart does
- **AND** neither space SHALL gain marks from that job
- **AND** Apply SHALL find no finished cleanup, so it changes no profile and no marks

#### Scenario: Stale marks are removed

- **WHEN** a marking run finds marks that match no memory of the profile
- **THEN** it SHALL delete those marks

### Requirement: The dialog uses marks only for the profile it shows

The dialog SHALL read the checked memories from the web app when it opens and when Back returns to the selection. The reply SHALL name the profile version it was built for. When that version differs from the version the dialog read when it opened, the dialog SHALL treat no memory as checked. A failed read SHALL do the same and SHALL NOT block the cleanup. Until the read answers, Clean All, Low Freq and Same Category SHALL be disabled with a tooltip that says why.

#### Scenario: The profile changed

- **WHEN** learning saved the profile after the page loaded, so the versions differ
- **THEN** no memory SHALL show as checked
- **AND** the shortcuts SHALL pick memories as if none were checked

#### Scenario: The read fails

- **WHEN** the read of the checked memories fails
- **THEN** the user SHALL still be able to select memories and run the cleanup

#### Scenario: The read has not answered

- **WHEN** the dialog opens and the read of the checked memories has not answered
- **THEN** Clean All, Low Freq and Same Category SHALL be disabled, and their tooltip SHALL say why
- **AND** Select All and Deselect All SHALL still work

#### Scenario: The profile reloads while the dialog is open

- **WHEN** a space switch reloads the profile while the dialog is open
- **THEN** the rows, the checked memories and Analyze SHALL all use the profile the dialog read when it opened

### Requirement: The dialog opens with nothing ticked

When the AI Cleanup dialog opens, it SHALL show every memory unticked and the selected count as 0. Analyze Selected SHALL warn that no item is selected until the user ticks one or chooses a shortcut. Stop and Back SHALL still return to the selection the job ran with.

#### Scenario: A fresh open

- **WHEN** the user opens the dialog on a profile with 2,000 memories
- **THEN** the count SHALL show 0 selected

#### Scenario: Stop keeps the selection

- **WHEN** the user stops a running cleanup
- **THEN** the dialog SHALL show the selection that the job ran with

### Requirement: Low Freq, Same Category and Clean All skip checked memories

Low Freq (≤3) SHALL pick the unchecked memories with a frequency of 3 or less. Same Category (3+) SHALL count every memory of a category, checked or not, toward the size of 3, and SHALL pick only the unchecked memories of every category that holds 3 or more memories. Clean All SHALL pick the memories that Low Freq or Same Category picks, combined, so it picks unchecked memories only. Deselect All SHALL clear the selection. A shortcut SHALL replace the current selection.

#### Scenario: Low Freq with checked memories

- **WHEN** 800 memories have a frequency of 3 or less and 500 of them are checked
- **THEN** Low Freq SHALL pick the other 300

#### Scenario: Same Category counts every memory of a category

- **WHEN** a category holds 5 memories and 3 are checked
- **THEN** Same Category SHALL pick the 2 unchecked memories of that category

#### Scenario: Same Category skips a small category

- **WHEN** a category holds 2 memories and neither is checked
- **THEN** Same Category SHALL NOT pick them

#### Scenario: Clean All combines the two rules

- **WHEN** 300 unchecked memories have a frequency of 3 or less, 200 other unchecked memories sit in categories of 3 or more, and the rest are checked or match neither rule
- **THEN** Clean All SHALL pick 500 memories

### Requirement: Select All picks every memory

The dialog SHALL keep a Select All button that picks every memory, checked or not, so the user can recheck the whole profile. Select All SHALL replace the current selection and SHALL NOT report skipped memories.

#### Scenario: A full recheck

- **WHEN** 2,000 memories exist and 1,250 are checked and the user selects Select All
- **THEN** 2,000 memories SHALL be selected

### Requirement: The dialog says how many checked memories a shortcut skipped

After Clean All, Low Freq or Same Category leaves out memories that its rule matches because they are checked, the dialog SHALL show a status line with that number. The line SHALL NOT show when that number is 0, or after Select All or Deselect All. The row of each checked memory SHALL carry a "Checked" word, so the state does not rely on colour alone.

#### Scenario: A skipped count

- **WHEN** Clean All leaves out 1,250 checked memories that its rules match
- **THEN** the status line SHALL say that 1,250 are already checked and skipped

#### Scenario: Nothing skipped

- **WHEN** no memory is checked
- **THEN** no skipped line SHALL show

### Requirement: Each shortcut explains itself in a tooltip

Each selection button (Clean All, Low Freq, Same Category, Select All and Deselect All) SHALL show a tooltip on hover and on keyboard focus that says what the button picks. The tooltip SHALL be linked to the button through `aria-describedby`.

#### Scenario: Hover on Clean All

- **WHEN** the user rests the pointer on Clean All
- **THEN** a tooltip SHALL say that it picks Low Freq plus Same Category, unchecked memories only

#### Scenario: Keyboard focus on Select All

- **WHEN** the user moves keyboard focus to Select All
- **THEN** a tooltip SHALL say that it picks every memory, including the checked ones, for a full recheck

### Requirement: The Checked label explains itself in a tooltip

The "Checked" label of a row SHALL show a tooltip on hover and on keyboard focus. The tooltip SHALL say that the AI already checked the memory and kept it, and that the memory is skipped unless its text or category changes.

#### Scenario: Hover on a Checked label

- **WHEN** the user rests the pointer on the "Checked" label of a row
- **THEN** a tooltip SHALL explain that the memory is skipped unless its text or category changes

### Requirement: New text exists in every language and mirrors in Arabic

Each new string of this change SHALL exist in English, Chinese and Arabic. The Arabic layout of the shortcut row, the status line, the "Checked" label and the tooltips SHALL mirror, with logical spacing classes, and the tooltips SHALL stay inside the screen.

#### Scenario: Arabic layout

- **WHEN** the language is Arabic and the dialog shows the shortcut row at 390 px width
- **THEN** the buttons and the status line SHALL read right to left
- **AND** no text SHALL be cut off or overlap
