## MODIFIED Requirements

### Requirement: Every host records turns the same way

Pi, OpenCode V2 and Claude Code SHALL record a turn when it ends, through shared code, with the same fields. Each host reader SHALL give each tool call an outcome of `ok`, `error` or `unknown`, and an error text of at most 2,000 characters when the host reports one.

#### Scenario: Same turn on each host

- **WHEN** recording is on and the same prompt runs a failing tool call on Pi, OpenCode and Claude Code
- **THEN** each host SHALL record one turn whose failing call has outcome `error`

#### Scenario: A host gives no outcome

- **WHEN** a host reports a tool call without a result
- **THEN** the call SHALL be recorded with outcome `unknown`
