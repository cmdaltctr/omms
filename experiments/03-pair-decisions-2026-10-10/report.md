# Experiment 03: pair decisions, cheaper models against DeepSeek

**Verdict: INCONCLUSIVE for merge safety.** Both runs used AI-made answer keys, not a human review.

This experiment has two runs on 2026-10-10. Run 1 compared Jev, the Jev+DeepSeek hybrid and local Clef with DeepSeek. Run 2 dropped Jev and the hybrid by user decision, and re-tested DeepSeek against local Clef on a larger pair set. Run 2 adds to Run 1; it does not replace it.

The questions are the same in both runs:

- Duplicate: do A and B mean the same thing, so one can be merged away?
- Conflict: do A and B contradict each other?

No production memories were merged or edited in either run.

## Run 1: Jev, hybrid and Clef against DeepSeek

- 213 real pairs from a snapshot of the memory store (141 test pairs: 105 duplicate, 36 conflict).
- Answer key: AI draft (`corpus/ai-labelled-draft.json`), strict labeller, 6 `same` duplicates and no contradictions.
- Hybrid: Jev answers, and DeepSeek decides when Jev is unsure.

| Model | Matches DeepSeek, duplicates | Matches DeepSeek, conflicts | Matches AI key, duplicates | Seconds per pair |
| --- | --- | --- | --- | --- |
| DeepSeek | reference | reference | 91.9% | about 2.0 |
| Jev | 95.2% | 100% | 94.3% | about 0.5 |
| Hybrid (Jev, DeepSeek when unsure) | 95.2% | 100% | 94.3% | about 0.5 (fell back on 1 to 3% of pairs) |
| Clef (local) | 91.4% | 97.2% | 88.6% | about 0.26 (local, US$0) |

What Run 1 found:

- Jev and the hybrid gave the same answers as DeepSeek on most pairs, about 4x faster. Run 1 cost US$0.16 in known API usage across DeepSeek and Jev. Jev never said YES to a duplicate, so it was safe but merged nothing.
- Clef was the fastest, about 8x DeepSeek and 2x Jev. Clef and Jev agreed on 130 of 141 test pairs; in all 11 differences Clef said YES and Jev said NO.
- Against this strict key, DeepSeek and Clef both made wrong YES answers on duplicates (DeepSeek 7 of 10 YES across two runs, Clef 8 of 10).

Full Run 1 detail: `output/ai-pilot/report.md` and `output/clef/` (ignored; rerun with `run_ai_pilot.py`, `recover_ai_pilot.py` and `run_clef.py`).

## Run 2: DeepSeek against local Clef on corpus v2

- 282 real pairs (corpus v2 adds 69 likely duplicates) and 80 made-up "challenge" pairs with clear answers.
- Answer key: new AI labels (`corpus/ai-review-export.json`, `corpus/ai-challenge-export.json`), 10 `same` in the test duplicates.
- Clef needs a cut-off. The rule picked 0.9 on the practice pairs. Clef at 0.8 is shown as an extra, chosen after the test.

| Pairs | DeepSeek (per run) | Clef at 0.9 (locked) | Clef at 0.8 (after test) |
| --- | --- | --- | --- |
| Real duplicates (10 of 105 are true) | 2 found, 0 wrong | 0 found, 0 wrong | 4 found, 0 wrong |
| Real conflicts (none of 36 are true) | 0 wrong | 1 wrong (at its 0.5 conflict cut-off) | 0 wrong |
| Challenge duplicates (20 true) | 19 to 20 found, 0 wrong | 18 found, 0 wrong | 20 found, 0 wrong |
| Challenge contradictions (24 true) | 24 found, 0 wrong | 24 found, 0 wrong | 24 found, 0 wrong |
| Seconds per pair | 1.2 to 1.9 | 0.24 to 0.27 | 0.24 to 0.27 |

Both models also said YES to a few real pairs the key marked "unsure": DeepSeek 2 per run, Clef 2 at 0.9 and 6 at 0.8. Cost: US$0.29 for 1,006 DeepSeek calls; Clef US$0.

What Run 2 found:

- Clef at 0.8 matched or beat DeepSeek on every row, about 7x faster and free.
- Neither model merged anything the key called different.
- Both models miss most real duplicates. The real store has few clear duplicates and no real contradictions.

## Across both runs

- Speed: Clef is the fastest (about 0.26 s), then Jev and the hybrid (about 0.5 s), then DeepSeek (about 2 s).
- Wrong YES answers depend on the answer key. Run 1's strict key counts several DeepSeek and Clef duplicate YES answers as wrong; Run 2's key counts none. The two keys were written by different AI labellers, so the runs cannot be compared number for number.

## Why it is not proof

1. Both answer keys are AI-made, not a human review.
2. Run 2's 0.8 cut-off was picked after seeing test results.
3. There are too few true duplicates and no real contradictions. Proving a false-merge rate below 5% needs at least 73 correct YES answers with no wrong ones.

## Next steps

1. Label the pairs yourself with `corpus/review.html` and `corpus/challenge-review.html`. Then rerun with Clef fixed at 0.8 before the test, and add Jev back if you want it compared.
2. Collect a larger set of real pairs with more true duplicates and some real contradictions.

## Files and rerun

- Protocol: `protocol.md`. Rerun commands: `../EXP_README.md`.
- Run 1: `run_ai_pilot.py`, `recover_ai_pilot.py`, `run_clef.py`, `analysis.py`; results in `output/ai-pilot/` and `output/clef/`.
- Run 2: `run_review_pilot.py`, `../review_pilot.py`, `rescore_clef.py`; results in `output/review-pilot/`.
- Manifests and labels live in `corpus/` and raw results in `output/`. Both are ignored by git and can be rerun.
