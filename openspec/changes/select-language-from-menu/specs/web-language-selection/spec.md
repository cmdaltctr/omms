# Spec Delta

## Purpose

Let web UI users inspect the available languages and select one deliberately from a compact sidebar control.

## ADDED Requirements

### Requirement: Sidebar language control shows the current code

The sidebar footer SHALL display the current language as EN, ZH, or AR, without a visible "Language" caption. The control SHALL retain an accessible name describing its purpose and current language.

#### Scenario: Current language is English

- **WHEN** the web UI is set to English
- **THEN** the sidebar control SHALL show EN and remain identifiable to assistive technology as a language selector

#### Scenario: Current language changes

- **WHEN** the user selects Arabic
- **THEN** the sidebar control SHALL show AR

### Requirement: User explicitly selects a language from a menu

Activating the control SHALL show a menu listing English, Chinese, and Arabic with their codes. Opening or closing the menu SHALL NOT change the language. The menu SHALL indicate the current choice. Selecting a language SHALL apply it, save the preference, and close the menu. The menu SHALL be usable by pointer and keyboard on desktop and mobile, including right-to-left layout.

#### Scenario: Opening the language menu

- **WHEN** the user activates the control while English is selected
- **THEN** the menu SHALL list English (EN), Chinese (ZH), and Arabic (AR), with English indicated as current
- **AND** the page SHALL stay in English

#### Scenario: Selecting another language

- **WHEN** the user selects Chinese from the open menu
- **THEN** the page SHALL use Chinese and the control SHALL show ZH
- **AND** the selection SHALL persist after a reload

#### Scenario: Dismissing without a selection

- **WHEN** the user presses Escape or dismisses the menu outside it
- **THEN** the menu SHALL close and the current language SHALL remain unchanged
