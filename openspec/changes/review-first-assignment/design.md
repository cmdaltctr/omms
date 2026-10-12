# Design

## Context

The capture pipeline stores observations and assigns them to existing labels (categories) so later retrieval can find them. Experiments 05, 06 and 09 showed first-assignment automation misses a 2% wrong-reuse bar by a wide margin, while reviewed assignments (Experiments 07 and 08) replay safely. This change makes review the gate for first assignment and keeps automation for reviewed reuse.

## Goals and non-goals

- Goal: no label is reused automatically on first assignment without a human decision behind it.
- Goal: the classifier's work is not wasted; it becomes a suggestion in the review UI.
- Goal: host-neutral implementation in the shared core.
- Goal: show the reviewer the list that most often contains a valid label (Experiment 23), at one Clef call per item.
- Goal: let the user choose how many suggestions come from each section and where Clef runs, with local and private as the default.
- Non-goal: training or tuning a model, or changing Experiment 15's question text and option shape.
- Non-goal: auto-accepting high-confidence suggestions; that remains blocked until an experiment passes the gates on a human-reviewed reference.

## Decisions

| Decision                                | Choice                                                                                           | Rationale                                                                                                                                         |
| --------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Routing rule location                   | Shared core, between capture and assignment storage                                              | All hosts inherit one rule; adapters stay thin (repo boundary rules)                                                                              |
| Suggestion handling                     | Stored as `suggested_label` alongside the pending review item                                    | Keeps the classifier signal for review and for later experiments without making it the outcome                                                    |
| Review outcome states                   | `label:<id>`, `none_fit`, `uncertain`                                                            | Mirrors Experiment 10's adjudication options; `uncertain` leaves the item pending rather than guessing                                            |
| Automatic reuse scope                   | Assignments whose review outcome is `label:<id>` or `none_fit`                                   | Matches the replay evidence from Experiments 07 and 08                                                                                            |
| Conflict with existing duplicate checks | Review routing happens after duplicate detection                                                 | Exact and near-duplicate repeats keep their current fast path                                                                                     |
| Storage                                 | Review outcomes stored with the assignment record, including reviewer identity and timestamp     | Needed to distinguish reviewed reuse from first assignment forever after                                                                          |
| Suggestion list (default)               | Clef top three, own section; then two other-section labels by cosine; no repeats                 | 83.2% of observations had a valid label in the list, against 65.2% for Clef's top five (Experiment 23)                                            |
| Suggestion counts                       | Two settings: own section 1 to 10 (default 3), other section 0 to 10 (default 2)                 | One mechanism covers every list; 5 and 0 gives the highest own-section hit rate (93.6% against 90.0%); counts above those measured are unmeasured |
| Clef request                            | Experiment 15 question and option shape; own-section labels with two reviewed examples each      | The shape every Clef result was measured with (Experiments 15 to 23)                                                                              |
| Cosine source                           | Reviewed items' stored vectors, same embedding model only                                        | No new embedding call; vectors from a different model are not comparable                                                                          |
| Methods not used                        | Reranker, combination of methods, Clef over both sections                                        | No real gain, extra cost; Clef over both sections lost 11.5 own-section points (Experiment 23)                                                    |
| Decision model location                 | Port in `src/services/`, called by the shared core producer; the web app runs it for Claude Code | One rule for every host; Claude Code hooks cannot call a model themselves                                                                         |
| Decision model values                   | Local llama.cpp (default), Cloudflare Workers AI, TypeSafe (Jev), off                            | Same `/v1/systemone`-style request; local keeps memory text on the machine (ADR-025)                                                              |
| Hosted opt-in                           | Global config only; project config may choose local or off                                       | Matches the capture trace rule: a project can turn a privacy risk off, never on                                                                   |
| Failure handling                        | Time limit, then cosine fills Clef's places; item still created                                  | A failed step must not block capture (repository rule)                                                                                            |

## Risks and trade-offs

- Review load starts high and falls as approved repeats grow. Experiments 12 and 14 report it rather than gate it. Mitigation: the queue is ordered, the suggestion is pre-selected, and repeats of approved items reduce the load over time (ADR-024).
- Reviewer disagreement: two humans may label one observation differently. Mitigation: `uncertain` state and the adjudicated reference from Experiment 10 as the shared baseline.
- A stale reviewed assignment may be wrong for a changed observation. Mitigation: existing duplicate and conflict checks still run on reuse; conflicts route back to review.
- The mixed list rests on exploratory evidence: it was designed after Experiment 23's results, on an AI-made key. Mitigation: the count settings let a user switch back (5 and 0) without code; every suggestion is reviewed, so a weak list costs review time, not wrong labels.
- Hosted Clef or Jev is not the model the experiments measured (Clef Flash Q8_0, local). Mitigation: local is the default; hosted values are labelled as unmeasured in the Settings page help text.
- Cold start: with few reviewed items, cosine finds few other-section labels and Clef has few examples. Mitigation: the list shows what it finds and never pads it; quality grows with reviews.
- Hosted values send memory text off the machine. Mitigation: opt-in in the global config only, `<private>` removal and secret redaction first, no text in logs (ADR-025).

## Open questions

1. Should `uncertain` items expire back into the queue after a cooling period, or stay until touched? (Default in tasks: stay.)
2. Does the Pi web UI need the queue view in the first release, or is the shared web app enough for both hosts? (Default: shared web app only.)
3. Ollama as a decision model value: unknown whether it serves the `/v1/systemone` request. Left out until a probe confirms it.
4. The decision model time limit. (Default in tasks: 20 seconds, above Clef's measured 3.7 s per own-section call.)
5. Whether Cloudflare serves Clef or Clef Flash under `@cf/cloudflare/clef`, and its free daily allowance. Checked during task 3.2.4 against Cloudflare's own documentation.

## Migration

- New review items appear for new captures only; existing stores are not rescanned.
- No schema migration beyond additive columns/fields for `suggested_label`, review outcome, reviewer and timestamp, and the item's embedding vector and embedding model.
- Items created before the vector columns have no vector; the cosine step skips them.
- New config keys are optional; an absent key means the default (mixed list, local llama.cpp).
- If the change is reverted, pending review items lose their suggestions but stored observations are unaffected.
