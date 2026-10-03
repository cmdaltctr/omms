# Spec Delta

## ADDED Requirements

### Requirement: Claude Code receives only versions published to npm

The Claude Code plugin SHALL reach users only at a version that the npm `latest` dist-tag names. The marketplace SHALL install the plugin from a ref that holds the release commit of that version, not from `main`. A merged release pull request whose npm publish fails, or that the maintainer has not approved, SHALL NOT change the plugin version Claude Code installs. After the maintainer approves a version on npm, Claude Code users with marketplace auto-update on SHALL receive it without another release. The ref SHALL move only to a commit that a `v<version>` release tag names, for a stable SemVer version. When it cannot do that, it SHALL stay where it is.

#### Scenario: A release fails to publish

- **WHEN** a release pull request for 4.5.0 merges, the release smoke fails, and npm `latest` stays at 4.4.1
- **THEN** Claude Code SHALL keep installing plugin 4.4.1
- **AND** the plugin launcher SHALL NOT ask npm for 4.5.0

#### Scenario: A release is approved

- **WHEN** the maintainer approves 4.5.0 on npm and npm `latest` becomes 4.5.0
- **THEN** within one hour, or at once when the maintainer dispatches the update, the plugin ref SHALL hold the commit tagged `v4.5.0`
- **AND** Claude Code with marketplace auto-update on SHALL install plugin 4.5.0 at its next update check

#### Scenario: A release is staged but not yet approved

- **WHEN** 4.5.0 is staged on npm and npm `latest` is still 4.4.1
- **THEN** the plugin ref SHALL stay on the commit tagged `v4.4.1`

#### Scenario: npm latest names a version with no release tag

- **WHEN** npm `latest` names a version for which no `v<version>` tag exists
- **THEN** the plugin ref SHALL NOT move
- **AND** the update run SHALL fail and name the missing tag

#### Scenario: npm cannot be reached

- **WHEN** the npm registry does not answer or returns no `latest` version
- **THEN** the plugin ref SHALL NOT move

#### Scenario: The maintainer moves npm latest back

- **WHEN** the maintainer points npm `latest` at an older stable version that has a release tag
- **THEN** the plugin ref SHALL move to that older release commit
- **AND** Claude Code SHALL install that version at its next update check
