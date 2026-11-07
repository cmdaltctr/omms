# Spec Delta

## MODIFIED Requirements

### Requirement: Card actions are a play button and icon buttons

A card SHALL have an Activate button with a play icon, and icon-only buttons to transfer, export, archive or unarchive, to back up and to delete, each with a tooltip that names the action. The active space SHALL have no Activate button. The page SHALL disable each action that the space does not allow, and the tooltip of a disabled button SHALL say why.

#### Scenario: Blocked actions explain themselves

- **WHEN** the user points at the delete button of Default
- **THEN** the button SHALL be disabled and its tooltip SHALL give the reason

#### Scenario: Activate a space

- **WHEN** the user chooses Activate on the card of `Client work`
- **THEN** `Client work` SHALL become the active space

#### Scenario: Transfer and export are present

- **WHEN** the user views the card of `Client work`
- **THEN** the card SHALL show a transfer button and an export button with tooltips
