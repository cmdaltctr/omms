## ADDED Requirements

### Requirement: Pi reports an installed update only when the new copy is on disk

When the background update exits with success, the Pi adapter SHALL read the installed OMMS copy before it shows `· <version> installed, restart`. When the installed copy does not hold the new version, the adapter SHALL treat the update as failed: the footer label SHALL add `· <version> available` and one notification SHALL name `pi update npm:om-memory-system`.

#### Scenario: The update command changed nothing

- **WHEN** the background update for 4.3.0 exits with success and the installed copy still holds 4.2.0
- **THEN** the footer SHALL show `omms: ✔ · 4.3.0 available`
- **AND** one notification SHALL name `pi update npm:om-memory-system`
