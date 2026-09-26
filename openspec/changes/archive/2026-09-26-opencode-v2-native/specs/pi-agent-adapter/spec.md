# Spec Delta

## MODIFIED Requirements

### Requirement: Memory injection does not impersonate the user

The Pi adapter SHALL add retrieved memory as a named structured system-prompt section delimited by an `omms-retrieval` tag, or through an equivalent supported pre-agent context surface. The section content SHALL be produced by the same shared retrieval used by OpenCode v2.

#### Scenario: Memory context is injected

- **WHEN** the adapter adds retrieved memory at `before_agent_start`
- **THEN** it SHALL NOT create a fake user message
- **AND** it SHOULD NOT replace the complete system prompt when a structured section can express the same context
- **AND** the section SHALL be delimited by `<omms-retrieval>` and `</omms-retrieval>`
