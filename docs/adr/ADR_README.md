# Architecture Decision Records

Local decision records for OMMS maintainers.

| ADR                                                        | Title                                                             | Date       | Status   |
| ---------------------------------------------------------- | ----------------------------------------------------------------- | ---------- | -------- |
| [001](./001-local-macos-and-github-ci.md)                  | Local macOS and limited GitHub CI                                 | 2026-09-21 | Accepted |
| [002](./002-built-in-history-importer.md)                  | Replace backfill scripts with a built-in history importer         | 2026-09-25 | Accepted |
| [003](./003-npm-name-om-memory-system.md)                  | Publish on npm as om-memory-system with a fixed plugin id         | 2026-09-25 | Accepted |
| [004](./004-release-pipeline.md)                           | Release pipeline with staged approval and a next channel          | 2026-09-25 | Accepted |
| [005](./005-history-import-surfaces-and-model.md)          | One import command per host, using the session's model by default | 2026-09-26 | Accepted |
| [006](./006-one-live-model-rule-for-both-hosts.md)         | One live-model rule for OpenCode and Pi                           | 2026-09-26 | Accepted |
| [007](./007-edit-global-config-from-web-ui.md)             | Edit the global config from the web UI                            | 2026-09-27 | Proposed |
| [008](./008-session-first-web-import.md)                   | Session-first imports from the web UI with pinned selections      | 2026-09-27 | Proposed |
| [009](./009-default-on-backfill-and-login-web-app.md)      | Default-on history backfill and login web app                     | 2026-09-27 | Proposed |
| [010](./010-private-key-file-for-external-api.md)          | Save a pasted external API key to a private key file              | 2026-09-28 | Proposed |
| [011](./011-shared-code-never-imports-adapters.md)         | Shared code never imports a host adapter                          | 2026-09-28 | Proposed |
| [012](./012-capture-retry-queue-stores-cleaned-turns.md)   | Keep cleaned failed turns for a limited time to retry capture     | 2026-09-28 | Proposed |
| [013](./013-claude-code-host-through-hooks-and-web-app.md) | Claude Code host through hooks and the web app                    | 2026-09-29 | Proposed |
| [014](./014-one-shared-web-app-for-every-host.md)          | One shared web app for every host                                 | 2026-09-29 | Proposed |
