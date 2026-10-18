## Purpose

Defines how the injected user profile block follows the prompt, so the preferences, patterns, and workflows shown are the ones that matter for it, without losing the general ones.

## ADDED Requirements

### Requirement: Part of each profile section follows the prompt

When memories are retrieved for a prompt, each profile section (preferences, patterns, workflows) SHALL fill half of its injected slots, rounded up, with the items closest in meaning to the prompt. The other slots SHALL keep the existing order. Closeness SHALL come from the vectors the items already hold. The number of injected items per section, the one-item-per-category rule, and the size budget SHALL stay as they are. An item below a minimum closeness SHALL NOT take a relevance slot.

#### Scenario: A prompt about packages

- **WHEN** the profile holds ten preferences and the prompt asks about package managers
- **THEN** the preference about the package manager SHALL be injected
- **AND** the injected preferences SHALL still include the items the existing order ranks first

#### Scenario: Unrelated prompt

- **WHEN** no item reaches the minimum closeness
- **THEN** the block SHALL equal the block the existing order gives

### Requirement: Items without vectors and missing vectors are handled

An item that holds no vector SHALL be considered only through the existing order. When the prompt vector is not available, the whole block SHALL use the existing order.

#### Scenario: Search failed

- **WHEN** the prompt could not be embedded
- **THEN** the profile block SHALL be the same as before this change

### Requirement: Session start and other callers are unchanged

Injection that has no prompt, such as the recent memories at session start, SHALL keep the existing order. The block SHALL keep its escaping and its `<user_profile>` wrapper.

#### Scenario: Session start

- **WHEN** recent memories are injected at the start of a session
- **THEN** the profile block SHALL use the existing order

### Requirement: Profile selection adds no model call and logs no prompt

Choosing profile items SHALL NOT call a model or an embedding service. The log SHALL NOT hold the prompt. The fields this change adds to the log SHALL be counts.

#### Scenario: Log line

- **WHEN** a profile block is built for a prompt
- **THEN** the log SHALL hold the number of relevance slots used and the number of items per section
- **AND** SHALL NOT hold the prompt
