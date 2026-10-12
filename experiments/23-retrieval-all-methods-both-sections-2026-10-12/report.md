# Experiment 23: all label methods, one section against both sections

- **ID**: `23-retrieval-all-methods-both-sections-2026-10-12`
- **Category**: retrieval · **Size**: Standard
- **Date run**: 2026-10-12
- **Operator**: Dr Muhammad Aizat Md Hawari, agent session
- **Status**: MIXED (H1 holds, H2 fails). Validity for production: INCONCLUSIVE (one AI-made answer key).
- **Plan**: [protocol.md](protocol.md) · [plan.json](plan.json)
- **Source of every number**: `output/summary.json` unless another file is named

## Answer

- **Question**: Which method gives the best three tags per memory, and does choosing from both sections (preferences and patterns) help?
- **Answer**: Unclear. Both sections lift Clef's hit rate from 61.7% to 74.0% (`H1`). They cost Clef 11.5 points on memories whose label sits in their own section (`H2`).
- **Decision**: The frozen rule handed the section choice to the operator. On 2026-10-12 the operator chose a mixed review list: Clef's top three from the memory's own section, plus the two closest cosine labels from the other section (finding 9). Clef does not choose from both sections. The reranker and the combination are dropped. ADR-024 decision 5 records this.
- **How sure**: Medium on the section effects, because the paired tests are far from chance. Low on the method choice, because no method differs from Clef after correction.
- **Next step**: Build the mixed list in the review item. A web UI setting to choose the list needs its own OpenSpec change.

## What we tested

We gave each of four methods the same 600 memories twice: once with labels from the memory's own section only, once with labels from both sections.
The four methods are cosine (labels of the most similar past memories), reranker (Qwen3 Reranker scores each label definition), Clef (probability for each label) and a round-robin combination of the three.
Each method gives up to three tags and never `none_fit`. A "hit" means one of the three tags is a valid label in the Experiment 22 multi-label key.
The decision is which method OMMS uses to tag memories, and whether it may pick labels from either section.
The data are 400 memories from Experiment 18 (41 labels) and 200 from Experiment 20 (56 labels). 561 have at least one valid label (`counts.with_valid_label`).

## Results

Hit rate on the 561 memories with a valid label, with the exact 95% range (`arms.pooled`).

| Method      | One section                    | Both sections                  | Gain (points) |
| ----------- | ------------------------------ | ------------------------------ | ------------: |
| Cosine      | 318/561 = 56.7% (52.5 to 60.8) | 410/561 = 73.1% (69.2 to 76.7) |         +16.4 |
| Reranker    | 300/561 = 53.5% (49.3 to 57.7) | 398/561 = 70.9% (67.0 to 74.7) |         +17.5 |
| Clef        | 346/561 = 61.7% (57.5 to 65.7) | 415/561 = 74.0% (70.1 to 77.6) |         +12.3 |
| Combination | 336/561 = 59.9% (55.7 to 64.0) | 426/561 = 75.9% (72.2 to 79.4) |         +16.0 |

Every method gains from both sections. Within each section setting, the ranges of the four methods overlap.

Per set (`arms.exp18`, `arms.exp20`): Clef both sections reaches 281/377 = 74.5% on Experiment 18 and 134/184 = 72.8% on Experiment 20. Clef one section reaches 226/377 = 59.9% and 120/184 = 65.2%.

Cost per memory (`exploratory.seconds_per_item`, exploratory): cosine 0 s, reranker 0.46 s (one) and 1.00 s (both), Clef 3.66 s and 9.44 s, combination 4.12 s and 10.44 s. Cosine reads saved vectors, so its time excludes the embedding step.

### Gates

| Gate                | Result                                                                                                            |
| ------------------- | ----------------------------------------------------------------------------------------------------------------- |
| G1 inputs unchanged | Pass: 11 pinned inputs, reranker file and Clef runtime match before and after (`check.json`, `run-manifest.json`) |
| G2 baseline match   | Pass: 600 of 600 Clef and 400 of 400 reranker requests match their saved hash (`gates.G2_baseline_match`)         |
| G3 fit              | Pass: largest both-section Clef request used 7,606 input tokens, limit 8,192, none refused (`gates.G3_fit`)       |
| G4 completeness     | Pass: 600 valid answers in all eight arms (`gates.G4_completeness`)                                               |

### Hypotheses

| Hypothesis     | Null                                         | Result                                                                                                                                                                       | Plain meaning                                                                                              |
| -------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| H1 (primary)   | Gain under 10 points, or p at least 0.05     | Supported. Gain +12.3 points; Clef both sections wins 120 and loses 51 discordant pairs; exact McNemar p = 1.4e-07 (`H1`)                                                    | Both sections help Clef by more than the planned margin. Chance does not explain it.                       |
| H2 (guardrail) | Loss on own-section memories over 3 points   | Not supported. 346/391 = 88.5% falls to 301/391 = 77.0%, a loss of 11.5 points (`H2`)                                                                                        | When the right label is in the memory's own section, extra labels from the other section pull Clef off it. |
| H3 (primary)   | No method differs from Clef after correction | Not rejected. Clef against combination 37 wins, 48 losses, Holm p = 0.556. Against cosine 73 and 68, Holm p = 0.736. Against reranker 75 and 58, Holm p = 0.495 (`H3.tests`) | With both sections, no method beats another in this sample.                                                |

### Decision by the frozen rule (`decision`)

1. Section setting: H1 holds and H2 fails, so the operator decides.
2. Method with one section: Clef has the highest count (346). Cosine trails by 28 (5.0 points), outside the 3-point margin.
3. Method with both sections: combination has the highest count (426). Cosine trails by 16 (2.9 points), inside the margin, and is cheapest, so cosine wins.

### Amendments and deviations

Amendments: none in `plan.json`.

Deviation, G3 method: the plan says to count input tokens through the Clef server. The server's `/tokenize` endpoint counts 250 to 385 tokens fewer than the server reports, because the server adds its own prompt wrapper.
We fitted the tokenised pieces and the option count to the saved `usage.input_tokens` of the 600 one-section requests. Residuals stayed within 5 tokens (`check.json`, `G3_fit`).
The fit estimated a largest request of 7,605 tokens. The real run then reported 7,606, so the estimate held. Thresholds, gates, arms and hypotheses are unchanged.

### Exploratory findings

These are not in the plan and cannot change the answer.

1. **Other-section memories.** 170 memories have a valid label only in the other section. With both sections, Clef hits 114 of them, cosine 107, reranker 113 and combination 118. With one section every method hits 0 by construction (`exploratory.valid_only_in_other_section`).
2. **Both sections hurt on the older single-label key.** On 325 memories labelled in Experiments 18 and 20, Clef hits 298 with one section and 237 with both (`exploratory.old_single_label_key`). This matches the H2 loss.
3. **Clef reaches across.** 844 of 1,800 Clef tags (46.9%) with both sections come from the other section (`analysis.py`).
4. **No-label memories.** Of the 39 memories with no valid label, Clef said `none_fit` on 11 with one section and 5 with both (`exploratory.clef_none_fit_on_no_valid_label`).
5. **Tag precision stays low.** About 20 to 28 of every 100 tags are valid in all arms. Wrong tags are 1,296 to 1,448 of 1,751 to 1,800 (`arms.pooled`).
6. **Longer lists.** Clef top 4 reaches 80.9% and top 5 reaches 85.2% with both sections (`analysis.py`).
7. **Clef by set.** The Clef gain is clear on Experiment 18 (87 wins, 32 losses, p = 4.7e-07) and weaker on Experiment 20 (33 and 19, p = 0.070) (`exploratory.clef_both_vs_one_by_set`).
8. **Cosine with both sections against Clef with one section (run after the result, `analysis.py` only, not in `summary.json`).** The plan tested H2 for Clef against itself, so this comparison was missing. Cosine with both sections hits 410 of 561 (73.1%) and Clef with one section hits 346 (61.7%). The split matters:
   - On the 391 memories valid in their own section, Clef one section hits 346 (88.5%) and cosine both sections hits 303 (77.5%). Clef wins 64 pairs and loses 21 (p = 3.3e-06).
   - On the 170 memories valid only in the other section, cosine both sections hits 107 (62.9%) and Clef one section hits 0.
   - The 410 against 346 gap is therefore the 107 cross-section hits, less 43 own-section hits lost.
   - Showing both lists together, up to six tags, holds a valid label for 474 of 561 (84.5%). That is a longer list, so it is not a fair match against three tags.
9. **Mixed review list (designed after the result, `analysis.py` only, not in `summary.json`).** Clef's top three from the memory's own section, then the two labels from the other section that cosine ranks closest. Five suggestions, one Clef call.

   | Five-suggestion list                                    | Own section (391) | Other section only (170) | All (561)   |
   | ------------------------------------------------------- | ----------------- | ------------------------ | ----------- |
   | Clef top five, own section (ADR-024 before this change) | 366 = 93.6%       | 0                        | 366 = 65.2% |
   | Clef top three own section + two cosine other-section   | 352 = 90.0%       | 115 = 67.6%              | 467 = 83.2% |

   The mixed list loses 14 own-section hits (3.6 points) and gains 115 cross-section hits. About 19 in 100 of its tags are valid, against about 15 for Clef's top five. A person still picks the label, so a wrong suggestion stores nothing.

## Why it happened

1. The key accepts valid labels from either section. About 3 in 10 memories (170 of 561) fit only the other section, so a one-section arm can never hit them. That alone adds up to 30 points to the both-section gain.
2. The own-section loss is the price of a longer option list. Clef now has 42 or 57 options instead of 20 to 31, and it picks other-section labels for nearly half its tags.
3. The Clef gain is smaller than the cosine and reranker gains. Clef probably scored better within one section already, so it had less to gain. We did not test this.
4. Unexplained: why the Experiment 20 gain for Clef is weaker than on Experiment 18. The catalogue is larger (56 labels) and may crowd the option list.

## Limits

1. The key is one blind AI pass with no human check. Validity stays INCONCLUSIVE and the result cannot approve a production change.
2. The key favours both sections, because it allows labels from either section. `H2` is the only guard against that.
3. The Clef and cosine examples come from past memories with one label each, chosen by older keys.
4. 561 paired memories cannot separate methods that differ by under about 5 points.
5. Cosine time excludes the embedding step, which OMMS needs for any method.

## What this means for you

Keep Clef on the memory's own section, and add two cosine suggestions from the other section. The review list then shows a valid label for about 83 in 100 memories instead of 65, at the same cost of one Clef call (finding 9).
Do not let Clef choose from both sections, and drop the reranker and the combination.
The mixed list is exploratory evidence on an AI-made key, so it changes only what the reviewer sees.

## Artefacts

| File                       | Contents                                                       |
| -------------------------- | -------------------------------------------------------------- |
| `output/check.json`        | Gate G1 to G3 results from `--phase check`                     |
| `output/raw.json`          | New reranker (800) and Clef (600) answers, with request hashes |
| `output/summary.json`      | Hit rates, intervals, tests, decision and exploratory tables   |
| `output/run-manifest.json` | Runner and input hashes, output hashes                         |
| `run_eval.py`              | Phases `check`, `run` and `verify`                             |
| `test_run_eval.py`         | 31 tests                                                       |
| `analysis.py`              | Exploratory views from `output/`                               |
