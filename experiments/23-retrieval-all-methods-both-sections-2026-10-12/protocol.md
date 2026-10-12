# Experiment 23: all label methods, one section against both sections

- **ID**: `23-retrieval-all-methods-both-sections-2026-10-12`
- **Category**: retrieval
- **Size**: Standard
- **Status**: PLANNED
- **Operator**: Dr Muhammad Aizat Md Hawari, with an agent session
- **Related**: [Experiment 22](../22-retrieval-tag-cutoff-check-2026-10-12/report.md); Experiments 17, 18 and 20; [ADR-024](../../docs/adr/024-review-first-label-assignment.md)

## 1. Question

Which method gives the best three tags per memory, and does choosing from both sections (preferences and patterns) help?

Decision: which method OMMS uses to tag memories, and whether it may pick labels from either section.

## 2. Hypotheses

"Hit" means at least one of the three tags is a valid label in the Experiment 22 multi-label key. Scores use the 561 observations with a valid label.

- **H1 (primary)**: Clef choosing from both sections hits at least 10 percentage points more often than Clef choosing from one section. The exact McNemar test gives p < 0.05.
- **H2 (primary, guardrail)**: for observations with a valid label in their own section, Clef's hit rate with both sections falls by no more than 3 points.
- **H3 (primary, best method)**: with both sections, compare Clef against cosine, reranker and the combination. Use three exact McNemar tests with a Holm correction.
- **H0 (null)**: for H1, the gain is under 10 points or p ≥ 0.05. For H3, no method beats Clef after correction.

**Decision rule**:

1. **Section setting**:
   - H1 and H2 hold: use both sections.
   - H1 holds and H2 fails: report the trade-off; the operator decides.
   - H1 fails: keep one section.
2. **Method**: take the method with the highest hit rate in the chosen section setting. If a cheaper method is within 3 points of it, take the cheaper one. Cheapest first: cosine (no model call), reranker (about 0.4 s), Clef (about 5 s), combination (all three).

## 3. Arms

Eight arms: four methods, each with one section and with both sections. Every arm gives three tags, never `none_fit`, with no cut-off.

| Method      | Three tags                                                                                                                        | One section                    | Both sections          |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | ---------------------- |
| Cosine      | Labels of the most similar past observations, first three distinct (Experiment 18 `first_labels`)                                 | Offline, saved vectors         | Offline, saved vectors |
| Reranker    | Top three label definitions by Qwen3 Reranker 0.6B score                                                                          | Exp 18 saved; Exp 20 new calls | New calls              |
| Clef        | Top three labels by Clef probability                                                                                              | Exp 18 and 20 saved            | New calls              |
| Combination | Round robin of first picks: Clef 1, cosine 1, reranker 1, then Clef 2, cosine 2, reranker 2; duplicates skipped; first three kept | Offline                        | Offline                |

"Both sections" removes the section rule in three places, and nowhere else:

1. **Clef options**: every label in that set's catalogue, plus `none_fit`. Experiment 18 uses 41 labels and Experiment 20 uses 56.
2. **Example and cosine ranking**: past observations from both sections, ranked by similarity.
3. **Reranker documents**: every label definition in the catalogue.

Fixed in all arms:

- models: Clef Flash Q8_0, Qwen3 Reranker 0.6B Q8_0, saved Qwen3 4B embeddings
- server settings from Experiments 15 and 17
- Clef question text; 2 examples per label and 3 for `none_fit`; a shortlist of 10
- catalogue per set; one option order

## 4. Data

| Item         | Value                                                                                                                                                                   |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source       | Experiment 18 (400 observations, catalogue version 1) and Experiment 20 (200 observations, catalogue version 2)                                                         |
| Unit         | One observation                                                                                                                                                         |
| Size         | 600; 561 have at least one valid label                                                                                                                                  |
| Groups       | None; each observation is scored once per arm                                                                                                                           |
| Labels       | Experiment 22 multi-label key: one blind AI pass, up to 3 valid labels from either section, 2026-10-12                                                                  |
| Already seen | One-section Clef answers were scored in Experiments 18, 20 and 22. One-section cosine and reranker were scored in Experiment 18. Both-section answers do not exist yet. |

Saved answers are reused where they exist. No saved call is repeated.

## 5. Steps

Run every command from the repository root.

1. Check, with no Clef calls: `python3 -I experiments/23-retrieval-all-methods-both-sections-2026-10-12/run_eval.py --phase check`
2. Run: `python3 -I experiments/23-retrieval-all-methods-both-sections-2026-10-12/run_eval.py --phase run --resume`
3. Verify, with no server and no writes: `python3 -I experiments/23-retrieval-all-methods-both-sections-2026-10-12/run_eval.py --phase verify`
4. Explore: `python3 -I experiments/23-retrieval-all-methods-both-sections-2026-10-12/analysis.py`

`--phase check` does four things:

1. It rebuilds every saved one-section request (Clef for 600 observations, reranker for 400). Each must match its saved `request_sha256`, which proves "both sections" is the only change.
2. It builds all new requests.
3. It counts the input tokens of every both-section Clef request through the owned Clef server.
4. It writes only `output/check.json`.

The run calls the reranker first: about 800 calls, roughly 6 minutes. Clef follows: 600 calls, roughly one hour. It owns one server at a time (reranker on port 3008, Clef on port 3005). It reuses the Experiment 15, 17, 18 and 20 runners read-only and pinned. It saves every 20 answers and resumes on matching request hashes.

## 6. Analysis

- **Stats level**: medium.
- **Tests**:
  - H1: exact McNemar on paired hits, a two-sided sign test on the discordant pairs (Experiment 18's `sign_test`).
  - H3: the same test for each of three pairs, with a Holm correction.
- **Intervals**: exact Clopper-Pearson 95% for each arm's hit rate (Experiment 18's `interval`). The repository has no shared bootstrap helper, so differences are reported with discordant counts.
- **Gates**:

| Gate              | Pass when                                                        | Why it matters                      |
| ----------------- | ---------------------------------------------------------------- | ----------------------------------- |
| G1 integrity      | All pinned inputs and model files match before and after the run | Results come from the frozen inputs |
| G2 baseline match | Every rebuilt one-section request matches its saved hash         | The only change is the section rule |
| G3 fit            | Every both-section Clef request has at most 8,192 input tokens   | Clef reads the whole option list    |
| G4 completeness   | Every arm has 600 valid answers; errors count as misses          | No silent drops                     |

- **Stop rule**: if G2 or G3 fails at `--phase check`, stop before any new answer. Record an amendment and ask the operator. For G3, the options are 1 example per label or a larger context. The run is complete when every arm has 600 valid answers.
- **Reported, not gated**:
  - all eight arms per set
  - tag precision and wrong tags
  - first-pick hit
  - hits on the 170 observations valid only in the other section
  - Clef `none_fit` answers on the 39 observations with no valid label
  - seconds per item per method
  - results against the old single-label keys
- **What each outcome means**:
  - The section rule follows H1 and H2.
  - The method follows the decision rule in section 2. The answer names one method and one section setting for the labelling ADR.
  - Unclear (a gain near a threshold, or p near 0.05): report as unclear and keep the simpler setting.

## Extra detail

### Environment

The run uses local llama.cpp servers pinned in Experiments 15 and 17. Both model files are already on disk; nothing is downloaded. It makes no embedding calls, because all observations and past examples have saved vectors. It makes no paid or web calls. It takes about 70 minutes in total.

### Privacy

Observation text goes only to the local servers. Raw answers stay in the git-ignored `output/`. Logs hold ids and counts only.

### Limits known before the run

1. The key is one AI pass with no human check. Validity stays INCONCLUSIVE by `../AGENTS.md`.
2. The key allowed labels from either section. That favours both-section arms on the 170 cross-section observations. That is the question, not a flaw. H2 guards the rest.
3. Cosine and Clef examples come from past observations labelled with one label each, by the old keys.
4. Longer option lists may slow Clef and the reranker. Speed is reported, not gated.

### Amendments

None. Before any code or run, the scope grew from Clef only to all four methods, at the operator's request (2026-10-12).
