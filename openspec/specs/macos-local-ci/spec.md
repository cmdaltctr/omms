# macos-local-ci Specification

## Purpose

Defines local macOS validation and limited GitHub workflow coverage for OMMS changes.

## Requirements

### Requirement: Local macOS CI gate

The project SHALL provide one command that validates formatting, linting,
type safety, unit tests, and production build artefacts on macOS.

#### Scenario: Local validation succeeds

- **WHEN** a maintainer runs the local CI command on a prepared macOS checkout
- **THEN** it SHALL exit successfully only after every configured validation passes

### Requirement: Pre-push validation

The project SHALL run the deterministic local checks (formatting, linting,
type checking) before Git pushes.

#### Scenario: Validation failure blocks a push

- **WHEN** any local CI validation fails during a push
- **THEN** the Git hook SHALL return a non-zero exit status and block the push

### Requirement: Manual platform verification

The embedding and package-smoke workflows SHALL run only through manual
dispatch on the Apple Silicon `macos-15` GitHub runner.

#### Scenario: Ordinary pull request

- **WHEN** a pull request changes repository files
- **THEN** the manual platform workflows SHALL not start automatically

#### Scenario: Maintainer dispatches verification

- **WHEN** a maintainer manually dispatches a platform workflow
- **THEN** it SHALL run its checks on `macos-15`

### Requirement: Published CI policy

The project SHALL document local checks, automatic GitHub checks, manual
GitHub checks, and intentionally disabled platform coverage.

#### Scenario: Maintainer reads CI policy

- **WHEN** a maintainer opens the CI policy document
- **THEN** it SHALL state the enabled and disabled validation environments
