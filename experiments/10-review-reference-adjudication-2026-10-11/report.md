# Experiment 10: blind adjudication of the reference labels

- **ID**: `10-review-reference-adjudication-2026-10-11`
- **Category**: review
- **Size**: Standard
- **Status**: COMPLETE — reference frozen; 22 of 140 labels changed; Experiment 06 verdict unchanged (2026-10-11)
- **Operator**: Dr Muhammad Aizat Md Hawari, with implementation and agent sessions
- **Related**: [evaluate-memory-decision-models change](../../openspec/changes/evaluate-memory-decision-models/proposal.md); Experiments 01, 05, 06 and 09

## Answer

- **Question**: Do the AI-authored test-case labels survive independent adjudication, and does the Experiment 06 verdict change on the new reference?
- **Answer**: No and no. The new reference disagrees with the old AI reference on 22 of 140 cases (15.7%). Re-scored on it, Experiment 06 keeps 71 picks with 29 correct and 42 wrong: wrong reuse 59.15% against the 2% limit. Source: `output/summary.json`.
- **Decision**: The frozen reference replaces the AI-authored one for future work. The Experiment 05, 06 and 09 conclusions stand: first-assignment reuse is far below the bar either way. Catalogue consolidation proceeds on the disagreement clusters.
- **How sure**: The 10 hardest cases carry individual human decisions; the 124 two-agent-agreed cases were accepted wholesale by operator instruction. Batch-confirmation risk is recorded; validity is OPERATOR-ARBITRATED, not blind solo human adjudication.
- **Next step**: Step 2 of the recovery sequence: consolidate the catalogue using the disagreement clusters, then re-baseline.

## What ran

1. An independent agent drafted all 140 cases from blind inputs (descriptions, sections, definitions only): 64 label picks, 75 `none_fit`, 1 `uncertain`. Source: `corpus/agent-draft-decisions.json`.
2. A second agent judged all 140 blind: 124 agree, 16 disagree. Source: `corpus/agent-judge-verdicts.json`.
3. The drafter reconsidered the 16: 9 kept, 6 conceded, 1 other. 130 cases ended with two agents agreeing. Source: `corpus/agent-draft-response.json`.
4. The operator arbitrated the 10 remaining disputes (judge's labels taken) and accepted the 130 consensus cases wholesale. Source: `plan.json` amendments 1 to 4.
5. `finalise_reference.py --resume` froze the reference; `--verify` reproduced it with zero writes. All three agent files are pinned by SHA-256 inside the frozen reference.

## Results

### Agreement with the old AI reference

| Measure                                          | Value      |
| ------------------------------------------------ | ---------- |
| Cases                                            | 140        |
| Disagree                                         | 22 (15.7%) |
| Old reference said existing, new differs         | 6          |
| Old reference said `none_fit`, new gives a label | 16         |

The old reference was over-conservative: most changes turn `none_fit` into a real label. H1 (at least 10 disagreements) is confirmed; the AI reference does not stand as ground truth. Source: `output/summary.json`, key `agreement`.

Boundary cases: `188c3c02…` moves `pattern_git_operations` to `pattern_ci_quality`; `1f9560db…` moves `none_fit` to `pattern_configuration_tuning` (the MCP setup case the operator arbitrated). All three omitted-candidate cases keep their labels. Source: `agreement.special_cases`.

### Experiment 06 re-scored on the new reference

| Metric             | On AI reference | On new reference |
| ------------------ | --------------- | ---------------- |
| Existing picks (E) | 71              | 71               |
| Correct (C)        | 23              | 29               |
| Wrong (W)          | 48              | 42               |
| Wrong reuse (W/E)  | 67.61%          | 59.15%           |
| Gate W/E below 2%  | fail            | fail             |
| Correct `none_fit` | 49 of 69        | 45 of 69         |

The classifier looks six picks better on the new ruler and still fails by a wide margin. No earlier conclusion flips. Source: `output/summary.json`, key `rescored_experiment06`.

### Gates

G1 integrity passes: all pinned hashes verified, decisions complete and valid. G3 completeness passes: 140 of 140 cases carry one outcome each, no `uncertain` remains. G2 blindness was enforced in code: the page builder refuses to embed reference or classifier fields, and the focused tests detect an injected leak.

Focused tests: 8 passing, 8 deliberate faults detected in disposable copies. Source: `output/test-proof.json`.

## Provenance and amendments

The adjudication mode changed twice, both recorded in `plan.json` before the affected work: solo blind human adjudication became AI-drafted with human confirmation (amendment 1), then gained the judge and reconsideration rounds (amendment 2), then became batch confirmation by operator instruction (amendment 3). Amendment 4 records a verify-path fix and re-freeze with unchanged content. The frozen reference records the mode, the partial human review, and the SHA-256 of every agent file. Source: `corpus/adjudicated-reference.json`.

## Limits

- 124 of 140 labels were accepted without individual human review; two independent agents agreed on them, and the operator accepted that consensus wholesale. Batch-acceptance and confirmation-anchoring risks are recorded, not eliminated.
- The judge's labels are the reference only because the operator directed it on the disputes and accepted the consensus elsewhere; a different arbitrator could differ on the 6 label-versus-`none_fit` boundary calls.
- All agent passes used one model family; a different model may cluster differently.

## Next

Step 2 (catalogue consolidation) uses the 22 disagreements and the 10 dispute arguments: `pattern_configuration_tuning` and `pattern_agent_orchestration` definitions demand conditions real observations rarely state, and no label covers tool-ecosystem maintenance. The `review-first-assignment` OpenSpec proposal remains awaiting the operator's decision.
