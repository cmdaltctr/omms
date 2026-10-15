## ADDED Requirements

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
