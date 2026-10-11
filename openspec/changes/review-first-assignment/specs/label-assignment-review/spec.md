# label-assignment-review Specification

## ADDED Requirements

### Requirement: First assignment of a label routes to review

When an observation receives a label assignment for the first time and no human-reviewed assignment matches it after the existing duplicate and conflict checks, the system SHALL route the case to the review queue instead of storing the label as a reuse.

#### Scenario: A new observation with no reviewed match

- **WHEN** capture produces an observation whose closest existing assignment was never reviewed
- **THEN** the system SHALL create a pending review item
- **AND** SHALL NOT store a label reuse for that observation

#### Scenario: A repeat of a reviewed assignment

- **WHEN** capture produces an observation that matches an assignment whose review outcome is `label:<id>` or `none_fit`
- **THEN** the system SHALL reuse that outcome automatically
- **AND** SHALL NOT create a review item

#### Scenario: A conflict on reuse

- **WHEN** a would-be reuse fails the existing conflict check
- **THEN** the system SHALL route the case back to review

### Requirement: Suggestions are never outcomes

The classifier's candidate label SHALL be stored on the pending review item as `suggested_label` and SHALL NOT be written as the assignment outcome without a reviewer decision.

#### Scenario: A pending item with a suggestion

- **WHEN** a review item is created for a first assignment
- **THEN** the item SHALL carry `suggested_label` from the classifier
- **AND** the stored outcome SHALL remain unset until a reviewer decides

### Requirement: Review outcomes are explicit

A reviewer SHALL resolve a pending item with exactly one outcome: a label ID, `none_fit`, or `uncertain`. The record SHALL store the outcome, the reviewer identity and a timestamp. `uncertain` SHALL leave the item pending.

#### Scenario: An uncertain resolution

- **WHEN** a reviewer resolves an item as `uncertain`
- **THEN** the item SHALL remain pending in the queue
- **AND** no assignment outcome SHALL be stored

### Requirement: Review routing is host-neutral

The routing rule SHALL live in the shared core. Host adapters SHALL NOT implement their own first-assignment routing, and every host SHALL produce identical routing behaviour for identical capture input.

#### Scenario: Two hosts, one rule

- **WHEN** the same observation is captured on two different hosts
- **THEN** both SHALL produce a pending review item through the shared core
- **AND** neither host adapter SHALL contain assignment-routing logic
