# web-theme-choice Specification

## Purpose

Let each user pick how the web app looks: follow the system or stay light or dark, and choose the light and the dark theme from a catalogue of palettes.

## Requirements

### Requirement: Users choose a theme mode and a light and a dark theme

The **Appearance** section SHALL have a **Theme** card with the modes System, Light and Dark, and a list of light themes and a list of dark themes. Each theme SHALL show its name and a swatch of its colours. The OMMS theme SHALL be the default of each list and SHALL look as the app looks today. A filter box SHALL narrow both lists by name. The list whose theme is on screen SHALL say so. A choice SHALL apply at once.

#### Scenario: Choosing a dark theme

- **WHEN** the mode is Dark and the user selects Catppuccin in the dark list
- **THEN** the whole web app SHALL use the Catppuccin dark colours at once

#### Scenario: System mode

- **WHEN** the mode is System, the light theme is GitHub, the dark theme is Nord, and the operating system switches to dark
- **THEN** the web app SHALL show the Nord dark colours

#### Scenario: Filter

- **WHEN** the user types `git` in the filter box
- **THEN** each list SHALL show only themes whose name contains `git`, ignoring case

### Requirement: The theme choice is kept per browser and shared with the sidebar button

The web app SHALL store the mode and the light and dark theme in the browser. The choice SHALL survive a reload. An unknown stored theme SHALL fall back to the OMMS theme. The sidebar theme button SHALL switch between Light and Dark and SHALL show the same mode as the Theme card. Every theme SHALL keep a visible focus ring in its accent colour.

#### Scenario: Reload

- **WHEN** the user chose Dark with the Gruvbox dark theme and reloads the page
- **THEN** the page SHALL open in Gruvbox dark

#### Scenario: The sidebar button

- **WHEN** the mode is System and the user selects the sidebar theme button
- **THEN** the mode SHALL become Light or Dark, the opposite of the current look
- **AND** the Theme card SHALL show that mode

#### Scenario: An unknown stored theme

- **WHEN** the stored dark theme id is not in the catalogue
- **THEN** the web app SHALL use the OMMS dark theme
