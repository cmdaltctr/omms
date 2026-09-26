## Why

The public repository still uses the former OpenCode-specific name and description. This obscures OMMS as the independent package and product identity before its first npm release.

## What Changes

- Rename the GitHub repository from `cmdaltctr/opencode-mem` to `cmdaltctr/omms`.
- Set the GitHub description to `OMMS - Opinionated Modular Memory System`.
- Update package metadata, repository links, badges, documentation, and web asset names that identify the old repository.
- Update local Git remotes after the GitHub rename.

## Capabilities

No spec-level behaviour changes. This change uses `skip_specs: true`.

## Impact

GitHub repository settings, package registry metadata, release links, documentation, the built web asset path, and local clone remotes.
