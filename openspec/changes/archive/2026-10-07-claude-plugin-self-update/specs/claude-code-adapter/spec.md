## ADDED Requirements

### Requirement: The Claude plugin updates itself when npm has a newer release

After the session-start hook has run, OMMS SHALL read the plugin version from `.claude-plugin/plugin.json` under `CLAUDE_PLUGIN_ROOT` and the npm `latest` version of `om-memory-system`. When npm has a newer release that is not a prerelease, OMMS SHALL start `claude plugin marketplace update omms` and then `claude plugin update omms@omms` in a detached process, and SHALL NOT wait for it. OMMS SHALL NOT start a second update for the same release within 30 minutes. When `OMMS_DISABLE_UPDATE_CHECK` is `1`, or `CLAUDE_PLUGIN_ROOT` is not set, OMMS SHALL NOT contact npm. A failure SHALL NOT change the hook's output or exit code. A started or failed start SHALL write one `Claude plugin self-update` log record with a code and the two versions.

#### Scenario: A release is approved before the session starts

- **WHEN** the plugin is 4.12.0 and npm `latest` is 4.13.0
- **THEN** a new session SHALL start the background plugin update
- **AND** the log SHALL hold a `Claude plugin self-update` record with code `started`

#### Scenario: The plugin is current

- **WHEN** the plugin and npm `latest` are both 4.13.0
- **THEN** OMMS SHALL NOT start an update

#### Scenario: Two sessions start close together

- **WHEN** a session started the update for 4.13.0 one minute ago and another session starts
- **THEN** the second session SHALL NOT start another update

#### Scenario: The check is turned off

- **WHEN** `OMMS_DISABLE_UPDATE_CHECK` is `1`
- **THEN** OMMS SHALL NOT contact npm and SHALL NOT start an update
