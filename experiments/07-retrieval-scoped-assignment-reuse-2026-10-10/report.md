# Experiment 07: scoped assignment reuse and correction precedence

- **ID**: `07-retrieval-scoped-assignment-reuse-2026-10-10`
- **Category**: retrieval
- **Size**: Quick, selected by the user
- **Status**: INCONCLUSIVE; functional replay PASS
- **Operator**: Dr Muhammad Aizat Md Hawari, with an implementation agent after approval
- **OpenSpec context**: [evaluate-memory-decision-models](../../openspec/changes/evaluate-memory-decision-models/proposal.md)

## Answer

- **Question**: Can exact scoped reuse honour verified assignments and corrections while preserving classifier responses on misses?
- **Answer**: Yes for the controlled replay. Scoped reuse honoured assignments and corrections while preserving every fallback response.
- **Decision**: Keep production unchanged. The replay supports further evaluation of this reuse policy.
- **How sure**: High for these deterministic fixtures. Real-world assignment quality and reuse coverage remain unmeasured.
- **Next step**: Evaluate independently approved historical assignments before deciding whether to propose production integration.

## Plan (written before the run)

### Question, change and baseline

Test one decision pipeline: look up an eligible verified assignment before using the unchanged classifier response.
Exact reuse means matching the full observation string within the same declared scope.
Explicit corrections take precedence over earlier approvals.
Keep category assignment separate from merging observations. Leave extraction, tags, aliases and fuzzy matching outside scope.

- **H1**: Reuse honours every eligible assignment and correction, avoids their classifier calls, and preserves every miss response.
- **H0**: At least one functional gate fails.
- **Pass when**: Every fixed gate below passes across the complete offline replay.
- **Data**: 48 synthetic observation queries plus the original 140-case set with empty verified history.
- **Stats**: Basic deterministic counts. No population confidence intervals or safety-rate claim.

### Evidence and proposed transfer from Receipt Scanner

Receipt Scanner looks up historical category assignments before classifying unfamiliar descriptions.
Its query prioritises corrected rows, followed by recent rows.

Evidence in `.../PROJECTS/receipt-scanner-tracker/`:

- `app/Services/CategoryInference/CategoryInferer.php:59-93,203-227`: exact lookup and classification of misses.
- `app/Services/Receipt/ReceiptEditorService.php:128-190`: persistence of edits and correction flags.

That correction flag can follow edits unrelated to category approval.
The inspected historical query also lacks project scope and an ambiguity rule.
This experiment therefore requires explicit approval events and the eligibility rules below.
Their effects remain untested proposals.

OMMS's current exact category-and-description match happens during merging after model analysis.
Source: `src/services/user-profile/user-profile-manager.ts:674-689`.
This proposed lookup serves category selection before classification.
No new library, persistent database or production architecture decision is selected here.
A production proposal and ADR would follow separately if the evidence warrants them.

### Paired arms and frozen baseline

| Arm | Behaviour |
| --- | --- |
| Baseline | Return the frozen classifier response for every query. Ignore assignment history. |
| Candidate | Return an eligible verified assignment; otherwise return that identical classifier response. |

Pin Experiment 05's Qwen answers as the baseline before implementation.
Do not choose between Experiment 05 and Experiment 06 after seeing replay outcomes.
Experiment 07 can run independently of Experiment 06 and requires zero fresh inference calls.

Use these earlier files read-only:

- `../05-retrieval-qwen-label-decisions-2026-10-10/output/eval_results.json`.
- Its `output/run-manifest.json`, `output/summary.json` and `run_eval.py`.
- Experiment 01's `output/revision-01-batch8192/corpus/{ground-truth,catalogue,candidates}.json`.

Before execution, save file-byte hashes, the current commit and this report's hash in `output/run-manifest.json`.
Reproduce baseline counts and verify all 140 unique IDs before replay.
Changing the saved classifier baseline requires an approved amendment before execution.

### Fixed lookup and correction policy

Key: `(owner, section, project, catalogue_revision, exact_description)`.

1. Compare decoded strings exactly. Do not normalise case, whitespace, punctuation or Unicode.
2. Require every scope field. Missing fields cannot act as wildcards.
3. Admit assignments through explicit approval or correction events only.
4. Require an existing label in both the current section catalogue and allowed candidate options.
5. An explicit current correction overrides earlier approved assignments for the same key.
6. A subsequent correction must explicitly supersede its predecessor.
7. Conflicting current records without explicit supersession cause an ambiguous miss.
8. Catalogue revision changes make previous records ineligible. Reapproval is required.
9. Model output cannot create a verified assignment or overwrite a correction.
10. On every miss, preserve the baseline response and status exactly.

Cache existing-label assignments only. Keep `none_fit`, invalid responses and review abstention uncached and distinct.
Multiple compatible records may justify the same label. Conflicting ordinary approvals also cause an ambiguous miss.
Time ordering alone cannot resolve a conflict. Future events must never affect earlier queries.

### Controlled replay: 48 queries

Create 12 scenario families, with four queries per family and at least 24 preceding state events overall.
Freeze the complete ordered event file, evaluator key and exact state-event total before executing either arm.
Start each independent trace with empty verified state.

| Family | Required behaviour |
| --- | --- |
| Approved exact assignment | Reuse the explicitly approved label. |
| Unseen description | Return the baseline unchanged. |
| Explicit correction | Override the earlier approved assignment. |
| Correction supersession | Honour an explicitly superseding correction. |
| Wrong owner | Miss. |
| Wrong section | Miss. |
| Wrong project | Miss. |
| Wrong catalogue revision | Miss. |
| Changed catalogue or removed label | Refuse stale or invalid assignments. |
| Competing current records | Record an ambiguous miss. |
| Near-exact strings | Miss on case, whitespace, punctuation and Unicode differences. |
| Invalid, none_fit and abstention | Preserve the distinct baseline outcomes. |

Synthetic approval events are declared inputs. Keep expected query outcomes in a separate evaluator file.
The decision function must not read that file.
Record each hit's preceding supporting event ID and assignment provenance.
Include queries before and after approval, plus wrong model suggestions after correction.
Supply at least eight eligible reuse queries, including at least eight queries testing correction precedence.
The eight correction queries span the correction and supersession families.

Both arms receive identical frozen synthetic classifier responses.
These fixtures test event handling, not Qwen's ability to classify new synthetic descriptions.
Synthetic events belong exclusively to this cell.

### Existing cases: 140 empty-history queries

Replay all original test observations using their saved Experiment 05 responses.
Keep verified history empty for both arms throughout this cell.
Never import `expected`, reference reasons or model answers into assignment history.
Both arms must return identical responses for all 140 observations.

Report the original accuracy counts separately from controlled replay outcomes.
This cell checks unchanged fallback behaviour. It cannot demonstrate improved label accuracy through caching.
Keep the original reference and all earlier experiment files unchanged.

### Fixed functional gates

Functional PASS requires all of the following:

1. Complete accounting for 48 synthetic queries and 140 empty-history queries.
2. At least eight eligible reuse queries and eight correction-precedence queries.
3. Every eligible unambiguous hit returns its approved or corrected assignment.
4. Zero wrong-scope, stale-revision, invalid-label or unresolved-conflict hits.
5. Zero model-generated approvals and zero uses of future events.
6. Every miss preserves its entire frozen classifier outcome.
7. All 140 original responses match the baseline exactly.
8. Avoided classifier-call opportunities equal eligible hits; actual fresh model calls equal zero.

A complete run failing any gate receives functional FAIL. Blocked or incomplete work receives INCONCLUSIVE.
The counts prevent an empty cache from passing. They provide no statistical safety bound.
Final real-world validity remains INCONCLUSIVE, even after a functional PASS.

### Measurements

Report previously seen and unseen queries separately.
Separate ordinary assignment hits from correction hits and each reason for a miss.
Keep synthetic expected outcomes outside the 140-case accuracy denominator.

Count baseline call opportunities, candidate call opportunities and avoided calls.
An avoided opportunity describes routing; this offline experiment makes no model calls.
Do not convert historical HTTP durations into measured wall-time savings.
Optional monotonic timing measures offline lookup time only and has no pass threshold.

### Implementation and execution after approval

Use one experiment-local `run_eval.py` with an in-memory event store, replay adapter and summariser.
Tests do not count towards the one-script limit. Do not add a database, service or shared framework.
Store event fixtures, the separate outcome key, checkpoints and raw records within this folder.
Write results under `output/` atomically. Checkpoint after each replay cell and support matching `--resume`.
Resume must reconstruct state from the frozen event prefix without applying future events.
Provide read-only `--verify`. It must make no inference calls or file changes.

Proposed commands, from the repository root after implementation:

```bash
uv run --project experiments --no-sync python -m pytest experiments/07-retrieval-scoped-assignment-reuse-2026-10-10/test_run_eval.py
uv run --project experiments --no-sync python experiments/07-retrieval-scoped-assignment-reuse-2026-10-10/run_eval.py --resume
uv run --project experiments --no-sync python experiments/07-retrieval-scoped-assignment-reuse-2026-10-10/run_eval.py --verify
```

Focused tests must detect omitted scope fields, accidental normalisation, automatic approval and overwritten corrections.
Test revision changes, conflicting records, future-event leakage, invalid labels and preserved fallback statuses.
Also test missing baseline IDs, answer-key access, incorrect call counts and changed resume fingerprints.
Confirm each test fails under its corresponding deliberate fault in a disposable copy.
Planning creates no runner and authorises no execution, installations or production-data access.

## Results

### Functional result: PASS

Every fixed gate passed. Real-world validity remains INCONCLUSIVE.
Source for all replay counts below: `output/summary.json`, reproduced from `output/eval_results.json`.

| Measure | Result |
| --- | ---: |
| Synthetic observation queries | 48 |
| Declared state events | 128 |
| Exact approved assignment hits | 3 |
| Correction-precedence hits | 8 |
| Misses preserving baseline outcomes | 37 |
| Routing or outcome mismatches | 0 |
| Queries with previously seen descriptions | 39 |
| Queries with unseen descriptions | 9 |
| Original empty-history responses preserved | 140/140 |
| Baseline classifier-call opportunities | 188 |
| Candidate classifier-call opportunities | 177 |
| Avoided classifier-call opportunities | 11 |
| Fresh model calls | 0 |

The previously seen group produced all 11 hits. All nine unseen-description queries fell back unchanged.
Wrong-scope, stale-revision, invalid-assignment, conflicting-record and near-exact cases produced no inappropriate hits.
The query preceding its approval also fell back unchanged.
These results use declared synthetic events, excluding any real-world reuse-rate estimate.

Miss reasons: 25 lacked an exact scoped assignment, eight had invalid assignments, and four had conflicting current records.
Source: `output/summary.json`, field `miss_reasons`.

### Original label accuracy: unchanged

| Measure | Baseline and candidate |
| --- | ---: |
| Correct existing-label choices | 21 |
| Wrong existing-label choices | 44 |
| Correct explicit none_fit choices | 57 |
| Overall accuracy | 78/140, or 55.7% |
| Paired wins / losses / ties | 0 / 0 / 140 |

Source: `output/summary.json`, fields `original_accuracy` and `original_paired`.
Empty verified history changed no classifier answers. This cell establishes fallback parity rather than an accuracy improvement.
The reuse layer leaves unfamiliar-input classification quality unchanged.

### Tests and verification

The focused command from the plan passed all 13 tests.
Each test detected a corresponding deliberate fault in a disposable runner copy.
Evidence: `fault-proof.json`. No pinned earlier runner was modified.
The section-scope test was strengthened after its first mutation failed to detect the intended fault.

The approved `--resume` run completed both cells. A matching second resume reproduced them without adding records.
The approved read-only `--verify` command reproduced the summary without model calls.
Input hashes, the approved report snapshot and plan-section hash are stored in `output/run-manifest.json`.
The plan section remains unchanged. Preservation checks cover 1,110 earlier experiment files.
Source: `output/summary.json`, field `preserved_files`, and `output/run-manifest.json`, field `preservation`.

No model server was started. This run used the existing Python environment, with no downloads or installations.

## Limits

1. Synthetic approvals establish functional behaviour rather than real-world category accuracy.
2. The original 140 cases lack independently sourced earlier approval events.
3. Exact-string reuse may have low coverage on naturally varied observations.
4. Frozen responses cannot measure live classifier latency or behaviour changes.
5. Technical tags, semantic aliases, extraction and observation merging remain outside scope.
6. Production adoption needs its own approved OpenSpec change and architectural decision record.

## Evidence

Read-only preparation by `a-researcher`, using the cited Receipt Scanner source and OMMS code.
No inference, private-history reads, database access, downloads or reviews occurred during preparation.
