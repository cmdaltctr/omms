# Experiment 18: fresh-data confirmation of cosine, reranker and Clef together

- **ID**: `18-retrieval-fresh-confirmation-all-methods-2026-10-12`
- **Category**: retrieval
- **Size**: Confirmatory (plan committed in `571b393` before selection, labelling or any model run)
- **Status**: PASS on H1 and H2; H4 FAIL as predicted (2026-10-12)
- **Operator**: Dr Muhammad Aizat Md Hawari, with an agent session
- **Related**: [protocol](protocol.md); [ADR-024](../../docs/adr/024-review-first-label-assignment.md); Experiments 15, 16 and 17

## Answer

- **Question**: Do the Experiment 17 findings hold on 400 fresh observations: three methods' picks together contain the right label, and their agreement marks a right label?
- **Answer**: Mostly yes. The three picks contain the right label for 169 of 197 labelled cases (85.8%; target 85%). When all three agree, they are right 60 of 62 times (96.8%; target 90%). Automatic labelling still fails: "all agree" also fires on 17 cases where no label fits. Source: `output/summary.json`.
- **Decision**: Keep review-first assignment (ADR-024). Show suggestions in the review queue, and mark "all agree" picks as likely right when a label applies. Clef is clearly the best single method; the reranker is not better than cosine.
- **How sure**: High on direction: 400 fresh cases, plan fixed in advance, two-pass AI reference with 90.5% raw agreement. Validity for production stays INCONCLUSIVE, because the reference is AI-made (`../AGENTS.md`).
- **Next step**: Experiment 19 summarises Experiments 01 to 18. A follow-up could confirm Clef's own top three as the review list (see exploratory results).

## What ran

1. **Selection**: 400 of the 1,636 never-used snapshot entries, 200 per section, seed 20261012. The privacy filter excluded 3 entries with home-folder paths. No overlap with the 200 old cases. Source: `output/selection.json`.
2. **Labelling**: two blind AI agents labelled all 400. They agreed on 362 (90.5%; G5 needs 75%). The drafter reviewed the 38 disagreements: 30 conceded, 8 kept. Final reference: 197 labelled, 195 `none_fit`, 8 disputed (left out). Source: `output/reference-manifest.json`.
3. **Freeze**: the reference was hashed before any model call. The runner refuses to start without that hash.
4. **Models**: Qwen3-Embedding-4B (intent instruction), Qwen3-Reranker-0.6B and Clef-Flash, each on its own pinned llama.cpp server. 0 errors in any method. All servers stopped afterwards.
5. **Verify**: `--phase verify` rebuilt every request, matched each saved request hash and reproduced the summary without servers.

Tests: 15 focused tests pass. 12 deliberate faults in throwaway copies each made at least one test fail.

## Results

### Frozen hypotheses

| Hypothesis                            | Result                | 95% interval      | Target | Verdict |
| ------------------------------------- | --------------------- | ----------------- | ------ | ------- |
| H1: right label among the three picks | 169 of 197 (85.8%)    | 80.1% to 90.3%    | ≥ 85%  | holds   |
| H2: right when all three agree        | 60 of 62 (96.8%)      | 88.8% to 99.6%    | ≥ 90%  | holds   |
| H4: "all agree" as an automatic rule  | 79 accepted, 19 wrong | upper bound 33.3% | ≤ 5%   | fails   |

Source: `output/summary.json`, keys `H1`, `H2` and `H4`.

- H1 holds, but only just: the lower end of its interval is 80%.
- H2 holds. But all three methods also agree on 17 of 195 cases where no label fits. So agreement means "right label, if one applies".
- H4 fails, as predicted: 17 of its 19 wrong picks are forced labels on `none_fit` cases.

### First pick right, out of 197 labelled cases (H3)

| Method                       | Right | 95% interval   | Seconds per item |
| ---------------------------- | ----: | -------------- | ---------------: |
| Cosine (4B embedder)         |   105 | 46.1% to 60.4% |             ~0.0 |
| Reranker (label definitions) |   102 | 44.6% to 58.9% |              0.4 |
| Clef                         |   141 | 64.7% to 77.8% |              3.2 |
| Majority vote, ties to Clef  |   142 | 65.3% to 78.2% |                – |

Paired sign tests: Clef beats cosine (53 against 17, p < 0.001) and the reranker (56 against 17, p < 0.001). The reranker against cosine: 36 against 39, p = 0.82, no difference. The vote against Clef: 8 against 7, p = 1.0. Source: `output/summary.json`, key `H3`.

**The Experiment 17 reranker result did not hold.** There it looked slightly better than cosine. On fresh data the two are the same.

### Other measures

- **Clef recognises "no label fits"** on 50 of 195 `none_fit` cases (26%). The other two methods cannot say it at all.
- **Right label among a method's own top three**: cosine 163, reranker 159. Source: `output/summary.json`, key `top3_right`.

### Exploratory (found after looking at these results)

| Suggestion list                                | Right label on screen (of 197) |
| ---------------------------------------------- | -----------------------------: |
| **Clef's own top three, by its probabilities** |                **186 (94.4%)** |
| Clef's top two plus the cosine pick            |                    172 (87.3%) |
| Three methods' first picks (H1)                |                    169 (85.8%) |
| Cosine's top three                             |                    163 (82.7%) |

Source: `analysis.py`, from `output/raw.json`.

Clef alone, showing its three most likely labels, beats the three-method list. That needs one model call per item, not three. It was found after looking, so it needs its own confirmation.

## Limits

- The reference is AI-made: two blind agents and a reconciliation round. No person checked it. By the experiment rules this keeps production validity INCONCLUSIVE. The operator chose this on 2026-10-12, because OMMS must later label without a person.
- The gallery of examples is the old 200 cases, about 3 per label. Development labels in it are AI-authored.
- 8 disputed cases are left out. That is 2% of the set.
- About half the fresh observations fit no catalogue label. The catalogue is still the main gap.

## What this means

1. **The review queue should show suggestions.** The evidence favours Clef's own top three (94%) over mixing three methods (86%).
2. **"All agree" is a useful hint, not an automatic rule.** Right 97% of the time when a label applies, but it also fires on forced labels.
3. **Automatic first labelling stays closed.** Forcing labels on observations that fit none is the unsolved problem.
4. **Drop the reranker.** It adds no accuracy over cosine.
