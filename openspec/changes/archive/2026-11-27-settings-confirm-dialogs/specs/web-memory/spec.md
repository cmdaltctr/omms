## ADDED Requirements

### Requirement: Shared Memory page saves confirm first

On the shared Memory page these actions SHALL use the shared settings confirm dialog before they send a request: Save memory limits and each row's Reset to default, keyword mode, the reranker card's Save, profile learning Save, profile auto cleanup Save, catch-up Pause, and the directory maps Save removals and Restore. The dialog content, Cancel and page checks SHALL follow the Settings rules.

#### Scenario: Memory limits

- **WHEN** the user changes the maximum memories and selects **Save memory limits**
- **THEN** a confirm dialog lists the change and nothing is sent before the user confirms

#### Scenario: Reset one row

- **WHEN** the user selects **Reset to default** on the similarity threshold row
- **THEN** a confirm dialog shows the saved value and the default, and nothing is sent before the user confirms

#### Scenario: Reranker switch

- **WHEN** the user turns the reranker off and selects **Save**
- **THEN** a confirm dialog opens, and Cancel leaves the saved reranker settings unchanged

#### Scenario: Restore an ignored folder

- **WHEN** the user selects **Restore** on an ignored folder
- **THEN** a confirm dialog names the folder, and the folder stays ignored until the user confirms
