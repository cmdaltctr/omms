# Experiment 22: confidence cut-off for up to three labels per memory

- **ID**: `22-retrieval-tag-cutoff-check-2026-10-12`
- **Category**: retrieval
- **Size**: Quick
- **Status**: FAIL (2026-10-12)
- **Operator**: Dr Muhammad Aizat Md Hawari, with an agent session

## Answer

- **Question**: If OMMS tags each memory with up to three labels, can a confidence cut-off remove wrong tags without losing right ones?
- **Answer**: No. The cut-off chosen on Experiment 18 (0.08) kept its hits there, but lost 6 points of hits on Experiment 20. No rule passed on Experiment 20 by itself either. Source: `output/summary.json`, key `H1`.
- **Decision**: Tag each memory with Clef's plain top three labels, with no cut-off.
- **How sure**: Medium. Hundreds of observations, but the answer key is one AI pass with no human check.
- **Next step**: test letting Clef choose from both sections. About 3 in 10 observations fit only a label from the other section, which Clef never sees today.

## Plan (written before the run)

Plan only. Running it needs the operator's approval.

**Why**: the operator chose to tag each memory with up to three labels, with no human review. A third of observations fit no label, so they would get three wrong tags. A cut-off on Clef's own probability may drop tags it is unsure of.

**Change and baseline**: baseline is the top three labels with no cut-off. The change is a cut-off rule on those three.

**Rules tested** (fixed here, before the run; "tags" never include `none_fit`):

- **Rule A, label cut-off `t`**: keep each of the top three labels only if its probability is at least `t`. Grid: `t` = 0.03, 0.05, 0.08, 0.10, 0.15, 0.20.
- **Rule B, no-fit block `n`**: tag nothing when Clef's `none_fit` probability is at least `n`. Otherwise keep the top three. Grid: `n` = 0.10, 0.20, 0.30.
- **Baseline**: top three, no cut-off.

**Data** (saved results only; no model calls, no new labelling):

- **Selection set**: Experiment 18's Clef probabilities (`18-.../output/raw.json`, key `clef`) and its frozen reference (`18-.../corpus/fresh-reference.json`). Catalogue version 1, 41 labels.
- **Test set**: Experiment 20's Clef probabilities (`20-.../output/raw.json`) and its frozen reference (`20-.../corpus/reference.json`). Catalogue version 2, 56 labels.
- Only items the reference labelled, or marked `none_fit`, are scored. `uncertain` and `disputed` items are left out, as in Experiments 18 and 20.

**Measures** (per rule, per set):

- **Hit rate**: share of labelled items whose right label is among the tags.
- **Junk tags**: number of tags given to `none_fit` items. Share of `none_fit` items that get any tag.
- **Tag precision**: right tags divided by all tags on labelled items.
- **Untagged share** and **average tags per item**.

**Hypotheses**

- **H1**: some rule cuts junk tags by at least 30% against the baseline while its hit rate falls by no more than 3 percentage points.
- **H0**: no rule does both.

**Pass when**: choose the rule on Experiment 18 (the passing rule with the fewest total tags; ties go to the higher hit rate). That rule must also meet both conditions on Experiment 20. If no rule passes on Experiment 18, the answer is "no": keep plain top three.

**Statistics (basic)**: counts, percentages and 95% Wilson intervals for hit rate and junk share. No significance tests. The catalogues differ (41 against 56 labels), so probabilities are spread differently. Say so in the report.

**Also reported, as descriptive only**: the best rule picked on Experiment 20 itself, and the baseline numbers for top 1, 2 and 3.

**Run**: `python3 -I cutoff_check.py` from this folder. Output: `output/summary.json`. One script, plus a test `test_cutoff_check.py` that fails if the rule maths is broken.

### Amendment 1 (2026-10-12, before any Clef result was scored)

**Why**: the old key allows one label per observation. Extra tags that are also valid count as wrong. The operator approved a multi-label key. A fresh blind agent listed up to three valid labels for all 600 observations (`corpus/multilabel-18.json`, `corpus/multilabel-20.json`). It read only the two `label-input.json` files.

**What the new key shows before scoring** (comparison of keys only; no Clef output read):

| Set                | Old `none_fit` items the new key tags | Old labelled items whose old label is missing from the new list | New key: items with no label |
| ------------------ | ------------------------------------: | --------------------------------------------------------------: | ---------------------------: |
| Exp 18 (41 labels) |                            172 of 195 |                                                       31 of 197 |                    23 of 400 |
| Exp 20 (56 labels) |                              49 of 64 |                                                       36 of 128 |                    16 of 200 |

The two keys disagree on what "fits". The old key asked for the primary intent and respected exclusions strictly. The new key asks whether a label is valid at all. A spot check of 11 disagreements found most new tags reasonable. That check is AI-only.

**Change to the plan**:

- **Primary key** is now the multi-label key. Every observation counts, including old `uncertain` and `disputed` ones (400 and 200).
- **Hit rate**: share of observations with at least one valid label whose tags include at least one valid label.
- **Wrong tags**: tags not in the valid list, on any observation. This replaces "junk tags", because only 23 and 16 observations now fit nothing.
- **Tag precision**: valid tags divided by all tags.
- **H1**: some rule cuts wrong tags by at least 30% against the baseline while its hit rate falls by no more than 3 percentage points. Selection on Experiment 18 and confirmation on Experiment 20 stay as planned.
- **Old key**: the original measures are still reported, as secondary.
- Clef scores only labels in the observation's own section. A valid label from the other section can never be tagged. Such labels stay in the key and lower the measures. The report counts them.

## Results

Run: `python3 -I cutoff_check.py`. Tests: 6 pass in `test_cutoff_check.py`. Seven deliberate faults, each in a throwaway copy, made a test fail.

### H1, against the multi-label key

"Hit" means at least one tag is a valid label. "Wrong" counts tags that are not valid.

| Set    | Rule                  |       Hits | Hit rate |  Tags | Wrong tags | Wrong-tag cut |   Hit loss |
| ------ | --------------------- | ---------: | -------: | ----: | ---------: | ------------: | ---------: |
| Exp 18 | Top three (baseline)  | 226 of 377 |    59.9% | 1,200 |        938 |               |            |
| Exp 18 | Cut-off 0.08 (chosen) | 215 of 377 |    57.0% |   831 |        593 |         36.8% | 2.9 points |
| Exp 20 | Top three (baseline)  | 120 of 184 |    65.2% |   600 |        460 |               |            |
| Exp 20 | Cut-off 0.08          | 109 of 184 |    59.2% |   367 |        247 |         46.3% | 6.0 points |

The rule passed on Experiment 18 and failed on Experiment 20, where it lost 11 hits. No rule passed on Experiment 20 by itself (`descriptive.best_rule_chosen_on_exp20_itself` is null). The no-fit block lost hits at every value. Source: `output/summary.json`, keys `H1` and `results`.

95% intervals for the baseline hit rate: Exp 18 54.9% to 64.8%; Exp 20 58.1% to 71.7% (`results.<set>.baseline.multi.hit_ci95`).

### Why the hit rate is low: Clef sees only one section

Clef scores only labels in the observation's own section (preferences or patterns). The new key allows labels from either section.

| Set    | Observations with a valid label | Valid only in the other section | Top-three hit where a same-section label is valid |
| ------ | ------------------------------: | ------------------------------: | ------------------------------------------------: |
| Exp 18 |                             377 |                       118 (31%) |                                226 of 259 (87.3%) |
| Exp 20 |                             184 |                        52 (28%) |                                120 of 132 (90.9%) |

Exploratory: computed after the run from the same files; not in the frozen plan. Most of the missing hits are observations that Clef could never tag correctly. Of the 118 in Experiment 18, 96 were `none_fit` in the old key.

### Old key (secondary, as first planned)

| Set    | Rule         | Right label in tags | `none_fit` items given any tag |
| ------ | ------------ | ------------------: | -----------------------------: |
| Exp 18 | Top three    |  186 of 197 (94.4%) |                     195 of 195 |
| Exp 18 | Cut-off 0.08 |  177 of 197 (89.8%) |                     187 of 195 |
| Exp 20 | Top three    |  112 of 128 (87.5%) |                       64 of 64 |
| Exp 20 | Cut-off 0.08 |  102 of 128 (79.7%) |                       62 of 64 |

Under the old key too, the cut-off loses right labels and barely reduces tags on `none_fit` items. Source: `results.<set>.<rule>.old`.

## What this means

1. **Use plain top three.** The cut-off trades right tags for fewer wrong ones at about the same rate. It does not hold across catalogues.
2. **Few observations fit nothing.** The new key finds a valid label for 94% (377 of 400) and 92% (184 of 200). The old "a third fit nothing" came from a stricter key.
3. **The big gain is across sections.** About 3 in 10 observations fit only a label from the other section. Letting Clef score all labels could recover many of them. This needs new Clef calls, so it is a new experiment.

## Limits

1. Exploratory. Experiment 20's data was already inspected, so a pass cannot approve a production change.
2. The multi-label key is one blind AI pass with no second pass and no human check. Validity stays INCONCLUSIVE by `../AGENTS.md`. It is more generous than the old two-pass key.
3. The labelling instruction allowed labels from the other section. The old labellers were not told either way.
4. A cut-off chosen on version 1 may not carry over to version 2. That is what happened.
