# Tasks

These tasks cover implementation and evaluation after proposal approval. Planning alone completes none of them. Installs, downloads, real-data preparation and hosted inference need the separate approvals described in the protocols.

## 1. Prepare safe experiment tooling

- [x] 1.1 Obtain setup approval, create `experiments/pyproject.toml` with an experiment-only `uv` lockfile, and add local-data ignore rules; verify approved dependencies install and `git check-ignore` covers corpus, output, models, virtual environments and notebooks.
- [x] 1.2 Implement the read-only snapshot and redaction helper under `experiments/`; verify synthetic database tests preserve source files and reject live output paths, symlinks, private content and unredacted secrets.
- [x] 1.3 Implement manifest validation with source/corpus hashes, split groups, model pins, fixed reference time and approvals; verify missing fields, leaked groups, changed hashes and absent transfer permission fail before any model call.
- [x] 1.4 Implement atomic result checkpoints and explicit failed-record retries; verify interruption preserves the last checkpoint, matching resume skips completed work, and changed evaluation settings refuse resume.
- [x] 1.5 Document setup, preparation and resume commands in `experiments/EXP_README.md`; verify commands against synthetic fixtures and record a failing check when the relevant implementation is removed or broken.

## 2. Implement label comparisons

- [x] 2.1 Implement catalogue validation, reviewed-alias normalisation and fixed 16-label shortlists plus `none_fit`; verify synthetic cases cover spelling variants, related concepts, absent labels and preserved section membership.
- [x] 2.2 Implement embedding and current-language-model controls using the fixed observation and options; verify all controls receive the same case and candidate IDs, with invalid outputs recorded as failures.
- [x] 2.3 Implement `01-label-decisions-2026-10-07/run_eval.py` with development/test splits, per-method thresholds and checkpoint/resume; verify mocked model tests retain failures and keep test cases out of development tuning.
- [x] 2.4 Implement the label summariser and gates `L-G1` through `L-G5`; verify hand-calculated fixtures cover exact boundaries, undefined wrong-reuse rates, incomplete cells and insufficient lift headroom.
- [ ] 2.5 Update the label protocol with the implemented interface; verify documented commands run on synthetic data and each test fails when its check is removed or broken.

## 3. Implement retrieval comparisons

- [ ] 3.1 Create Bun fixture helpers for current project ranking, static profile selection and shared context packing with isolated storage and muted content logs; verify synthetic fixtures preserve scope, session exclusions, reference time and source text.
- [ ] 3.2 Prepare frozen top-20 candidates for project memories, preferences and patterns using one embedding model; verify matched arms receive identical candidates and full-corpus candidate recall reports omitted evidence.
- [ ] 3.3 Implement `02-retrieval-decisions-2026-10-07/run_eval.py` with per-candidate relevance, equal count limits, thresholds and final packing; verify synthetic cases cover empty selections, standing preferences, quoted hostile instructions and truncated evidence.
- [ ] 3.4 Implement the retrieval summariser and gates `R-G1` through `R-G6`; verify hand-calculated fixtures cover channel-specific verdicts, no-relevance requests, paired added P95 delay and 2000-token budget checks.
- [ ] 3.5 Update the retrieval protocol with the implemented interface; verify its commands on synthetic data and confirm each test fails when its check is removed or broken.

## 4. Connect approved model endpoints

- [x] 4.1 Pin the approved current language model and implement constrained decision calls; verify mocked responses keep self-reported scores distinct from calibrated probabilities and redact provider errors.
- [x] 4.2 Implement Jev Choice and Noul calls behind explicit transfer and spending checks; verify mocked responses validate candidate IDs, numeric ranges, timeout records, rate-limit handling and model IDs.
- [ ] 4.3 Obtain download approval and load a pinned Julia-1 revision in the experiment environment; verify local synthetic Choice and Noul probes, the 17-option label request and strict overflow rejection.
- [x] 4.4 Record the optional OpenJev repository/backend and the optional Needle revision and weight checksum, or an explicit BLOCKED reason for each; verify included arms have complete pins, Needle runs only with `NEEDLE_TELEMETRY=0` and `DO_NOT_TRACK=1` set and refuses to start otherwise, and omitted arms remain visible in the manifest and report.
- [ ] 4.5 Document provider setup and request accounting in the experiment index; verify credentials and source text are absent from captured logs and ordinary test runs make no hosted calls.

## 5. Prepare and run the label pilot

- [x] 5.1 Obtain corpus approval and prepare 200 reviewed label cases with a 60/140 grouped split; verify every case has reviewed outcomes, catalogue provenance, redaction and recorded candidate coverage.
- [x] 5.2 Approve the label gates, model-call scope and spending limit before development inference; verify the manifest records these approvals and rejects an unapproved hosted arm.
- [x] 5.3 Run label development cells and freeze questions, thresholds, order and model settings; verify the frozen hashes are saved before opening test results.
- [x] 5.4 Run the 140-case label test with checkpoint/resume; verify all required records are accounted for and failures remain in the result set.
- [x] 5.5 Write the label `report.md`, summary JSON and read-only `analysis.py`; verify metrics reproduce from raw JSON, notebook output stays ignored and the report records PASS, FAIL or INCONCLUSIVE with limitations.

## 6. Prepare and run the retrieval pilot

- [ ] 6.1 Obtain corpus approval and prepare 100 reviewed retrieval requests with a 30/70 grouped split and 20 no-relevance cases; verify full-corpus evidence IDs, reviewed spans, exclusions and the six/14 no-relevance split.
- [ ] 6.2 Approve retrieval gates, model-call scope and spending limit; verify all arms share frozen candidates, budgets and count limits before development inference.
- [ ] 6.3 Run retrieval development cells and freeze relevance questions, thresholds, batching and concurrency; verify frozen hashes are recorded before test inference.
- [ ] 6.4 Run the 70-request retrieval test with paired latency records; verify final packed evidence, errors, scope checks and checkpoint/resume records are complete.
- [ ] 6.5 Write the retrieval `report.md`, summary JSON and read-only `analysis.py`; verify per-channel gates reproduce from raw data and report the separate effects of profile embeddings and model decisions.

## 7. Prepare and run the pair-decision pilot

- [x] 7.1 Implement pair candidate generation from a read-only snapshot using the production rules (same category; duplicate similarity 0.5 or more; conflict similarity 0.65 up to 0.9) and a blind review file export; verify synthetic fixtures cover band edges, cross-category exclusion, shared-entry grouping, and a review file that holds no model answer, score or similarity.
- [x] 7.2 Implement `03-pair-decisions-2026-10-10/run_eval.py` with arms `P0` to `P3` and the optional `P4-julia` and `P5-needle` when pinned (the Needle arm reads one enum field and keeps its confidence apart from calibrated probabilities), a pinned copy of the production prompts, A/B swap checks and checkpoint/resume; verify mocked tests count timeouts and invalid answers as wrong, route hybrid fallback correctly, repeat the current-model control, and keep test pairs out of development tuning.
- [x] 7.3 Implement the pair summariser and gates `P-G1` through `P-G6`, then update the pair protocol with the implemented interface; verify hand-calculated fixtures cover exact boundaries, undefined false-merge rates, too few contradictions, incomplete cells and decision time per 60 pairs.
- [ ] 7.4 Obtain corpus approval and prepare 200 duplicate pairs (60/140 grouped split) and 150 conflict pairs (45/105 grouped split), each reviewed blind; verify reasons, redaction, the number of pairs scanned and at least 30 reviewed contradictions in the conflict test split, or record INCONCLUSIVE.
- [x] 7.5 Approve the pair gates (including the speed-up factor and fallback limit), model-call scope and spending limit; verify the manifest records these approvals and rejects an unapproved hosted arm.
- [x] 7.6 Run pair development cells, freeze question wording, thresholds and the hybrid band, then run the test split with checkpoint/resume; verify frozen hashes are saved before test results are opened and all required records are accounted for.
- [x] 7.7 Write the pair `report.md`, summary JSON and read-only `analysis.py`; verify metrics reproduce from raw JSON, the report records PASS, FAIL or INCONCLUSIVE per decision, and the duplicate-cache key finding is recorded as a separate follow-up.

## 8. Verify the complete change

- [ ] 8.1 Update `experiments/EXP_README.md` and all three protocol statuses from the reports; verify all links resolve and no real corpus or result files are tracked.
- [ ] 8.2 Run the focused experiment tests and broader integration checks after approval for the full suite, including `bun run ci:local`; verify the production package, host boundaries and existing behaviour pass unchanged.
- [ ] 8.3 Run `/opsx-verify evaluate-memory-decision-models` and `openspec validate evaluate-memory-decision-models --strict`; verify all implementation findings are resolved and report actual commands and outcomes.
- [ ] 8.4 Record separate follow-up recommendations and any approved local cleanup in the reports; verify no pilot verdict changes a production setting, integrates Jev or removes live data.
