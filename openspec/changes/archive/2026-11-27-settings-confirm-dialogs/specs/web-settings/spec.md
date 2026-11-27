## ADDED Requirements

### Requirement: Settings saves confirm before sending

Every action on the Settings and Memory pages that writes a setting or starts or stops a settings job SHALL open the shared settings confirm dialog first. The page SHALL send no request until the user confirms. The dialog SHALL show progress while the request runs, show a server error inside itself and stay open, and close on success. The confirmed request SHALL have the same body as it had before this rule.

#### Scenario: Save button

- **WHEN** the user changes the web app autostart box and selects **Save**
- **THEN** a confirm dialog opens and no request is sent

#### Scenario: Confirm

- **WHEN** the user selects the confirm button in that dialog
- **THEN** the page sends `webServerAutoStart` as before, shows progress, and closes the dialog when the save succeeds

#### Scenario: Server refusal

- **WHEN** the server refuses a confirmed save
- **THEN** the dialog shows the server's reason and stays open

### Requirement: Cancel and page checks

**Cancel** SHALL send nothing. A control that saves on change, such as a select, switch or checkbox, SHALL show its saved value again after Cancel. Text the user typed in a form SHALL stay as a draft after Cancel. A value that breaks a rule the page checks SHALL show its message on the page, and no dialog SHALL open.

#### Scenario: Cancel a select

- **WHEN** the user picks a new summary language and then selects **Cancel**
- **THEN** nothing is saved and the select shows the saved language

#### Scenario: Cancel a form

- **WHEN** the user types a Claude Code folder, selects **Save folder** and then **Cancel**
- **THEN** nothing is saved and the typed folder stays in the box

#### Scenario: Invalid value

- **WHEN** the user enters an interval outside its range and selects **Save**
- **THEN** the page shows the range message and no dialog opens

### Requirement: The dialog lists the changes

The dialog SHALL name the card and list each setting the save changes, with its saved value and its new value in plain words. A reset to default SHALL show the default as the new value. A job action SHALL say in one sentence what the job does, for example that a retry calls the model again.

#### Scenario: Two settings change

- **WHEN** the user turns off automatic capture, picks a new default scope and selects **Save**
- **THEN** the dialog lists both settings, each with its old and new value

#### Scenario: Job action

- **WHEN** the user selects **Retry now** for a host
- **THEN** the dialog says the waiting captures will be sent to the model again

### Requirement: Settings page cards confirm every save

On the Settings page these actions SHALL confirm first: the host model Save, the summary language, the Claude Code folder, web app autostart, Memory basics, the two Skill learning switches, Record past turns, Save password, Clear password, Generate token, the embedding Retry, capture Retry now, capture retention, the reasoning level, the external API Save, OpenRouter routing and memory cleanup. Each card's own special dialogs SHALL stay.

#### Scenario: External API turned off

- **WHEN** the user empties the external API URL and selects **Save settings**
- **THEN** a confirm dialog says the external API will be turned off, and nothing is sent before the user confirms

#### Scenario: Turn off redaction

- **WHEN** the user turns off "Remove private text and secrets"
- **THEN** the shared confirm dialog opens in place of the inline warning, and Cancel leaves redaction on

#### Scenario: Memory cleanup turned off

- **WHEN** the user turns off memory cleanup and selects **Save**
- **THEN** a confirm dialog opens, although turning it off deletes nothing

## MODIFIED Requirements

### Requirement: Every settings card saves the same way

Each settings card with a server SHALL test the values in the form, not the saved values. Each card SHALL save with a Save button, not on leaving a field, SHALL confirm with the shared settings confirm dialog before it saves, and SHALL show a plain message after each test and save. A Save that tests first SHALL test, then confirm; when the test cannot reach the server, the existing Save anyway dialog SHALL be the confirmation.

#### Scenario: Testing an unsaved model

- **WHEN** the user types a new model on the External API card and selects Test without saving
- **THEN** the test call SHALL use the typed model

#### Scenario: Clearing the API URL

- **WHEN** the user empties the API URL, saves and confirms
- **THEN** `memoryApiUrl` SHALL be removed from the global config

#### Scenario: A URL without a scheme

- **WHEN** the user saves `api.example.com/v1` as the API URL
- **THEN** the save SHALL be refused with a message that the URL must start with `http://` or `https://`

#### Scenario: An invalid number

- **WHEN** the user enters a value that is not a valid number in a number field and selects Save
- **THEN** a message SHALL show next to the field, and no confirm dialog SHALL open

### Requirement: The page controls automatic import

Each host view on the Memory page SHALL have a settings card with the **Import past chats automatically** switch for `autoBackfill`, which applies to every host, and, for Pi and OpenCode, a backfill model choice for `piBackfillModel` or `opencodeBackfillModel`: **Same as live capture** (saves `inherit`), **External API** (saves `external`), or a manual `provider/model`. Claude Code's backfill always uses the external API. The host view's status header SHALL show the backfill state, including paused and off, the counts of imported, skipped, failed, and pending exchanges, the number of sessions whose project cannot be resolved with a link to that host's list of sessions that need a folder, the model used, the cutoff, the last error, and the progress bar, percentage, and time left defined by the import progress capability. It SHALL offer Pause, Resume and Retry as the import progress capability defines. The counts SHALL refresh while a run is active. The settings card SHALL say that a model change takes effect at the next run, except that turning the switch off also stops a running automatic backfill after its current exchange. It SHALL say that automatic import makes model calls. Turning the switch on SHALL open the same confirm dialog as **Turn on** in the status header, and only its **Turn on** SHALL save; turning the switch off SHALL save at once with no dialog.

#### Scenario: Turning automatic import off

- **WHEN** the user turns off the switch while an automatic Pi backfill runs, and confirms
- **THEN** the global config SHALL have `autoBackfill` set to `false`
- **AND** the Pi backfill SHALL stop after its current exchange
- **AND** the Pi status header SHALL read **Off** once the run has stopped

#### Scenario: Choosing a backfill model for Pi

- **WHEN** the user picks provider `zai` and model `glm-5-turbo` for Pi's backfill and saves
- **THEN** the global config SHALL have `piBackfillModel` set to `zai/glm-5-turbo`
- **AND** `piProvider` and `piModel` SHALL be unchanged

#### Scenario: Choosing the external API for OpenCode's backfill

- **WHEN** the user chooses External API for OpenCode's backfill and saves
- **THEN** the global config SHALL have `opencodeBackfillModel` set to `external`

#### Scenario: Watching progress

- **WHEN** a backfill runs while the host view is open
- **THEN** the counts, progress bar, percentage, and time left SHALL update without a page reload

#### Scenario: Opening the section with no active run

The scenario title is kept so the archive step can match it. The Automatic import section and its host cards no longer exist; each host view holds one host.

- **WHEN** no host has a running or paused run and the user opens `/memory/pi`
- **THEN** the status header SHALL show Pi's state, pending exchanges, and unresolved sessions

#### Scenario: A run is active

- **WHEN** a Pi backfill is running and the user opens `/memory/pi`
- **THEN** the status header SHALL show the progress bar, percentage and time left

#### Scenario: Keeping a card's state during refresh

The scenario title is kept so the archive step can match it.

- **WHEN** the counts refresh while the user edits Pi's backfill model choice
- **THEN** the unsaved model choice SHALL stay

#### Scenario: Reading automatic import without duplicate pills

The scenario title is kept so the archive step can match it.

- **WHEN** the user opens `/memory/opencode`
- **THEN** the status header SHALL show the host name without an overall import-status pill
- **AND** it SHALL keep its operational state and its one main action

#### Scenario: Following the automatic import directory link

- **WHEN** the user activates OpenCode's unresolved-directory link in the status header
- **THEN** OpenCode's list of sessions that need a folder SHALL open and its summary SHALL receive focus
- **AND** other hosts' drafts and disclosure states SHALL remain unchanged
