# Proposal

## Why

Experiments 05, 06 and 09 measured first-assignment label reuse and every automated path failed the safety bar: the classifier's wrong reuse was 48/71 (67.61%) against a 2% limit, and two calibrated verification gates could not separate true matches from neighbouring definitions even on the development split. The accumulated evidence says no cheap automated check currently meets the reuse bar on first assignment.

Meanwhile, cached repeats behave well: Experiments 07 and 08 showed previously reviewed assignments replay consistently, with ten of ten unseen responses unchanged and no wrong reuse introduced. The safe automatic path is therefore reuse of already-reviewed assignments, not fresh classification.

We need a production design that is safe by construction today and improves only as reviewed data accumulates, instead of waiting for a model that passes the bar.

Experiment 23 (2026-10-12) then showed which suggestions help a reviewer most. About 3 in 10 observations fit only a label from the other section (preferences or patterns), which a one-section list can never show. A five-item list of Clef's top three from the observation's own section plus the two closest cosine labels from the other section held a valid label for 83.2% of observations, against 65.2% for Clef's own-section top five. Letting Clef choose from both sections was worse on own-section observations and 2.5 times slower. The reranker and the combination added cost without a real gain. ADR-024 decision 5 records this.

Clef must run somewhere for the list to work. The experiments ran it on a local llama.cpp server. Cloudflare Workers AI (`@cf/cloudflare/clef`) and TypeSafe (Jev) accept the same request shape as hosted options.

## What Changes

- First assignment of a memory label to an observation SHALL route to review instead of being reused automatically. The classifier's suggestion travels with the case as a pre-selected option, never as the stored outcome.
- Reuse of an assignment that a human previously reviewed SHALL stay automatic, subject to the existing duplicate and conflict checks.
- The review queue SHALL show the observation, the suggested label and its neighbouring definitions, and SHALL accept one of: a label, `none_fit`, or an explicit uncertain marker that leaves the case unlabelled.
- Review outcomes SHALL become reviewed examples for any later experiment; ADR-024 sets when automatic first assignment may be tested again; nothing in this change retrains or retunes a model.
- The change applies to every host through the shared core; no host-specific assignment logic is added.
- Each review item SHALL show a list of suggestions. By default, five: Clef's top three labels from the observation's own section, then the two labels from the other section whose reviewed observations are closest by cosine. The reviewer MAY pick a label from either section. The reranker and the combination of methods are not used.
- Two **suggestion count** settings in the Memory card of the Settings page SHALL set how many suggestions come from the own section (Clef; default 3, from 1 to 10) and from the other section (cosine; default 2, from 0 to 10). For example, 5 and 0 gives Clef's own-section top five. Counts change no model call.
- A **decision model** setting SHALL choose where Clef runs: a local llama.cpp server (default), Cloudflare Workers AI, TypeSafe (Jev), or off. Hosted options are opt-in, take keys as `env://` or `file://`, and receive text only after `<private>` removal and secret redaction.
- If the decision model is off, unreachable, slow or out of allowance, the review item SHALL still be created with cosine suggestions only. Capture SHALL never block on the decision model.

## Capabilities

### New Capabilities

- `label-assignment-review`: first-assignment label decisions route to review with a suggestion; only reviewed assignments are reused automatically.

### Modified Capabilities

None. `profile-learning`, `capture-diagnostics` and the host contracts keep their current requirements; this change adds a routing rule between capture and assignment storage.

## Impact

- Shared core (`src/core/`, `src/services/`) gains the routing rule and review outcome storage; adapters stay thin and host-neutral.
- The web review UI gains or extends a queue view for first-assignment cases.
- Users see more review items until the reviewed catalogue grows. First-assignment review load starts high and falls as approved repeats grow. Experiments 12 and 14 report it; parked items can be decided in groups.
- No new dependencies and no model training. Hosted calls happen only when a user switches the decision model to Cloudflare or TypeSafe; the default is a local server, so memory text stays on the machine.
- Config gains the two suggestion count keys and the decision model keys; the Settings page Memory card gains both controls; `docs/web-ui-settings.md` documents them. ADR-025 records the decision model choice and its privacy rules.
- The review store gains additive columns for each item's embedding vector and embedding model, so cosine needs no new embedding call.
- Evidence note: Experiment 23 measured only the counts 3 and 2, 5 and 0, and 3 and 0; other counts work but are unmeasured. The mixed list was designed after Experiment 23's results were seen, on an AI-made key, and the experiments used Clef Flash Q8_0 locally. Hosted Clef or Jev may score differently.
- Validity note: the evidence behind this proposal comes from AI-authored reference labels; Experiment 10's human adjudication may shift the measured rates, but the design decision (review before first reuse) does not depend on those rates being precise.
