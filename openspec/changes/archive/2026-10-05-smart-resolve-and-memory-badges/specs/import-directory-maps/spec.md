# Spec Delta

## MODIFIED Requirements

### Requirement: Smart resolve fills in suggested targets

Each host card SHALL offer **Smart resolve directories** with a description of its review-and-confirm flow. Pressing it SHALL open a dialog showing that host's proposed source-to-target maps and session counts, using existing suggestion rules and preserving edited targets. It SHALL leave rows with no target unmapped. Opening the dialog SHALL change neither config nor page drafts. The user SHALL review the maps and press Confirm to save them, or Cancel to leave everything unchanged. Save maps SHALL remain available for manual selections.

#### Scenario: Resolving deleted worktrees

- **WHEN** the Pi card lists `/code/app-feat-x` and `/code/app-feat-y`, `/code/app` is a Git repository, and `/tmp/scratch` has no candidate
- **THEN** Smart resolve SHALL open a dialog showing `/code/app` as the target for both worktree directories and `/tmp/scratch` as unmapped
- **AND** the dialog SHALL show two proposed maps and their session counts
- **AND** `importPathMaps` and page selections SHALL remain unchanged until Confirm

#### Scenario: Keeping an edited target

- **WHEN** the user has edited a directory's target before opening Smart resolve
- **THEN** the dialog SHALL show that edited target rather than replacing it with the suggestion
- **AND** an explicitly cleared target SHALL remain unmapped

### Requirement: Suggestion actions explain when no work is done

The Smart resolve dialog SHALL report proposed maps and rows without targets, including already selected draft maps. When no map can be saved, it SHALL disable Confirm and explain that targets must be chosen first. Confirmation success SHALL report saved mappings and say they apply to the next import or backfill run. It SHALL NOT claim that sessions were imported or folders recreated.

#### Scenario: No suggested targets exist

- **WHEN** the user presses Smart resolve and no row has a suggested or edited non-empty target
- **THEN** the dialog SHALL say there are no maps to save and disable Confirm
- **AND** it SHALL explain that the user must choose targets for rows without suggestions

#### Scenario: Suggestions are already selected

- **WHEN** the user presses Smart resolve after selecting all suggested rows in the page draft
- **THEN** the dialog SHALL still show those source-to-target maps for review
- **AND** Confirm SHALL save them without requiring a later Save maps click

## ADDED Requirements

### Requirement: Confirmation saves only reviewed maps

Confirm SHALL save the reviewed maps with the same validation and revision checks as other settings saves. It SHALL retain existing saved maps and leave unrelated selections, target edits, and pending removals unchanged. A shared source SHALL have one global mapping. Confirmation SHALL NOT start an import or change history files.

#### Scenario: Saving reviewed mappings

- **WHEN** the user confirms a dialog containing valid proposed maps
- **THEN** those maps SHALL be saved in global `importPathMaps`
- **AND** the page SHALL refresh saved maps and unresolved rows without importing any sessions

#### Scenario: Keeping unrelated drafts

- **WHEN** the user confirms Pi maps while an unrelated OpenCode target edit and a saved-map removal are pending
- **THEN** only the reviewed Pi maps SHALL be saved
- **AND** the unrelated target edit and pending removal SHALL remain unsaved and visible

#### Scenario: Sharing a source across hosts

- **WHEN** a confirmed source directory appears in more than one host's list
- **THEN** its confirmed global map SHALL apply to every host
- **AND** refreshing SHALL NOT create duplicate saved maps for that source

### Requirement: Review remains safe on cancellation or failure

Cancel, Escape, and closing the dialog before confirmation SHALL change nothing. While saving, the page SHALL prevent duplicate submissions. A rejected save SHALL retain the reviewed maps and unrelated drafts, show an accessible error, and require another explicit confirmation. A failed refresh after a successful save SHALL be reported separately without claiming the save failed.

#### Scenario: Cancelling review

- **WHEN** the user opens Smart resolve and cancels, presses Escape, or closes the dialog before confirming
- **THEN** saved maps, pending removals, edited targets, and selections SHALL remain unchanged

#### Scenario: A save fails or settings changed elsewhere

- **WHEN** the save is rejected, including because the settings revision changed
- **THEN** the dialog SHALL remain available with its reviewed maps and an error
- **AND** it SHALL NOT overwrite newer settings or silently resubmit

#### Scenario: Confirm is pressed twice

- **WHEN** a confirmation save is pending and the user activates Confirm again
- **THEN** only one save request SHALL be submitted

#### Scenario: Refresh fails after saving

- **WHEN** the save succeeds but reloading the directory list fails
- **THEN** feedback SHALL say the mappings were saved and the list could not be refreshed
- **AND** the page SHALL offer a refresh without resubmitting the completed save

### Requirement: Every host has an accessible mapping review

Pi, OpenCode, and Claude Code SHALL use the same review-and-confirm flow. The dialog SHALL have a translated title and actions, trap keyboard focus, return focus on close, and keep long lists and paths usable at narrow widths and 200% zoom. It SHALL show paths and counts only, without conversation content.

#### Scenario: Reviewing each host

- **WHEN** the user opens Smart resolve for Pi, OpenCode, or Claude Code
- **THEN** the dialog SHALL show only the chosen host's proposed maps and explain that saved maps apply globally
- **AND** each host SHALL have the same confirmation, cancellation, and error behaviour

#### Scenario: Keyboard and translated review

- **WHEN** the dialog is used by keyboard in English, Chinese, or Arabic
- **THEN** its title and actions SHALL be translated and reachable without focus leaving the dialog
- **AND** long technical paths SHALL remain readable left-to-right, with focus returned to the opener after closing
