# Experiment 21: what Experiments 01 to 20 mean for OMMS labelling

- **ID**: `21-retrieval-final-summary-2026-10-12`
- **Category**: retrieval
- **Size**: Quick (summary only; no new runs)
- **Status**: COMPLETE (2026-10-12)
- **Operator**: Dr Muhammad Aizat Md Hawari, with an agent session
- **Related**: [ADR-024](../../docs/adr/024-review-first-label-assignment.md); every report in Experiments 01 to 20

## The answer

OMMS cannot safely label new observations on its own yet. It can make labelling quick:

1. **Use catalogue version 2** (56 labels). A third fewer observations end up with no label.
2. **Show Clef's five best guesses** in the review queue, plus "No label fits". The right label is there about 9 times in 10.
3. **Keep a person, or a final agent check, confirming each first label.** Once a label is confirmed, OMMS reuses it automatically for repeats.

ADR-024 records all three.

## What to adopt

| Adopt                                   | Why                                                                 |
| --------------------------------------- | ------------------------------------------------------------------- |
| Review-first assignment (already built) | No method passed the safety bar on its own                          |
| Catalogue version 2                     | No-label share fell from 50% to 33% on unseen data (Exp 20)         |
| Clef's top five as suggestions          | Right label on screen 91% of the time (Exp 20, found after looking) |
| Automatic reuse of confirmed repeats    | Replays a person's decision exactly (Exp 07, 08)                    |

| Do not adopt                             | Why                                                                          |
| ---------------------------------------- | ---------------------------------------------------------------------------- |
| Any automatic first labelling            | Every method forces labels on observations that fit none (Exp 05 to 20)      |
| The reranker                             | No better than cosine on fresh data (Exp 18)                                 |
| A bigger embedder                        | Worse alone; only helped with an intent instruction, and not enough (Exp 16) |
| Merging similar labels                   | Fixed 1 of 13 confusions (Exp 11)                                            |
| "All methods agree" as an automatic rule | Right 97% when a label applies, but also agrees on forced labels (Exp 18)    |

## What we learned, in order

1. **The first tries failed badly.** A small classifier wrongly reused a label 59 to 68% of the time (Exp 01, 04 to 06). Confidence cut-offs and a second-opinion check could not fix it (Exp 04, 09).
2. **The answer key was partly wrong.** A re-check changed 22 of 140 labels, but the classifier still failed (Exp 10).
3. **The 2% bar could not be proven on 140 cases.** It was replaced by bars the data can show (Exp 11).
4. **The real problem was not confusing labels.** Most wrong picks were labels forced onto observations that fit none (Exp 11).
5. **Matching against past examples was safe but useless.** It accepted almost nothing, because there are only about 3 examples per label (Exp 12, 14, 16).
6. **Clef was the best judge, but not a safe one.** It never got confident enough to act alone (Exp 15).
7. **Suggestions work.** On 400 fresh observations, the methods' picks together held the right label 86% of the time, and Clef's own top three 94% (Exp 18).
8. **The catalogue was missing whole topics.** Half of real observations fit no label. 15 new labels from that gap cut it to a third (Exp 19, 20).

## How far to trust this

- **Strong direction, not proof.** From Experiment 18 on, the answer keys were made by two AI agents and not checked by a person. The experiment rules call that INCONCLUSIVE for production. You chose it, because OMMS must later work without a person.
- **Fresh data backs the main points.** Experiments 18 and 20 used 600 observations never seen before, with targets fixed before the runs.
- **One open item.** The five-suggestion figure (91%) was found after looking. A later fresh batch can confirm it; 1,036 unused observations remain.

## What is still open

1. Wire capture to create review items: task 3.2 of `review-first-assignment`. The queue is empty until then.
2. Load catalogue version 2 into OMMS; it currently lives only in the experiment files.
3. 11 held candidate labels wait for more examples.
4. Automatic first labelling: revisit only when labels have many more confirmed examples, or a method learns to say "no label fits" reliably.
