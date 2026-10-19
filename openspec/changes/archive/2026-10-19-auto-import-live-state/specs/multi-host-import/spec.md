## MODIFIED Requirements

### Requirement: Children run sequentially in the server

The server SHALL run selected hosts in the order Pi, OpenCode, then Claude Code, omitting deselected hosts. It SHALL finish a child's memory and profile steps before starting the next. A browser reload or navigation away SHALL not start another child or stop the server-owned group. Groups and single-host jobs SHALL share the one-web-job slot. When the Memory page loads, it SHALL show the current job only while that job is queued, preparing, running or cancelling. A job that is done, failed or cancelled SHALL NOT be shown after a page load. A job that ends while the user is on the page SHALL stay visible until the page reloads.

#### Scenario: Waiting for the profile step

- **WHEN** Pi finishes memory extraction but its profile step still runs
- **THEN** OpenCode SHALL remain queued until Pi's profile step ends

#### Scenario: Navigating away and returning

- **WHEN** the user leaves Memory during a grouped import and later returns or reloads
- **THEN** the page SHALL show the current group and per-host progress
- **AND** it SHALL not resubmit the import

#### Scenario: Reloading after an import finished

- **WHEN** an import has finished and the user reloads Memory
- **THEN** the page SHALL NOT show the results panel, the counts line or the finished state of that import

#### Scenario: Staying on the page when an import ends

- **WHEN** an import ends while the user is on Memory
- **THEN** the results SHALL stay visible until the page reloads

#### Scenario: Starting a competing web job

- **WHEN** a grouped preview or import is running and a caller starts another grouped or single-host web job
- **THEN** the server SHALL refuse the second job with `409`
- **AND** the existing group SHALL keep running
