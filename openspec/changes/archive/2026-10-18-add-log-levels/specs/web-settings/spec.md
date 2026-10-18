## MODIFIED Requirements

### Requirement: The page shows the OMMS log

The Settings page SHALL show the most recent records of the OMMS log file in a scrollable panel, newest last, reading at most the last 256 KB of the file. Each record SHALL show its time, a level badge and its message with data. The badge SHALL use the info colour for `info`, the warning colour for `warn` and the destructive colour for `error`, and SHALL show the level as text as well as colour. A guessed level SHALL say that it is guessed in its accessible name and tooltip.

The section SHALL offer level chips **All**, **Warning** and **Error**. **Warning** SHALL show `warn` and `error` records, and **Error** SHALL show `error` records only. It SHALL keep the filter that shows only `Capture attempt` records, and the filters SHALL combine. It SHALL show the full path of the log file with a copy action, and a copy action for the visible records.

While the section is on screen and not paused, it SHALL check for new records every 5 seconds. **Pause** SHALL stop the checks and freeze the shown records, and **Resume** SHALL start them again. The panel SHALL stay at the newest record while the user has not scrolled up, and SHALL stop following while the user reads older records.

The server SHALL return only records from the OMMS log file at its configured path, and SHALL NOT accept a path from the request.

#### Scenario: Viewing recent capture attempts

- **WHEN** the user opens the log section and turns on the capture attempts filter
- **THEN** the panel SHALL show the latest `Capture attempt` records, including their outcome and reason

#### Scenario: Showing only errors

- **WHEN** the user selects the **Error** chip
- **THEN** the panel SHALL show only records with the level `error`, each with a destructive-colour badge that reads `error`

#### Scenario: Pausing the log

- **WHEN** the user selects **Pause** and new lines reach the log file
- **THEN** the panel SHALL keep showing the same records until the user selects **Resume**

#### Scenario: Copying the visible records

- **WHEN** the user selects the copy action for the visible records with the **Error** chip on
- **THEN** the clipboard SHALL hold only the shown error records, one per line

#### Scenario: Copying the log path

- **WHEN** the user selects the copy action next to the log path
- **THEN** the full path of the log file SHALL be copied to the clipboard

#### Scenario: The log file does not exist yet

- **WHEN** the log file does not exist
- **THEN** the panel SHALL say that no log has been written yet and still show the path
