## ADDED Requirements

### Requirement: A workflow is a repeatable sequence of concrete steps

The profile analysis prompt SHALL define a workflow as a sequence of at least 3 concrete steps that the user repeats across tasks. The prompt SHALL tell the model not to describe the user's personality, style, or general habits as a workflow. The system SHALL drop an analysed workflow that has fewer than 3 non-empty steps before it is merged into the profile.

#### Scenario: A workflow with enough steps

- **WHEN** the model returns a workflow with 4 steps
- **THEN** the workflow SHALL be merged into the profile

#### Scenario: A workflow with too few steps

- **WHEN** the model returns a workflow with 2 steps
- **THEN** the workflow SHALL NOT be added to the profile
- **AND** the preferences and patterns of the same reply SHALL still be merged

### Requirement: A workflow merges only with a close match

A new workflow SHALL merge into an existing workflow only when their similarity is in the strong band. A weaker similarity SHALL create a separate workflow. A merge SHALL NOT fold other existing workflows into the matched one.

#### Scenario: A weak match

- **WHEN** a new workflow has a similarity below the strong threshold to every existing workflow
- **THEN** the profile SHALL gain one new workflow
- **AND** the frequency of every existing workflow SHALL stay the same

#### Scenario: A strong match

- **WHEN** a new workflow has a similarity at or above the strong threshold to one existing workflow
- **THEN** that workflow's frequency SHALL increase by 1
- **AND** no other workflow SHALL be removed or changed

### Requirement: A workflow keeps its own wording and steps

The system SHALL NOT rewrite a workflow description into a general description of the user's behaviour. A match SHALL NOT replace the steps of an existing workflow with a shorter list.

#### Scenario: A repeated workflow at a milestone frequency

- **WHEN** a workflow reaches a frequency that triggers a description rewrite for preferences and patterns
- **THEN** the workflow description SHALL stay unchanged

#### Scenario: A match with fewer steps

- **WHEN** a new workflow matches an existing workflow of 7 steps and has 4 steps
- **THEN** the existing workflow SHALL keep its 7 steps

### Requirement: A terminal profile run warms the embedding service first

A terminal history import that learns the profile, and the terminal `profile-catch-up` run, SHALL warm the embedding service before the first prompt batch. If the warm-up fails, the import SHALL still run and SHALL print a warning that names the reason. A dry run, an import that skips the profile, and a catch-up run that makes no model call SHALL NOT warm the service.

#### Scenario: A profile-only import

- **WHEN** a user runs a terminal history import with `--skip-memories`
- **THEN** the embedding service SHALL be warmed before the first prompt batch is analysed
- **AND** the findings of each batch SHALL be merged into the profile and not held in the cold buffer

#### Scenario: The warm-up fails

- **WHEN** the embedding server cannot be reached at the start of a terminal import
- **THEN** the import SHALL continue
- **AND** a warning SHALL name the reason

#### Scenario: A terminal catch-up run

- **WHEN** a user runs `profile-catch-up --yes`
- **THEN** the embedding service SHALL be warmed before the first backlog batch is analysed
