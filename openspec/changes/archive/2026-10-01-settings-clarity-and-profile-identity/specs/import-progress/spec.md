# Spec Delta

## ADDED Requirements

### Requirement: The profile step of a run is shown as its own phase

When every exchange of a running import is done and the run is still learning the profile from imported prompts, the run record SHALL say so, and the Settings page SHALL show **Learning profile** with the number of profile batches done out of the total in place of the exchange progress bar. When the profile step ends, the run SHALL be recorded as done or failed as before.

#### Scenario: Profile step after the last exchange

- **WHEN** a Claude Code run has finished 6 of 6 exchanges and is on profile batch 2 of 3
- **THEN** the page SHALL show Learning profile, 2 of 3
- **AND** SHALL NOT show a full exchange progress bar

#### Scenario: Profile step ends

- **WHEN** the last profile batch of that run finishes
- **THEN** the run SHALL be recorded as done and the page SHALL show the last run summary
