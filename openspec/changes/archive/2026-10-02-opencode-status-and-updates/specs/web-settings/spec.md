# Spec Delta

## ADDED Requirements

### Requirement: Counts use singular wording and whole-number confidence

The Settings page SHALL say "1 session" for one session and "sessions" for any other number. The profile page SHALL show each confidence badge as a whole-number percentage.

#### Scenario: One session

- **WHEN** an unresolved directory has one session
- **THEN** the page SHALL show "1 session"

#### Scenario: Confidence with decimals

- **WHEN** an item's confidence is 0.969
- **THEN** the badge SHALL show "97%"
