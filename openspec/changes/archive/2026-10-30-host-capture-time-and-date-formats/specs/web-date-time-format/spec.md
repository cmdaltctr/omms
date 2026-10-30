# Spec Delta

## Purpose

Let each user choose how the web app shows dates and times, including a 24-hour clock, so every timestamp reads the way they expect.

## ADDED Requirements

### Requirement: Users choose a date format and a time format

The **Appearance** settings section SHALL have a **Date and time** part with a date format with the options Automatic, `30 Oct 2026`, `Oct 30, 2026` and `2026-10-30`, and a time format with the options Automatic, 24-hour (`18:52`) and 12-hour (`6:52 PM`). Automatic SHALL follow the page language, and for English the browser's own English variant. Each option SHALL show an example, and a change SHALL apply at once.

#### Scenario: Choosing a 24-hour clock

- **WHEN** the user selects the 24-hour time format
- **THEN** every time shown in the web app SHALL use a 24-hour clock, for example `17:43`
- **AND** no reload SHALL be needed

#### Scenario: Automatic

- **WHEN** both formats are Automatic, the page language is English and the browser language is `en-GB`
- **THEN** a date and time SHALL read in British English order, for example `28 Oct 2026, 17:43`

### Requirement: The choice is kept per browser

The web app SHALL store the date and time format choice in the browser, as it stores the page language and theme. The choice SHALL survive a reload. When the stored value is missing or unknown, the web app SHALL use Automatic. The choice SHALL NOT be written to the OMMS config.

#### Scenario: Reload

- **WHEN** the user chose `2026-10-30` and the 24-hour clock and then reloads the page
- **THEN** dates SHALL still show as `2026-10-30` with a 24-hour time

#### Scenario: Unknown stored value

- **WHEN** the stored time format is a value the web app does not know
- **THEN** the web app SHALL use Automatic

### Requirement: Every date and time in the web app follows the choice

Memory cards, prompt cards, the profile page, the profile history, chat sources, host cards, host run details, the sessions list, capture diagnostics, the profiles table and the API keys table SHALL format their dates and times with the user's choice. Text inside memories and prompts SHALL NOT be changed.

#### Scenario: A prompt card

- **WHEN** the user chose `30 Oct 2026` and the 24-hour clock, and a prompt was saved on 28 Oct 2026 at 5:43 PM
- **THEN** the prompt card SHALL show `28 Oct 2026, 17:43`
