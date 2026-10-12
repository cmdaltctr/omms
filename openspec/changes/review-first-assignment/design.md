# Design

## Context

The capture pipeline stores observations and assigns them to existing labels (categories) so later retrieval can find them. Experiments 05, 06 and 09 showed first-assignment automation misses a 2% wrong-reuse bar by a wide margin, while reviewed assignments (Experiments 07 and 08) replay safely. This change makes review the gate for first assignment and keeps automation for reviewed reuse.

## Goals and non-goals

- Goal: no label is reused automatically on first assignment without a human decision behind it.
- Goal: the classifier's work is not wasted; it becomes a suggestion in the review UI.
- Goal: host-neutral implementation in the shared core.
- Non-goal: changing the classifier, prompts, models or verification gates.
- Non-goal: auto-accepting high-confidence suggestions; that remains blocked until an experiment passes the gates on a human-reviewed reference.

## Decisions

| Decision                                | Choice                                                                                       | Rationale                                                                                              |
| --------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Routing rule location                   | Shared core, between capture and assignment storage                                          | All hosts inherit one rule; adapters stay thin (repo boundary rules)                                   |
| Suggestion handling                     | Stored as `suggested_label` alongside the pending review item                                | Keeps the classifier signal for review and for later experiments without making it the outcome         |
| Review outcome states                   | `label:<id>`, `none_fit`, `uncertain`                                                        | Mirrors Experiment 10's adjudication options; `uncertain` leaves the item pending rather than guessing |
| Automatic reuse scope                   | Assignments whose review outcome is `label:<id>` or `none_fit`                               | Matches the replay evidence from Experiments 07 and 08                                                 |
| Conflict with existing duplicate checks | Review routing happens after duplicate detection                                             | Exact and near-duplicate repeats keep their current fast path                                          |
| Storage                                 | Review outcomes stored with the assignment record, including reviewer identity and timestamp | Needed to distinguish reviewed reuse from first assignment forever after                               |

## Risks and trade-offs

- Review load starts high and falls as approved repeats grow. Experiments 12 and 14 report it rather than gate it. Mitigation: the queue is ordered, the suggestion is pre-selected, and repeats of approved items reduce the load over time (ADR-024).
- Reviewer disagreement: two humans may label one observation differently. Mitigation: `uncertain` state and the adjudicated reference from Experiment 10 as the shared baseline.
- A stale reviewed assignment may be wrong for a changed observation. Mitigation: existing duplicate and conflict checks still run on reuse; conflicts route back to review.

## Open questions

1. Should `uncertain` items expire back into the queue after a cooling period, or stay until touched? (Default in tasks: stay.)
2. Does the Pi web UI need the queue view in the first release, or is the shared web app enough for both hosts? (Default: shared web app only.)

## Migration

- New review items appear for new captures only; existing stores are not rescanned.
- No schema migration beyond additive columns/fields for `suggested_label`, review outcome, reviewer and timestamp.
- If the change is reverted, pending review items lose their suggestions but stored observations are unaffected.
