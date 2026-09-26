## Why

The repository starts a large multi-platform workflow matrix for ordinary package
and documentation changes. The checks use GitHub-hosted minutes while the
maintainer works on macOS and can run the same relevant checks locally.

## What Changes

- Make embedding-backend and platform-smoke workflows manual-only.
- Limit manual platform workflows to the Apple Silicon `macos-15` runner.
- Add a local macOS CI command and a pre-push hook.
- Add CI policy documentation that states the enabled and disabled checks.
- Add a local CI decision record under `docs/adr/` and ignore ADR files from Git.

## Capabilities

### New Capabilities

- `macos-local-ci`: Local macOS validation and intentionally limited GitHub workflow coverage.

### Modified Capabilities

- None.

## Impact

Affected areas include GitHub Actions workflows, Bun scripts, Husky hooks,
`.gitignore`, and CI documentation. The change does not alter plugin runtime
behaviour or published package APIs.
