# Spec Delta

## ADDED Requirements

### Requirement: The page controls automatic import

The Settings page SHALL have an **Automatic import** section with a switch for `autoBackfill` and, for each host, a model choice for `opencodeBackfillModel` or `piBackfillModel`: **Same as live capture** (saves `inherit`) or a manual `provider/model` chosen the same way as the host's capture model. For each host the section SHALL show the backfill state, the counts of imported, skipped, failed, and pending exchanges, the number of sessions whose project cannot be resolved, the model used, the cutoff, and the last error. The counts SHALL refresh while a run is active. It SHALL say that a change takes effect at the host's next start, except that turning the switch off also stops a running backfill after its current exchange. It SHALL say that automatic import makes model calls.

#### Scenario: Turning automatic import off

- **WHEN** the user turns off the Automatic import switch and saves while a Pi backfill runs
- **THEN** the global config SHALL have `autoBackfill` set to `false`
- **AND** the Pi backfill SHALL stop after its current exchange

#### Scenario: Choosing a backfill model for Pi

- **WHEN** the user picks provider `zai` and model `glm-5-turbo` for Pi's backfill and saves
- **THEN** the global config SHALL have `piBackfillModel` set to `zai/glm-5-turbo`
- **AND** `piProvider` and `piModel` SHALL be unchanged

#### Scenario: Watching progress

- **WHEN** a backfill runs while the section is open
- **THEN** the counts SHALL update without a page reload

### Requirement: The page controls starting the web app at login

The Settings page SHALL have a **Web app** section with a switch for `webServerAutoStart`, the login item's status (installed, not installed, or unsupported on this platform), and the terminal commands that start the web app or manage the item. It SHALL say that the change applies at the next Pi or OpenCode start, or right away with `om-memory-system web install` or `web uninstall`.

#### Scenario: Turning off start at login

- **WHEN** the user turns off the switch and saves
- **THEN** the global config SHALL have `webServerAutoStart` set to `false`
- **AND** the section SHALL say that the item is removed at the next host start

#### Scenario: Viewing the item status

- **WHEN** the login item is installed
- **THEN** the section SHALL show it as installed
