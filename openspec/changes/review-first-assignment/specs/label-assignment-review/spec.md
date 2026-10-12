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

The first suggestion on the list SHALL be stored on the pending review item as `suggested_label`, and the full list SHALL be stored as its label options. No suggestion SHALL be written as the assignment outcome without a reviewer decision.

#### Scenario: A pending item with a suggestion

- **WHEN** a review item is created for a first assignment
- **THEN** the item SHALL carry `suggested_label` set to the first suggestion on its list
- **AND** the stored outcome SHALL remain unset until a reviewer decides

### Requirement: Review suggestions mix both sections

A review item SHALL list Clef's most likely labels from the observation's own section, up to the own-section count, then the labels from the other section whose reviewed observations are closest to the observation by cosine similarity, up to the other-section count, with no label listed twice. The defaults are three and two. The cosine step SHALL use the observation's stored embedding and SHALL NOT make an embedding or model call. Labels with a different embedding model from the observation's SHALL be left out of the cosine step. The reviewer MAY resolve the item with a label from either section.

#### Scenario: The default mixed list

- **WHEN** a review item is created and the decision model answers
- **THEN** the item SHALL list three own-section labels in Clef's probability order, then up to two other-section labels in cosine order
- **AND** SHALL mark each suggestion with its section

#### Scenario: Too few labels to fill a count

- **WHEN** a section has fewer eligible labels than its count asks for
- **THEN** the item SHALL list only the labels found for that section
- **AND** SHALL NOT fill the empty places with labels from the other section

#### Scenario: A label from the other section is chosen

- **WHEN** a reviewer resolves an item with a label from the other section
- **THEN** the system SHALL store that label as the outcome

### Requirement: Users choose the suggestion counts

The Settings page Memory card SHALL offer two whole-number settings: suggestions from the own section (default 3, from 1 to 10) and suggestions from the other section (default 2, from 0 to 10). The system SHALL refuse a value outside its range when saving. Changing a count SHALL NOT add a decision model call. A change SHALL apply to review items created after it and SHALL NOT rewrite items already in the queue.

#### Scenario: Own section only

- **WHEN** the own-section count is 5, the other-section count is 0, and a review item is created
- **THEN** the item SHALL list Clef's five most likely own-section labels
- **AND** SHALL list no other-section label

#### Scenario: Larger counts

- **WHEN** both counts are 10 and a review item is created
- **THEN** the item SHALL list up to ten own-section labels, then up to ten other-section labels
- **AND** the system SHALL make at most one decision model call for the item

#### Scenario: A value out of range

- **WHEN** a user saves an own-section count of 0 or a count above 10
- **THEN** the system SHALL refuse the value and keep the saved one

#### Scenario: Changing the setting

- **WHEN** a user changes the setting while items wait in the queue
- **THEN** the waiting items SHALL keep their stored suggestions

### Requirement: Users choose where the decision model runs

The Settings page SHALL offer a decision model setting with four values: local llama.cpp server (default), Cloudflare Workers AI, TypeSafe (Jev), and off. Hosted values SHALL be opt-in in the global config; a project config MAY switch to local or off but SHALL NOT switch to a hosted value. Keys SHALL be accepted as `env://` or `file://` references. Text sent to a hosted value SHALL have `<private>` content removed and secrets redacted first. The log SHALL record the provider, request size and outcome code, never the observation text or the reply.

#### Scenario: Local default

- **WHEN** a user has never changed the decision model setting
- **THEN** the system SHALL call the configured local llama.cpp server
- **AND** SHALL NOT send observation text to any hosted service

#### Scenario: A project config tries to turn on a hosted model

- **WHEN** a project config sets the decision model to Cloudflare or TypeSafe
- **THEN** the system SHALL ignore that value and keep the global setting

#### Scenario: A hosted model receives private text

- **WHEN** an observation contains `<private>` text and the decision model is hosted
- **THEN** the request SHALL NOT contain the private text

### Requirement: Capture never waits on the decision model

If the decision model is off, unreachable, refuses the request, exceeds its time limit, or is out of allowance, the system SHALL still create the review item, with cosine suggestions in place of Clef's: the closest own-section labels fill Clef's places, so the list keeps the shape of the chosen setting. A decision model failure SHALL NOT block capture or manual `memory` operations.

#### Scenario: The decision model is unreachable

- **WHEN** a review item is created and the decision model does not answer within its time limit
- **THEN** the item SHALL be created with cosine suggestions only, own-section labels first
- **AND** capture SHALL complete normally

#### Scenario: The decision model is off

- **WHEN** the decision model setting is off
- **THEN** the system SHALL make no decision model call
- **AND** the item SHALL be created with cosine suggestions only

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
