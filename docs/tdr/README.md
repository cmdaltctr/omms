# Technical Decision Records (TDRs)

TDRs capture **implementation-level technical decisions** such as platform-specific workarounds, debugging findings, build pipeline decisions, and behavioural fixes. For **architectural** decisions, see the [ADR index](../adr/).

## When to write a TDR vs an ADR

| TDR                                                | ADR                                     |
| -------------------------------------------------- | --------------------------------------- |
| How to make a specific technology behave correctly | What stack or structure to use          |
| Platform-specific workarounds                      | Framework and language choices          |
| Debugging findings with root cause analysis        | Authentication and authorisation models |
| Build pipeline and tooling decisions               | Data model and API design               |

## How to use

1. Copy `TEMPLATE.md` to a new file: `NNN-short-descriptive-title.md`.
2. Fill in all sections.
3. Add an entry to the table below.
4. Commit the record with the change it describes.

## Index

| ID                                                           | Title                                                                   | Status                | Date       |
| ------------------------------------------------------------ | ----------------------------------------------------------------------- | --------------------- | ---------- |
| [001](./001-read-opencode-live-sqlite.md)                    | Read OpenCode's live SQLite database with immutable node:sqlite         | Superseded by TDR-003 | 2026-09-25 |
| [002](./002-accept-bare-skip-replies.md)                     | Accept bare skip replies and log unparseable capture output             | Accepted              | 2026-09-25 |
| [003](./003-snapshot-opencode-wal-database.md)               | Read WAL-mode OpenCode databases through a consistent temporary copy    | Superseded by TDR-008 | 2026-09-26 |
| [004](./004-exclude-omms-internal-sessions-from-import.md)   | Exclude OMMS's own capture sessions from OpenCode history               | Accepted              | 2026-09-26 |
| [005](./005-two-tier-capture-diagnostics.md)                 | Log capture metadata always and full traces only on opt-in              | Accepted              | 2026-09-27 |
| [006](./006-fix-silent-capture-failures.md)                  | Fix silent capture failures on Pi and on OpenCode v2                    | Accepted              | 2026-09-27 |
| [007](./007-directory-maps-take-precedence.md)               | Directory maps take precedence on both hosts; a Pi root may be one file | Accepted              | 2026-09-27 |
| [008](./008-shared-async-opencode-snapshot.md)               | Copy OpenCode databases asynchronously and share one copy per source    | Accepted              | 2026-09-27 |
| [009](./009-protect-capture-traces-on-windows.md)            | Protect capture traces with Windows access-control lists                | Accepted              | 2026-09-27 |
| [010](./010-match-windows-native-import-source-paths.md)     | Match Windows import-source tests to native canonical paths             | Proposed              | 2026-09-27 |
| [011](./011-use-execfilesync-in-windows-git-wrapper-test.md) | Use execFileSync in the Windows Git wrapper test                        | Proposed              | 2026-09-27 |
| [012](./012-tag-migration-touches-only-untagged-memories.md) | Tag migration touches only untagged memories                            | Proposed              | 2026-09-28 |
| [013](./013-stable-homebrew-runtime-for-login-item.md)       | Store a stable Homebrew runtime path in the login item                  | Proposed              | 2026-09-28 |

## Status values

- **Proposed**: Under discussion.
- **Accepted**: Agreed and active.
- **Superseded**: Replaced by a later TDR.
- **Deprecated**: No longer relevant.

Once a TDR is **Accepted**, supersede its decision with a new TDR rather than editing it.
