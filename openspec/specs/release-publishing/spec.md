# release-publishing Specification

## Purpose

Defines how omms versions are cut and published to npm: who may publish, what every published version must contain, which checks gate a release, which channels exist, and how users install and update.

## Requirements

### Requirement: Only the release workflow can publish

After the first publish, new omms versions SHALL be published only by the repository's GitHub Actions release workflows, authenticated with npm trusted publishing (OIDC). The repository and its workflows SHALL NOT store or use a long-lived npm publish token. The npm package SHALL be configured to reject token-based publishing.

#### Scenario: A release is published

- **WHEN** a release workflow publishes a version
- **THEN** it SHALL authenticate through OIDC without an npm token secret
- **AND** the published version SHALL carry npm provenance linking it to the repository and workflow run

#### Scenario: A token publish is attempted

- **WHEN** anyone attempts to publish omms with an npm access token
- **THEN** the npm registry SHALL reject the publish

### Requirement: Full releases need the maintainer's approval

A full release SHALL be submitted to npm as a staged version and SHALL NOT become installable until the maintainer approves it with two-factor authentication. The release workflow's npm permission SHALL be limited to staging, so it cannot make a full release installable on its own.

#### Scenario: The release workflow finishes

- **WHEN** the release workflow submits version `X.Y.Z`
- **THEN** `X.Y.Z` SHALL appear as staged and SHALL NOT be installable by users
- **AND** the maintainer SHALL be able to find it and approve or reject it

#### Scenario: The maintainer approves

- **WHEN** the maintainer approves the staged version with 2FA
- **THEN** `X.Y.Z` SHALL become the `latest` version that users install and are notified about

#### Scenario: The release workflow tries to publish directly

- **WHEN** the release workflow attempts a direct (non-staged) publish
- **THEN** the npm registry SHALL reject it

### Requirement: Versions and changelog come from conventional commits

Release versions SHALL follow SemVer and SHALL be derived from conventional commit messages on `main`. The version bump, `CHANGELOG.md` entry, git tag, and GitHub Release SHALL be produced by the release automation, not edited by hand.

#### Scenario: Changes accumulate on main

- **WHEN** `feat:` or `fix:` commits land on `main`
- **THEN** a single open release pull request SHALL show the next version and the changelog entries for those commits

#### Scenario: The maintainer ships a release

- **WHEN** the maintainer merges the release pull request
- **THEN** the automation SHALL tag `vX.Y.Z`, create the GitHub Release, and start publishing that exact version

#### Scenario: A breaking change lands

- **WHEN** a commit marked as breaking (`!` or `BREAKING CHANGE:`) is on `main`
- **THEN** the proposed version SHALL be a major bump

### Requirement: A release is published only after the full gate passes

A version SHALL be published to npm only after the six-platform package smoke gate and the source validation pass for that commit. A failed gate SHALL publish nothing.

#### Scenario: One platform fails

- **WHEN** any platform in the package smoke gate fails for a release commit
- **THEN** no version SHALL be published to npm for that release

### Requirement: Every published version includes the web UI

Every version published to npm SHALL contain the built plugin entry points and the built web UI. Publishing SHALL fail if either is missing.

#### Scenario: The web UI build is missing

- **WHEN** a publish runs without a built web UI in the package
- **THEN** the publish SHALL fail before anything reaches the registry

#### Scenario: A user installs from npm

- **WHEN** the published tarball is installed into a clean project
- **THEN** it SHALL contain the web UI's `index.html` and assets
- **AND** the installed plugin's web server SHALL serve the web UI page

### Requirement: The latest channel only receives full releases

The npm `latest` dist-tag SHALL only point at versions produced by a merged release pull request. Any prerelease channel SHALL publish under a separate dist-tag with a SemVer prerelease version, and SHALL NOT move `latest`.

#### Scenario: A prerelease is published

- **WHEN** the `next` channel publishes a build of `main` that passed checks, without waiting for approval
- **THEN** it SHALL be tagged `next` with a prerelease version such as `X.Y.Z-next.N`
- **AND** a user installing `omms` without a tag or version SHALL still receive the latest full release

### Requirement: Users are told how to install and update

The README SHALL tell Pi and OpenCode v2 users how to install omms unpinned from npm and how to apply an update when their host reports one. It SHALL also say how to pin a version.

#### Scenario: A new user installs omms

- **WHEN** a user follows the README
- **THEN** they SHALL find `pi install npm:om-memory-system` for Pi and `opencode plugin add om-memory-system` for OpenCode v2
- **AND** they SHALL find `pi update` and `opencode plugin update` as the way to apply updates

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
