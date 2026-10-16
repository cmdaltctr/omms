## ADDED Requirements

### Requirement: A profile save never overwrites a newer version

Every save of a stored profile SHALL carry the version that the writer read. The save SHALL fail without changes when the stored version differs. This SHALL hold for every host, every learning path, background steps and user actions. A background step whose save fails SHALL skip that save and log an outcome code. A user action whose save fails SHALL report that the profile changed and ask the user to try again.

#### Scenario: Two writers read the same version

- **WHEN** two writers read profile version 40 and both try to save
- **THEN** the first save SHALL store version 41
- **AND** the second save SHALL fail and leave version 41 unchanged

#### Scenario: Confidence decay meets a newer version

- **WHEN** confidence decay reads version 40 and another writer saves version 41 before decay saves
- **THEN** decay SHALL NOT save
- **AND** the log SHALL record an outcome code without profile content

#### Scenario: A web edit meets a newer version

- **WHEN** a user edits a profile item in the web app and learning saves a new version first
- **THEN** the edit SHALL fail with a message to try again
- **AND** the stored profile SHALL keep the version that learning wrote

### Requirement: Learning merges again after a save conflict

When a learning save fails because the stored version changed, learning SHALL load the stored profile, merge the same analysis result into it, and save again with the new version. It SHALL NOT call the analysis model again. It SHALL make at most three save attempts. When all three fail, the profile SHALL stay unchanged and the analysed prompts SHALL stay unanalysed for a later run. Claude Code, Pi, OpenCode and the backlog catch-up SHALL behave the same.

#### Scenario: A category cleanup lands during learning

- **WHEN** learning reads the profile, a category cleanup renames 510 items, and learning then saves
- **THEN** the first learning save SHALL fail
- **AND** learning SHALL merge its result into the cleaned profile and save it
- **AND** the 510 items SHALL keep their new categories

#### Scenario: No second model call

- **WHEN** a learning save fails once and the second attempt succeeds
- **THEN** the analysis model SHALL have been called once for that batch

#### Scenario: Every attempt fails

- **WHEN** three learning save attempts in a row meet a newer version
- **THEN** learning SHALL stop without saving
- **AND** the prompts in that batch SHALL NOT be marked as analysed
