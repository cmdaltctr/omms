# Experiment 08: AI-drafted assignment replay

- **ID**: `08-retrieval-draft-assignment-replay-2026-10-11`
- **Category**: retrieval
- **Size**: Quick; basic statistics; selected by the user
- **Status**: INCONCLUSIVE; functional replay PASS

## Answer

- **Question**: Can scoped exact lookup reuse eligible AI drafts while preserving saved classifier outcomes on misses?
- **Answer**: Yes for this replay. Three eligible drafts were reused, and every miss retained its saved classifier response.
- **Decision**: Keep production unchanged. Reuse works on this small sample; label accuracy remains unestablished.
- **Confidence**: High for the recorded routing. Label validity stays INCONCLUSIVE because drafts lack independent human review.
- **Next step**: Resolve catalogue gaps and obtain independent assignment evidence before evaluating real-world label quality.

## Plan (written before the run)

### Scope and authorisation

The user selected Quick, then authorised: “op1.run and don't bothermeuntilcompletedexperiment”.
This authorises AI drafts for the ten displayed observations and this small offline replay.
Individual categories have no human adjudication. Record `human_reviewed: false` and `provenance: AI_draft` for every draft.
These records enter explicitly authorised experimental fixtures. They cannot become real human approvals or production verified history.
This is exploratory replay of inspected historical examples, with synthetic assignment events.

### Hypothesis and comparison

- **H1**: Every fixed functional gate passes across the complete replay.
- **H0**: At least one functional gate fails.
- **Decision rule**: All gates passing gives functional PASS. Any failure gives FAIL; blocked or incomplete evaluation gives INCONCLUSIVE.
- **Validity**: AI-only draft labels leave classification validity INCONCLUSIVE, regardless of the functional verdict.

Baseline returns each complete saved Experiment 05 response, including errors and status fields.
Candidate first looks up an eligible AI-draft fixture assignment, then returns that identical baseline response on a miss.
The sole intervention admits these provisional assignments experimentally under Experiment 07's scoped exact lookup policy.
Preserve its key: `(owner, section, project, catalogue_revision, exact_description)`.
Compare decoded strings exactly; missing scope fields cannot act as wildcards.
Require the label in both the section catalogue and that query's candidate options.
Preserve correction precedence, explicit supersession and ambiguous-conflict misses from Experiment 07.
Do not cache `none_fit`, errors or review abstention. Introduce no catalogue IDs, extraction, aliases or fuzzy matching.

### Frozen drafts and selection

Sort original `split == test` IDs lexically. The first ten are the displayed seed observations.
Freeze these drafts before execution; derive descriptions and section membership from the saved corpus.
The drafts are independent input decisions for replay, not the original answer key or independent truth.

| Seed ID | Fixed draft | Catalogue-gap suggestion or caveat |
| --- | --- | --- |
| `0170dd69da3fa2576c9b25b3` | `none_fit` | Concurrent sessions |
| `023f21c87c7df03969c06b40` | `none_fit` | Self-contained skills |
| `0428811d4086f89023c77ff0` | `none_fit` | Status confirmation |
| `04830c081b284389ce20c550` | `preference_resource_economy` | Provisional interpretation of local compute load |
| `08c8672c3f8f6d530b682553` | `none_fit` | Cloud experiment capacity |
| `08ee5fc19fa9ce070597f188` | `none_fit` | Numbered options |
| `0947dbcb5e6973b40fa87a3f` | `preference_operator_approval` | Compound approval and notification; flag the secondary intent |
| `09ed28189f24cd47b63645b7` | `none_fit` | Task-type interpretation |
| `0a53f4a9405c74244e92b361` | `none_fit` | Recorded deferrals |
| `0da8c3e9f70eea04b0d8cf50` | `preference_progress_reporting` | Provisional reporting interpretation |

Gap suggestions are descriptive future-label names only. They never enter the catalogue or assignment cache.

### Cells and fixed gates

1. Replay ten seed queries with empty assignment history, then apply the eligible draft fixture assignments.
2. Replay ten exact seed repeats within the same scope and catalogue revision.
3. Replay the next ten lexical test IDs, unseen by this assignment history, against their saved baseline responses.

Design expectations: 30 queries, three draft hits, 27 misses and zero fresh model calls.
These are planned values, not measured results. The seven `none_fit` drafts remain uncached.
Gates require all 30 queries, ten unchanged initial outcomes, three specified repeat choices, seven unchanged repeat fallbacks,
and ten unchanged unseen outcomes. Every miss must preserve the whole baseline outcome.
Reject invalid scope or labels outside candidate/catalogue membership. Every mapped result must retain AI-draft provenance and event IDs.
Never promote a draft to ground truth. Report errors separately; retain them rather than dropping affected queries.
Use basic counts by phase and source. Count avoided classifier opportunities separately from actual fresh model calls.
Do not claim accuracy validation, fresh held-out evidence, measured latency savings or production safety.

### Inputs, freeze and audit trail

Read Experiment 01's `output/revision-01-batch8192/corpus/{ground-truth,catalogue,candidates}.json` without changing it.
Read Experiment 05's `output/{eval_results,run-manifest,summary}.json` and Experiment 07's `run_eval.py` read-only.
Before replay, freeze byte hashes of these inputs, draft JSON, this plan and the runner, plus the current git commit.
Save the manifest and plan snapshot under this experiment's `output/`. Hash files in experiments 01–07, excluding regenerable caches.
Require every selected ID and response. Preserve baseline errors and classification outcomes; do not substitute evaluation answers.
Each query row records its ID, phase, baseline, outcome, source, draft provenance and assignment event IDs.
Save raw rows and summary under `output/` using `.tmp` followed by atomic rename.
Checkpoint after each cell. Matching resume reconstructs the completed event prefix and refuses changed hashes or outcomes.
Read-only verification reproduces results and checks earlier-file preservation. Preserve this plan after execution; record amendments before affected work.

### Planned commands and checks

From the verified worktree root, use the existing environment without installation or synchronisation:

```bash
D=experiments/08-retrieval-draft-assignment-replay-2026-10-11
uv run --project experiments --no-sync python -m pytest "$D/test_run_eval.py"
uv run --project experiments --no-sync python "$D/run_eval.py"
uv run --project experiments --no-sync python "$D/run_eval.py" --resume
uv run --project experiments --no-sync python "$D/run_eval.py" --verify
```

Focused tests cover scope, membership, uncached outcomes, complete fallbacks, provenance, cell ordering, hashes and resume.
Break relevant source logic in disposable copies and confirm those tests fail. Keep fault-check evidence under this experiment's output.
Commands await implementation. No installs, downloads, inference, model servers, private histories, production changes or git actions are authorised.
## Results

### Functional result: PASS

All fixed functional gates passed. Classification validity remains INCONCLUSIVE.
Sources: `output/summary.json` and the per-query rows in `output/eval_results.json`.

| Phase | Queries | Draft reuse hits | Complete baseline outcomes preserved |
| --- | ---: | ---: | ---: |
| Initial, empty history | 10 | 0 | 10 |
| Exact repeats after draft assignment | 10 | 3 | 7 |
| Observations unseen by the assignment history | 10 | 0 | 10 |
| Total | 30 | 3 | 27 |

All 27 misses preserved the complete saved response, including status and metadata.
The three hits returned the declared provisional label with supporting event IDs and AI-draft provenance.
No result claimed human review. Source: `output/eval_results.json`.

### Labels reused

| Observation | Saved Qwen label | Reused AI draft |
| --- | --- | --- |
| Lightweight models to limit compute load | `none_fit` | `preference_resource_economy` |
| Approval before merges, plus completion notification | `none_fit` | `preference_operator_approval` |
| Update reports and communicate completion | `preference_progress_reporting` | `preference_progress_reporting` |

Source: `output/eval_results.json`, repeat rows with assignment sources.
Two selected labels changed. These changes are not demonstrated accuracy improvements.
The draft for lightweight models remains a provisional interpretation of the catalogue definition.
The approval observation combines requirements; this run did not split or alter its description.

### Catalogue coverage and limits

Seven drafts selected `none_fit` and therefore remained uncached.
Their proposed topics are concurrent sessions, self-contained skills, status confirmation, cloud experiment capacity,
numbered options, task-type interpretation and recorded deferrals.
Sources: `drafts.json` and `output/summary.json`, field `uncached_none_fit_drafts`.

These suggestions identify potential catalogue gaps. They are not approved new categories.
Only three of the ten seed observations received eligible existing-label drafts.
This small inspected sample cannot estimate real-world coverage.
Unfamiliar-input classification stayed unchanged; no fresh inference assessed those labels.

### Calls and verification

The replay reduced classifier-call opportunities from 30 to 27, avoiding three opportunities.
Actual fresh model calls: zero. Source: `output/summary.json`.
These counts describe routing rather than measured latency savings.

Seven new focused tests passed. All seven detected corresponding deliberate faults in disposable copies.
Experiment 07's 13 focused tests also passed unchanged.
Evidence: `fault-proof.json` and `output/verification.json`.
The first combined test invocation stopped during collection because both files share the same module basename.
Running each test file in its own process resolved that test-loader conflict.

The initial run, matching resume and read-only verification completed.
The frozen plan remained unchanged. Preservation hashes matched 1,154 earlier experiment files.
Sources: `output/run-manifest.json`, `output/summary.json` and `output/verification.json`.

An additional verification of Experiment 07 stopped with `fingerprint_drift`.
Its current plan abbreviates the Receipt Scanner path; the frozen plan records the full path.
This difference existed before Experiment 08 froze its preservation hashes. Its runner and earlier input files still match.
Experiment 08's own verification passed. No Experiment 07 file was changed during this follow-up.

For a later Experiment 07 re-verification:

1. Obtain approval to restore the exact frozen path text, or record a separate documentation amendment.
2. Preserve its original manifest and numerical results.
3. Re-run its read-only verification after resolving the plan-text difference.

No downloads, installations, model servers, production changes, commits or pushes occurred.
The replay remains separate from Experiment 07's completed synthetic benchmark.
