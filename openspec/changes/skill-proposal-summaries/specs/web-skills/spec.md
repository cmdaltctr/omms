# Spec Delta

## MODIFIED Requirements

### Requirement: Proposals show a diff with actions

The page SHALL list proposals with their state: pending, applied, applied automatically, rejected, stale or undone. A pending proposal SHALL show a line diff, the summary and its evidence turns, with **Apply** and **Reject**. An applied proposal SHALL offer **Undo**. The page SHALL load the content, the diff and the evidence turns of a proposal when its card opens, not with the list.

#### Scenario: Apply from the page

- **WHEN** the user selects **Apply** on a pending proposal
- **THEN** the proposal SHALL show `applied` and offer **Undo**

#### Scenario: Show more loads the full proposal

- **WHEN** the user selects **Show more** on a compact proposal card
- **THEN** the page SHALL request that proposal by its id
- **AND** the card SHALL show the full line diff, or the content of a new skill, and the evidence turns

#### Scenario: The compact card uses the list counts

- **WHEN** the Skills page shows a compact proposal card
- **THEN** the line chip SHALL show the `added` and `removed` counts from the list
- **AND** the page SHALL NOT have requested the content or the diff of that proposal

#### Scenario: The full proposal cannot load

- **WHEN** the user selects **Show more** and the request for the proposal fails
- **THEN** the card SHALL say that the proposal could not be loaded and SHALL keep **Apply** and **Reject** available
