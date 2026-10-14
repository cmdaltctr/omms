## ADDED Requirements

### Requirement: Injected memories carry their ids

Each memory that OMMS adds to a session's context SHALL carry its memory id beside its relevance: `<memory id="<id>" relevance="<N>%">`. Pi, OpenCode and Claude Code SHALL use the same format. Adding the id SHALL keep the context within the same size budget, so a section that is full SHALL hold fewer memories rather than grow.

#### Scenario: A prompt's recall

- **WHEN** OMMS adds matching memories for a prompt in any host
- **THEN** each memory in the section SHALL show its id and its relevance

#### Scenario: Forgetting a recalled memory

- **WHEN** the agent wants to remove a memory that it read in the injected context
- **THEN** it SHALL be able to pass that memory's id to the `memory` tool's `forget` mode with no search first
