# ADR-003: Publish on npm as om-memory-system with a fixed plugin id

**Date:** 2026-09-25
**Status:** Accepted
**Deciders:** Project maintainer

## Context

npm rejected `omms` as a package name under its similarity rules for short names such as `ms` and `os`. The fork still needs a name that people can install in OpenCode and Pi. OpenCode also reads the plugin id to scope its storage and disable rules. Changing the package name must not change that id or the product's existing configuration and data paths.

## Decision

Publish the unscoped npm package as `om-memory-system`. Keep the OpenCode plugin id fixed at `omms` in `src/plugin.ts`; OpenCode's `readPluginId` needs a non-empty id, not one matching the npm package name. Keep the product name, configuration files and data directory under `omms`.

An unscoped name supports the simple `npx om-memory-system` command and familiar plugin installation instructions. The id remains stable across package renames.

## Consequences

### Positive

- A public, unscoped package provides a short install command.
- Existing OpenCode plugin state and OMMS data retain their identity.

### Negative

- Package name and plugin id differ, so both must be documented.

### Neutral

- The npm package and product name appear separately in release material.

## Alternatives Considered

| Option                           | Rejected Because                                         |
| -------------------------------- | -------------------------------------------------------- |
| `@cmdaltctr/omms`                | Adds a scope to each install and terminal command.       |
| `omms-memory`                    | Repeats the short name that npm rejected for similarity. |
| `opencode-omms`                  | Names only one of the two supported hosts.               |
| Ask npm support to permit `omms` | Delays publication with an uncertain outcome.            |

## References

- [PR #11](https://github.com/cmdaltctr/omms/pull/11)
- `src/plugin.ts`
- OpenCode's `readPluginId` implementation
- `package.json`
