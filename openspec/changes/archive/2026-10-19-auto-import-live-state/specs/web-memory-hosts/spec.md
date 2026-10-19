## MODIFIED Requirements

### Requirement: The Memory overview shows one card per host and a Shared card

`/memory` SHALL show four cards of equal size in this order: Pi, OpenCode, Claude Code and Shared. Each host card SHALL show the host's avatar, its name and one status line built from that host's import and backfill state. A host that is set up, not paused and not failed SHALL read `Running`, with the date of its last import as a second detail, for example `Running · last import 9 Oct`. A paused host SHALL read for example `Paused · 0 pending`. The Shared card SHALL say that its settings apply to every host. Activating a card SHALL open its view. Below the cards, an **Import all hosts** action SHALL open the multi-host import and SHALL say that it makes model calls that can cost money. On a viewport narrower than 640 px the cards SHALL form a two-column grid without horizontal scrolling.

#### Scenario: Opening the overview

- **WHEN** the user opens `/memory`
- **THEN** the page SHALL show the Pi, OpenCode, Claude Code and Shared cards in that order
- **AND** each host card SHALL show a status line for that host

#### Scenario: A host that finished its last run

- **WHEN** OpenCode is set up, not paused, not failed, and its last run ended with nothing pending
- **THEN** the OpenCode card SHALL read `Running` and SHALL show the date of the last import as a second detail
- **AND** the card SHALL NOT read only `Imported` with a date

#### Scenario: Opening a host from the overview

- **WHEN** the user activates the OpenCode card with a pointer or with Enter or Space
- **THEN** the page SHALL navigate to `/memory/opencode`

#### Scenario: Phone width

- **WHEN** the viewport is 390 px wide
- **THEN** the cards SHALL show as two rows of two
- **AND** the page SHALL NOT scroll horizontally

### Requirement: The status header has one main action and explains it

A host view's status header SHALL show the state (running, paused, stopped, failed or not set up), the pending count, the last run time with its outcome, and the model in use. Automatic import runs all the time, so a host that is set up, not paused and not failed SHALL show the state **Running**, whether or not a run is in progress. The header SHALL show exactly one main action whose label follows the state: **Pause** while running, **Resume** while paused, **Retry** after a failure, and **Resume** after a run was cut short with exchanges still pending. The header SHALL NOT offer **Run now**. The state **Stopped** SHALL show only when a run was cut short. Under the action, one sentence SHALL say what the last run did or why the action is unavailable. When the action is unavailable because the backfill model needs the host open, the sentence SHALL say so and offer a control that switches that host's backfill model to the saved external API. The header SHALL say that running an import makes model calls.

#### Scenario: Running with nothing to import

- **WHEN** a host is set up, not paused and not failed, and its last run ended with nothing pending
- **THEN** the state SHALL read **Running** and the main action SHALL read **Pause**
- **AND** the sentence SHALL say that automatic import is on and nothing is waiting

#### Scenario: A host that never ran

- **WHEN** a host is set up, not paused and not failed, and no import has run yet
- **THEN** the state SHALL read **Running** and the main action SHALL read **Pause**

#### Scenario: Pausing an idle host

- **WHEN** the user selects **Pause** while no run is in progress
- **THEN** the paused flag SHALL be saved
- **AND** the state SHALL read **Paused** and the main action SHALL read **Resume**
- **AND** no automatic run SHALL start for that host until the user selects **Resume**

#### Scenario: Paused and blocked by the model choice

- **WHEN** OpenCode's backfill is paused and its backfill model is the live capture model while OpenCode is not open
- **THEN** **Resume** SHALL be unavailable
- **AND** the sentence SHALL say that the model runs only inside OpenCode and offer **Use external API**

#### Scenario: Run now with nothing to import

The scenario title is kept so the archive step can match it. **Run now** no longer exists; a run starts through **Resume**.

- **WHEN** the user selects **Resume** and the backfill finds no pending exchange before its cutoff
- **THEN** the sentence SHALL say that nothing was waiting before the cutoff date
- **AND** it SHALL point to the session list for newer chats

#### Scenario: A run cut short with exchanges pending

- **WHEN** a run was cut short and exchanges are still pending
- **THEN** the state SHALL read **Stopped** and the main action SHALL read **Resume**

#### Scenario: A failed run

- **WHEN** the last backfill run failed
- **THEN** the main action SHALL read **Retry**
- **AND** the sentence SHALL give the failure reason with any key redacted
