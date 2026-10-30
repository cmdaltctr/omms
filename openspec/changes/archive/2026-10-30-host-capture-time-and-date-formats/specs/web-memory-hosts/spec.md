# Spec Delta

## MODIFIED Requirements

### Requirement: The Memory overview shows one card per host and a Shared card

`/memory` SHALL show four cards of equal size in this order: Pi, OpenCode, Claude Code and Shared. Each host card SHALL show the host's avatar, its name and one status line built from that host's import, backfill and live capture state. A host that is set up, not paused and not failed SHALL read `Running`, followed by the date of its last history import and the time of its last live save when each is known, for example `Running · history imported 19 Oct · last saved today 18:52`. A paused host SHALL read for example `Paused · 0 pending`. The Shared card SHALL say that its settings apply to every host. Activating a card SHALL open its view. Below the cards, an **Import all hosts** action SHALL open the multi-host import and SHALL say that it makes model calls that can cost money. On a viewport narrower than 640 px the cards SHALL form a two-column grid without horizontal scrolling.

#### Scenario: Opening the overview

- **WHEN** the user opens `/memory`
- **THEN** the page SHALL show the Pi, OpenCode, Claude Code and Shared cards in that order
- **AND** each host card SHALL show a status line for that host

#### Scenario: A host that finished its last run

- **WHEN** OpenCode is set up, not paused, not failed, and its last run ended with nothing pending
- **THEN** the OpenCode card SHALL read `Running` and SHALL show the date of the history import as a second detail, for example `history imported 19 Oct`
- **AND** the card SHALL NOT read only `Imported` with a date

#### Scenario: Opening a host from the overview

- **WHEN** the user activates the OpenCode card with a pointer or with Enter or Space
- **THEN** the page SHALL navigate to `/memory/opencode`

#### Scenario: Phone width

- **WHEN** the viewport is 390 px wide
- **THEN** the cards SHALL show as two rows of two
- **AND** the page SHALL NOT scroll horizontally

## ADDED Requirements

### Requirement: A host card shows the last live save

A running host card SHALL add `last saved` with the time of the host's newest live capture that saved a memory, read from the capture records OMMS already keeps. The time SHALL read `today` or `yesterday` with the time, or the date and time when older, in the user's date and time format. Only saved live captures SHALL count. The card SHALL read the time again at least once a minute.

#### Scenario: A save today

- **WHEN** Claude Code saved a live capture today at 18:52 and its history import ended on 18 Oct
- **THEN** the Claude Code card SHALL read `Running · history imported 18 Oct · last saved today 18:52`

#### Scenario: No live save in the kept records

- **WHEN** Pi has no saved live capture in the kept records
- **THEN** the Pi card SHALL NOT show a `last saved` part

#### Scenario: A host with live saves but no history import

- **WHEN** a host never ran a history import and saved a live capture yesterday at 09:05
- **THEN** its card SHALL read `Running · last saved yesterday 09:05`

#### Scenario: Only failed or skipped captures

- **WHEN** a host's newest live capture failed and its newest saved live capture was on 28 Oct at 17:45
- **THEN** its card SHALL show `last saved 28 Oct 17:45`
