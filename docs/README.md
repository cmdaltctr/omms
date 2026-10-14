# Documentation

The [project README](../README.md#documentation) lists the user and developer guides. This page indexes every guide in `docs/`.

## Using OMMS

- [Using memory](using-memory.md) explains capture, retrieval and profile learning.
- [Configuration](configuration.md) covers config files, model selection, privacy and embeddings.
- [CLI reference](cli.md) lists the terminal commands.
- [Updating and upgrading](upgrading.md) covers updates, version pinning and older stores.
- [Moving projects](moving-projects.md) covers folder moves, backup and restore.
- [Migration from opencode-mem](omms-migration.md) is the guide for existing `opencode-mem` users.

## Web UI

- [Web UI](web-ui.md) covers app startup, navigation and access.
- [Memory page](web-ui-memory.md) covers reviewed history imports, grouped results, profile actions, limits and missing folders.
- [Settings page](web-ui-settings.md) covers models, access, diagnostics and profile identity controls.

## Hosts

- [OpenCode adapter](opencode-adapter.md) covers the OpenCode plugin.
- [Pi adapter](pi-adapter.md) covers the Pi extension.
- [Claude Code adapter](claude-code-adapter.md) covers the Claude Code plugin and hooks.
- History imports: [OpenCode](opencode-history-import.md), [Pi](pi-history-import.md) and [Claude Code](claude-code-history-import.md).

## Development

- [For developers](developers.md) covers building, testing and architecture. Its [web history import API](developers.md#web-history-import-api) section documents the additive grouped import contract.
- [Shared memory core boundary](shared-core.md) sets out the layers between the shared engine and the host adapters. Read it before you change a port or move code between layers.
- [Continuous integration](ci.md) covers the local checks, the GitHub workflows and the release steps. Read it before you change a workflow, hook, test runner or release step.

## Decision records

- [ADR index](adr/ADR_README.md) lists the architectural decisions. For example, [ADR-025: Memory workspace with sequential web imports](adr/025-memory-workspace-sequential-imports.md) records the proposed page and queue decision.
- [TDR index](tdr/README.md) lists the implementation fixes. For example, [Claude budget test deadlines](tdr/035-bound-claude-budget-test-processes.md) records the Intel smoke timeout and bounded subprocess correction.
