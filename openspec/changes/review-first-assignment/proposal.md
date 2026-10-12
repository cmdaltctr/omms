# Proposal

## Why

Experiments 05, 06 and 09 measured first-assignment label reuse and every automated path failed the safety bar: the classifier's wrong reuse was 48/71 (67.61%) against a 2% limit, and two calibrated verification gates could not separate true matches from neighbouring definitions even on the development split. The accumulated evidence says no cheap automated check currently meets the reuse bar on first assignment.

Meanwhile, cached repeats behave well: Experiments 07 and 08 showed previously reviewed assignments replay consistently, with ten of ten unseen responses unchanged and no wrong reuse introduced. The safe automatic path is therefore reuse of already-reviewed assignments, not fresh classification.

We need a production design that is safe by construction today and improves only as reviewed data accumulates, instead of waiting for a model that passes the bar.

## What Changes

- First assignment of a memory label to an observation SHALL route to review instead of being reused automatically. The classifier's suggestion travels with the case as a pre-selected option, never as the stored outcome.
- Reuse of an assignment that a human previously reviewed SHALL stay automatic, subject to the existing duplicate and conflict checks.
- The review queue SHALL show the observation, the suggested label and its neighbouring definitions, and SHALL accept one of: a label, `none_fit`, or an explicit uncertain marker that leaves the case unlabelled.
- Review outcomes SHALL become reviewed examples for any later experiment; ADR-024 sets when automatic first assignment may be tested again; nothing in this change retrains or retunes a model.
- The change applies to every host through the shared core; no host-specific assignment logic is added.

## Capabilities

### New Capabilities

- `label-assignment-review`: first-assignment label decisions route to review with a suggestion; only reviewed assignments are reused automatically.

### Modified Capabilities

None. `profile-learning`, `capture-diagnostics` and the host contracts keep their current requirements; this change adds a routing rule between capture and assignment storage.

## Impact

- Shared core (`src/core/`, `src/services/`) gains the routing rule and review outcome storage; adapters stay thin and host-neutral.
- The web review UI gains or extends a queue view for first-assignment cases.
- Users see more review items until the reviewed catalogue grows. First-assignment review load starts high and falls as approved repeats grow. Experiments 12 and 14 report it; parked items can be decided in groups.
- No new dependencies, no model changes, no hosted calls.
- Validity note: the evidence behind this proposal comes from AI-authored reference labels; Experiment 10's human adjudication may shift the measured rates, but the design decision (review before first reuse) does not depend on those rates being precise.
