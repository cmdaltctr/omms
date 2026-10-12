# ADR-024: First label assignment goes to review

- **Date:** 2026-10-11
- **Status:** Proposed
- **Deciders:** OMMS maintainer

## Context

OMMS files each captured observation under a label so that later retrieval works. The catalogue has 41 labels in two sections, preferences and patterns. An AI wrote it from about 60 observations, so each label has about 3 examples.

A wrong automatic label spoils every later retrieval for that label. The original bar was under 2% wrong reuse. Experiment 11 replaced it with a bar the data can prove:

- On the 140 test cases: zero wrong picks and at least 29 correct.
- For production: an upper limit of 5% or less on fresh labelled data.

Experiments 04 to 14 tested every automatic way to pick a label the first time. None came close:

| Approach                                          | Experiment | Result                                       |
| ------------------------------------------------- | ---------- | -------------------------------------------- |
| Small local classifier (Qwen3-0.6B)               | 05, 06     | 59% wrong reuse on the adjudicated reference |
| Confidence thresholds on Clef                     | 04         | no threshold met the bar                     |
| Verifier gate on the label definition (NLI, Clef) | 09         | both failed calibration                      |
| Merging confusable labels                         | 11         | fixed 1 of 13 label confusions               |
| Matching against labelled past observations       | 12, 14     | safe but starved: at most 1 correct          |

Two findings explain the failures:

- In 28 of 42 wrong picks, no label fitted at all. Better label boundaries cannot fix that.
- Embeddings group observations by topic. Labels describe intent. The nearest past observation carries an acceptable label in only 32 of 67 labelled cases.

One mechanism works. Reusing a label that a person already approved for the same observation repeats that decision exactly (Experiments 07 and 08).

## Decision

1. The first assignment of any label goes to the review queue. No model or gate assigns a label automatically the first time.
2. Automatic reuse happens only for a repeat of an observation whose label, or `none_fit`, a person has already approved. The `review-first-assignment` change implements this in `src/core/label-assignment.ts`.
3. A model may suggest a label in the review item. The suggestion is never stored as the outcome.
4. Automatic first assignment is closed until new evidence meets the Experiment 11 ruler on fresh labelled data. Two conditions would justify a new experiment: labels with many more approved examples, or a method that judges intent, not topic.
5. The review item shows five suggestions, plus "No label fits". Operator decision on 2026-10-12, amended the same day after Experiment 23:
   - Clef's three most likely labels from the observation's own section.
   - Then the two labels from the other section whose past observations are most similar by cosine. These reuse the observation's existing embedding, so they add no model call.
   - A person may pick a label from either section.

   In Experiment 23 (600 observations, AI-made multi-label key), this list held a valid label for 83.2% of observations. Clef's own-section top five held one for 65.2%. On observations that fit their own section, the list held one for 90.0% against 93.6%, so it gives up a little there to cover the rest. About 3 in 10 observations fit only a label from the other section, which a one-section list can never show. The list was designed after the results were seen, so it is exploratory evidence. Letting Clef choose from both sections was rejected: own-section hits fell from 88.5% to 77.0%, and each call took 9.4 s instead of 3.7 s. The reranker and the combination of all three methods are dropped from the review item. Neither beat Clef or cosine, and both add cost.

   Earlier evidence for this decision: In Experiment 18, Clef's first pick beat cosine and the reranker. In Experiment 20, on 200 new observations, its top three held the right label for 87.5%, under the 90% mark set in advance; its top five held it for 91.4% (exploratory). Both experiments confirmed that automatic use of any method still fails, because every method forces labels on observations that fit none.

6. The label catalogue is version 2: the 41 original labels plus 15 accepted on 2026-10-12 (Experiment 19), 56 in total. In Experiment 20, the share of new observations that fit no label fell from 49.7% to 33.3%. The catalogue file is `experiments/19-review-catalogue-v2-candidates-2026-10-12/output/catalogue-v2.json`; 11 further candidates are held until they gather more examples.

## Consequences

### Positive

- No wrong automatic label reaches retrieval through first assignment.
- The decision rests on measured results, with negative results kept in `experiments/`.
- Every approval adds a reviewed example, which a later experiment can use.

### Negative

- Every new observation needs a person's decision once. Review load grows with capture volume until repeats dominate.
- The queue has no producer yet. Capture does not create review items until task 3.2 of `review-first-assignment` lands.

### Neutral

- Experiment 13 (Clef confirms the nearest neighbour's label) is withdrawn without a run. Experiment 12 showed its ceiling is 32 correct, against a need of 29 with zero wrong.
- Catalogue consolidation is no longer a precondition for wiring the producer.
- Planned in `openspec/changes/review-first-assignment/` (task 3.2): two settings in the web UI's Memory card set how many suggestions come from each section (own 1 to 10, default 3; other 0 to 10, default 2), and a decision model setting chooses where Clef runs (local llama.cpp by default; Cloudflare or TypeSafe opt-in, recorded in ADR-025).

## Alternatives Considered

| Option                                    | Rejected Because                                                                    |
| ----------------------------------------- | ----------------------------------------------------------------------------------- |
| **Automatic first assignment by a model** | 59% wrong reuse; thresholds and verifiers did not reach the bar (Experiments 04–09) |
| **Consolidate the catalogue first**       | Merging fixed 1 of 13 confusions and none of the 28 forced labels (Experiment 11)   |
| **Neighbour gate on embeddings**          | Safe but accepted at most 1 correct (Experiments 12 and 14)                         |
| **Clef confirms the nearest neighbour**   | Ceiling of 32 correct makes a pass very unlikely; withdrawn before running (13)     |
| **Hosted frontier model**                 | Privacy cost; it cannot fix intent labels with about 3 examples each                |
| **Clef chooses from both sections**       | Own-section hits fell from 88.5% to 77.0%; 9.4 s per call (Experiment 23)           |
| **Reranker suggestions**                  | Never the best method; matched cosine (Experiments 17, 18 and 23)                   |
| **Combination of all three methods**      | No real gain over Clef or cosine, at the cost of every model call (Experiment 23)   |

## References

- `openspec/changes/review-first-assignment/`
- `src/core/label-assignment.ts`, `src/services/label-assignment-store.ts`
- `experiments/10-review-reference-adjudication-2026-10-11/report.md`
- `experiments/11-retrieval-catalogue-consolidation-replay-2026-10-11/report.md` (the ruler)
- `experiments/12-retrieval-neighbour-reuse-gate-2026-10-11/report.md`
- `experiments/14-retrieval-neighbour-gate-fewer-neighbours-2026-10-11/report.md`
- `experiments/18-retrieval-fresh-confirmation-all-methods-2026-10-12/report.md` (suggestion engine)
- `experiments/19-review-catalogue-v2-candidates-2026-10-12/report.md` (catalogue version 2 candidates)
- `experiments/20-retrieval-catalogue-v2-fresh-test-2026-10-12/report.md` (catalogue version 2 and suggestion list length)
- `experiments/21-retrieval-final-summary-2026-10-12/report.md` (summary of Experiments 01 to 20)
- `experiments/23-retrieval-all-methods-both-sections-2026-10-12/report.md` (sections and the mixed suggestion list)
