# ADR-008: Session-first imports from the web UI with pinned selections

**Date:** 2026-09-27
**Status:** Proposed
**Deciders:** OMMS maintainers

## Context

The Settings page first offered the history importer as a form of CLI flags. Users want to list sessions by host and project, pick some or all of them, preview that exact set, and then import it. Four constraints shape the design:

- The web server runs inside OpenCode. OpenCode writes its database on every message, and an active Pi session file grows while it is used.
- A preview and the import that follows can be minutes apart.
- History may live on another volume, for example a backup on an external drive.
- The page must never upload conversation files, and must not let another website start heavy work.

## Decision

- **Listing.** The server lists session metadata only: a selection key, session ID, date, recorded directory, resolved directory, and how it was resolved. The key is the OpenCode session ID, or a Pi file's path relative to the source.
- **Revision.** Each listing returns a SHA-256 revision of the source identity, scope, project, directory maps, and sorted matching keys. It never uses file sizes or times, so new turns in a listed session do not change it.
- **Stateless selections.** The page sends either explicit keys (at most 1,000) or "all matching" with exclusions and the revision. Before every preview or import the server resolves the selection again. It refuses with `409` when a new session would join "all", or when a picked session is gone or now resolves to another project.
- **Turn cutoff.** Preview and import both skip turns newer than the listing time and report how many they held back. A later run from a fresh listing imports them under the same ledger keys.
- **Sources.** The page names a server-side absolute path. The server resolves it with `realpath`, checks its kind and format, and returns a signed token holding the real path, device, and inode. It checks them again before a job. The folder browser works only on loopback binds.
- **Endpoints.** Source, listing, and job endpoints are JSON `POST`s under the Settings mutation guard, because listing a live OpenCode database can copy gigabytes. Readiness is a side-effect-free `GET`.
- **Model readiness.** The server checks the external API and connected OpenCode models inside its own process, and whether the Pi SDK loads, before it accepts a job. The page labels the result "configured, not tested".
- **One slot.** Previews and imports share the single job slot. The page and CLI keep one ledger.

## Consequences

### Positive

- The preview and the import read the same sessions and turns; nothing joins a selection silently.
- A live database does not make every selection stale.
- No conversation content leaves the server; remote users cannot browse folders.
- Misconfigured models fail at the request, not minutes into a job.

### Negative

- Newer turns need a second run.
- A selection goes stale when the membership options change, so the user refreshes the list.
- More endpoints and request validation to maintain.

### Neutral

- The page drops the single-session and maximum-sessions fields; the CLI keeps them.

## Alternatives Considered

| Option                                        | Rejected Because                                                 |
| --------------------------------------------- | ---------------------------------------------------------------- |
| Revision from file size and modification time | A live OpenCode database would make every selection stale.       |
| Keep selections on the server                 | Lost on restart, and harder to reason about across tabs.         |
| Refuse the import when a session gains turns  | Would fail constantly while the user keeps working.              |
| Upload history files from the browser         | Sends conversation content over HTTP and duplicates large files. |
| `GET` for listing                             | Skips the JSON check, so another site could start a large copy.  |
| Browser folder browsing on every bind         | Lets remote users list the machine's folders.                    |

## References

- [Importing from the page](../web-ui.md#importing-from-the-page)
- [ADR-005](./005-history-import-surfaces-and-model.md), [ADR-007](./007-edit-global-config-from-web-ui.md)
- [TDR-007](../tdr/007-directory-maps-take-precedence.md), [TDR-008](../tdr/008-shared-async-opencode-snapshot.md)
- `src/importer/import-sessions.ts`, `src/importer/import-sources.ts`, `src/importer/import-readiness.ts`, `src/importer/web-import-jobs.ts`
- [OpenSpec design](../../openspec/changes/web-settings/design.md)
