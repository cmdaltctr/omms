## ADDED Requirements

### Requirement: A real import shows a progress bar on the Sessions card

While a web import that is not a preview runs, the Sessions card SHALL show a progress bar for the active host. The bar SHALL show the host name, the phase (memory units or profile batches), and the done count out of the total. The values SHALL refresh without a page reload. A preview SHALL NOT show the bar.

#### Scenario: Memory extraction is running

- **WHEN** Pi is extracting memory units and 400 of 1,000 units are done
- **THEN** the card SHALL show a bar at 40% labelled with Pi, memory units, and 400 of 1,000

#### Scenario: Profile learning is running

- **WHEN** the active host is learning the profile and 2 of 4 batches are done
- **THEN** the bar SHALL show 50% labelled as profile batches, 2 of 4
- **AND** the memory-unit percentage SHALL NOT be shown as the group's progress

#### Scenario: A preview runs

- **WHEN** the user runs Preview (dry run)
- **THEN** the card SHALL NOT show the progress bar

### Requirement: The end of a real import is announced

When a real import ends while the user is on the page, the page SHALL open a dialog with the result and one OK button. A successful run SHALL say "Import successful 🎉" in English and show the imported and failed counts. A failed run SHALL name the host and the reason and say what to do next. A cancelled run SHALL show a neutral message and SHALL NOT open the dialog. After the user clicks OK, the page SHALL reload its import data without a full browser reload, and the user's selection and options SHALL stay. The 🎉 SHALL appear only in the English text.

#### Scenario: Import finishes on the page

- **WHEN** a real import reaches done while the user views the Memory page
- **THEN** a dialog SHALL open saying "Import successful 🎉" with the counts
- **AND** after OK the import data SHALL reload and the session list and selection SHALL stay

#### Scenario: Import fails on the page

- **WHEN** a real import reaches failed while the user views the Memory page
- **THEN** the dialog SHALL name the failing host and the reason and SHALL NOT say "successful"
- **AND** when memory units failed, the dialog SHALL show the failed count on its own line

#### Scenario: Another language

- **WHEN** the page language is not English
- **THEN** the success message SHALL be shown without the 🎉

#### Scenario: Cancelled run

- **WHEN** the user cancels a real import and it stops
- **THEN** the card SHALL show a neutral cancelled message and no dialog

### Requirement: A result that finished while the user was away is shown on return

If a real import ended while the Memory page was not open, the page SHALL show a banner with the result the next time it opens, until the user dismisses it. Dismissing SHALL be remembered for that run only. The banner SHALL NOT show for a preview.

#### Scenario: Returning after a run ended

- **WHEN** a real import finished while the user was on another page
- **THEN** opening the Memory page SHALL show a banner with the result and a dismiss control
- **AND** no dialog SHALL open

#### Scenario: Dismissed banner

- **WHEN** the user dismisses the banner for a run
- **THEN** it SHALL NOT show again for that run, and SHALL show for a later run
