# Spec Delta

## MODIFIED Requirements

### Requirement: OpenCode behavior remains a compatibility surface

The OpenCode V1 entry SHALL keep its current plugin behavior. The OpenCode v2 entry SHALL reach the same shared memory behavior through native v2 hooks, and it MAY diverge from V1 where the v2 host offers a native surface (per-prompt retrieval, compaction hooks, sessionless structured output).

#### Scenario: OpenCode v2 invokes the memory plugin after extraction

- **WHEN** the v2 adapter handles a v2 lifecycle hook or tool call
- **THEN** the request SHALL reach the shared memory behavior
- **AND** the memory tool's operations and results SHALL match the V1 tool for the same arguments

#### Scenario: OpenCode V1 is unchanged

- **WHEN** the package is loaded through the V1 `server` entry
- **THEN** first-message injection (`chatMessage.injectOn`), idle capture, and post-compaction restore SHALL behave as before this change
