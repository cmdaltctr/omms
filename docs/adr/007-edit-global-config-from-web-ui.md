# ADR-007: Edit the global config from the web UI

**Date:** 2026-09-27
**Status:** Proposed
**Deciders:** OMMS maintainers

## Context

OpenCode and Pi read one global JSONC config and optional project overrides. Users need to change host model and capture-diagnostic settings from the web UI. Their config may contain comments, credentials, and unrelated keys. A save from an open browser tab may race with a hand edit or another OMMS process. Legacy installs read a file that OMMS must leave untouched.

## Decision

The web server accepts only a fixed set of non-secret keys. It reads the current file and compares a content hash and file metadata against the revision last sent to the page. It uses `jsonc-parser` to change only requested values and validates the resulting config with the startup validator. It checks for a second change immediately before writing to a temporary file in the same directory and renaming it over the config.

If OMMS reads only the legacy `opencode-mem.jsonc`, the first page save copies the whole file to `~/.config/omms/omms.jsonc` and edits that copy. The legacy file stays unchanged. The server serialises its saves, rejects stale revisions with HTTP 409, and never accepts secret values through this page. Running hosts check file metadata before their next capture or profile-learning work unit and reload changed settings.

## Consequences

### Positive

- Comments, key order, credentials, and unrelated settings remain in place.
- Both hosts use saved settings on their next work unit without a restart.
- The page reports conflicts before overwriting an earlier change.

### Negative

- An external edit between the final file check and rename can still be lost.
- The server reads and validates a config file for each save.

### Neutral

- The first save on a legacy-only install creates a new preferred config file.

## Alternatives Considered

| Option                              | Rejected Because                                                                         |
| ----------------------------------- | ---------------------------------------------------------------------------------------- |
| Rewrite the whole file as JSON      | It removes comments and changes unrelated formatting.                                    |
| Write only new keys to a fresh file | It hides every other setting in a legacy config file.                                    |
| Use an operating-system lock alone  | Text editors do not take that lock when users save files.                                |
| Watch config files continuously     | A metadata check before each work unit is simpler and works across editor save patterns. |

## References

- [Settings page](../web-ui.md#settings-page)
- [Config writer](../../src/services/global-config-writer.ts)
- [OpenSpec design](../../openspec/changes/archive/2026-09-27-web-settings/design.md)
