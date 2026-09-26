# TDR-004: Exclude OMMS's own capture sessions from OpenCode history

**Date:** 2026-09-26
**Status:** Accepted
**Deciders:** Project maintainer
**Tags:** opencode, history-import

## Context

When OMMS captures memories or learns the profile through an OpenCode provider, it creates short-lived internal OpenCode sessions. They are titled `omms capture`, or `opencode-mem capture` in older builds. OMMS deletes these sessions only on a best-effort basis, and they are written to `opencode.db` like any other session. The in-session import (ADR-005) makes these calls during the import itself.

### Root Cause Analysis

The reader selected every top-level session. A real user database held 9 leftover `opencode-mem capture` sessions:

```sql
SELECT title, COUNT(*) FROM session WHERE title LIKE '%capture%' GROUP BY title;
-- opencode-mem capture | 9
```

Their prompts are OMMS's own summarisation requests, so importing them would store memories and profile prompts about OMMS instead of the user's work. Each later run would also import the previous run's capture sessions.

## Decision

`INTERNAL_CAPTURE_SESSION_TITLES` in `src/services/ai/internal-capture-sessions.ts` lists every title OMMS has used. When the `session` table has a `title` column, the reader adds `AND (s.title IS NULL OR s.title NOT IN (...))` to the session query and to both session counts. Any new internal title must be added to that list.

## Consequences

### Positive

- Imports contain only the user's conversations, and reruns stay stable after in-session imports.

### Negative

- Matching relies on titles. A user session given exactly an internal title would be skipped.

### Neutral

- Databases without a `title` column (test fixtures) read as before.

## Alternatives Considered

| Option                            | Rejected Because                                                 |
| --------------------------------- | ---------------------------------------------------------------- |
| Match the `omms-structured` agent | The agent is not stored on every OpenCode version's session row. |
| Match `metadata.omms.internal`    | Not set by older builds that left the existing leftovers.        |
| Delete leftover sessions          | The importer must never change OpenCode's database.              |

## How to Recognise / Handle This Again

1. Symptom: imported memories or profile prompts describe summarising conversations or `save_memory` calls.
2. Check with the query above, or look for a new title in `internal-capture-sessions.ts`.
3. Add the title to `INTERNAL_CAPTURE_SESSION_TITLES` and rerun; the "never imports omms's own internal capture sessions" test covers the filter.

## Revisit Triggers

OMMS changes its internal session title, or OpenCode stores a reliable internal flag on sessions.

## References

- `src/importer/opencode-reader.ts`
- `src/services/ai/internal-capture-sessions.ts`
- `tests/history-import-commands.test.ts`
- ADR-005
