# Design

## Context

See [proposal.md](proposal.md) for the motivation and scope. The protocols define independent label, retrieval and pair-decision questions, their controls and pilot gates.

OMMS is a TypeScript package with Bun tests and libSQL storage. Julia-1's documented runtime is Python. The `s-experiment` workflow supplies the experiment structure, checkpoint rules and report format; its Chroma and `rag_mcp` examples do not apply to this repository.

The production profile path already has embedding-based incoming matches, category-grouped duplicate checks and a context selector based on confidence, recency and frequency. Project retrieval combines content and tag vectors, then packs context under a byte-derived token estimate. These paths supply reference behaviour without needing production changes.

The relevant existing specs are `profile-learning`, `memory-context-controls` and `host-neutral-memory-core`. Their requirements remain unchanged, so this tooling-only change declares `skip_specs: true`.

## Goals / Non-Goals

**Goals:**

- Make each comparison reproducible from a reviewed corpus and a frozen manifest.
- Distinguish gains from normalisation, prompting, embeddings and decision models.
- Measure omission of relevant evidence after context packing.
- Reject unsafe paths and incomplete prerequisites before model calls.
- Retain negative results and report missing evidence without claiming a pass.

**Non-Goals:**

- Choose a production provider or alter host model precedence.
- Write model decisions back to the profile or memory stores.
- Evaluate description translation, performing entry merges, workflows or badge styling.
- Integrate Jev or change the import. A pair-decision result supports a later proposal only.
- Add a general experiment framework, a new web review app or cloud deployment.

## Decisions

### 1. Use one change with three independent experiment folders

Use these roots:

```text
experiments/
  EXP_README.md
  01-label-decisions-2026-10-07/
    protocol.md
  02-retrieval-decisions-2026-10-07/
    protocol.md
  03-pair-decisions-2026-10-10/
    protocol.md
```

One proposal owns preparation and the run safeguards. Each experiment owns its corpus, checkpoints, metrics and report. Passing one experiment cannot pass another.

A combined quality score would hide whether an improvement came from category assignment, retrieval or pair decisions. Two unrelated changes would duplicate approval and isolation work. Keep the common setup small; do not introduce base classes or a plugin registry.

### 2. Keep dependencies and runners outside the published package

After approval, add `experiments/pyproject.toml` and a lockfile managed with `uv`. Use Python for the model comparison because Julia-1 requires its own runtime. Each experiment gets `run_eval.py`, `summarise_eval.py` and, after results exist, `analysis.py`.

Use Bun helpers under `experiments/` for checks that require OMMS TypeScript ranking or packing. Existing package dependencies stay unchanged. Imports must not start a host adapter or initialise production storage.

A Python-only reimplementation of the OMMS ranking would weaken the reference comparison. A TypeScript-only model integration would require additional Julia-1 runtime work. The small process boundary keeps each runtime in its existing role.

The production architecture is unchanged. Record any later production provider choice in its own proposal and architectural decision record.

### 3. Separate safe preparation from model execution

Implementation may create synthetic fixtures and tests after proposal approval. Installs and downloads need their own approval. Before any real-data or hosted run, record the approved corpus scope, providers, transfer permission and spending limit.

Write ignore rules before real-data export. Keep `corpus/`, `output/`, model caches, virtual environments and generated notebooks out of version control. Store redacted ground truth locally. Commit reviewed synthetic cases for deterministic tests.

The snapshot helper opens the source databases read-only and takes a consistent snapshot. It cannot rename a source file or modify its sidecars. Sanitise the snapshot before building experiment vectors. Record the source and redacted-corpus hashes separately.

OMMS fixture processes use an isolated home and explicit experiment-local storage. Reuse the documented migration, backfill, web-autostart and runtime-record safeguards from `docs/ci.md`. Validate resolved paths before importing modules that read configuration.

Reject symlinked source, corpus and output paths. Allow only the declared source as a read target, with writes limited to the experiment directory. Refuse corpus or output paths under a live OMMS store. Disable existing content-bearing log calls in fixture processes; write only the experiment's metadata records.

Direct use of the live memory CLI is excluded because its initialisation can do more than read a database.

### 4. Freeze observations and candidates before comparing methods

The label experiment uses 200 reviewed cases, split into 60 development and 140 test cases. Catalogue IDs, definitions and aliases are reviewed from development material. Close variants stay in the same concept group and split.

Each matched method receives the same observation and 16 existing label definitions plus `none_fit`. The normalisation and embedding controls use that catalogue. The current language model receives the same bounded choices as Jev and Julia-1. This controls for better instructions.

The retrieval experiment uses 100 reviewed requests, split into 30 development and 70 test requests. It includes 20 no-relevance requests. Freeze top-20 candidate lists for project memories, preferences and patterns after sanitisation and fixed embedding retrieval.

The current static profile selector is a diagnostic reference with its own full snapshot. The isolated model comparison uses fixed candidates, equal count limits and the same packer. Label outcomes do not feed retrieval candidates in this pilot.

Running extraction and relabelling together would change several variables. Use stored observations as inputs, so this experiment measures the stated decisions.

### 5. Use bounded outputs with per-method thresholds

Label models return an existing candidate ID or `none_fit`. Retrieval models judge one explicit query-candidate relationship. Jev and Julia-1 use Choice for labels and Noul for retrieval and pair decisions.

The current language model returns a constrained label or relevance score. Its self-reported score is not an established probability. Preserve provider fields, raw scores and threshold decisions separately.

Validate ID membership and finite numeric ranges before accepting outputs. Treat source text as quoted data. A model answer cannot change instructions, execute a tool or authorise a write.

Tune each method's threshold on development cases. Freeze the question, catalogue, threshold, candidate order, batching and concurrency before test inference. Record the frozen reference time for recency-based profile selection.

Do not transfer a Jev threshold to Julia-1 or the current model. Their score and confidence fields have different meanings.

### 6. Pin models and record uncertainty

Record model IDs and versions, repository revisions, weight checksums, inference precision, strict-encoding settings and local hardware. The proposed Jev version is `jev-1.13.0`; verify it before the run. Pin Julia-1's revision rather than using a moving repository head.

OpenJev is optional. Record an exact repository and backend, or mark the arm BLOCKED with a reason. A server name alone does not identify the tested model. This decision can be deferred without changing the mandatory comparison.

The catalogue shortlist keeps Julia-1 within its native 2–20 option limit. Reject input overflow instead of truncating silently. Report input-limit failures as failures to complete the cell.

### 7. Save results atomically and refuse mismatched resume state

Each runner writes under its own `output/`. Checkpoint after every completed case or request and after each cell. Use `.tmp` followed by rename and flush progress output.

A resume fingerprint includes the corpus, ground truth, candidates, source commit, model, question, split, threshold and relevant budget settings. A mismatched fingerprint stops the resume. Completed decisions remain unchanged. Failed decisions stay recorded and can be retried explicitly.

Store redacted decision records with stable IDs, probabilities or scores, timing, usage and error codes. Logs contain metadata only. Credentials are never written to these files. Do not load a repository `.env` automatically; use explicitly approved environment or file references.

A final result file is written atomically only when the required records are accounted for. Summarisation marks incomplete arms BLOCKED or INCONCLUSIVE; it cannot discard errors to produce a pass.

### 8. Judge quality after packing and keep pilot verdicts local

The label gates are a 10-percentage-point accuracy gain, wrong reuse below 2%, and automatic coverage of at least 70%. Invalid or missing answers remain in the denominator. An undefined wrong-reuse metric is INCONCLUSIVE.

The retrieval gates require a 10-percentage-point useful-context gain, evidence loss of at most 1 percentage point, and added P95 delay below 500 ms. Apply them separately to project memories and profile context. Both matched baselines constrain the quality comparison.

Retrieval uses 2000 approximate tokens, a profile payload share of 0.25 and the protocol's fixed count limits. Score the reviewed evidence spans after the shared packer has shortened or omitted entries. Include headings and wrappers in the budget checks.

Measure the full added decision path, including encoding, batching, network delay, retries and packing. Model loading is reported separately. Record paired warmed measurements under a frozen concurrency policy.

Report paired confidence intervals and small-sample limits. If a baseline leaves less than 10 points of possible improvement, mark the lift question INCONCLUSIVE. Freeze all gates before inference. A failed or inconclusive pilot keeps production behaviour unchanged.

### 9. Judge pair decisions on reviewed pairs, with false merges first

Production merges two entries when a duplicate or conflict check answers yes. A wrong yes destroys a distinct fact. A wrong no keeps two entries. The pair experiment therefore ranks the false-merge rate above agreement and speed.

Take a read-only snapshot after the category repair. Build pairs with the production rules: same category, cosine similarity of 0.5 or more for duplicates, and 0.65 up to 0.9 for conflicts. Do not tune these bands. Group pairs that share an entry and keep each group in one split. The user reviews every pair blind: no model answer, score or similarity is shown. Import logs hold sizes and identifiers only, so they supply call counts and latency and never pair text or labels. A model answer, including the current model's, cannot define ground truth.

Compare an embedding threshold, the current model with its exact production prompt (run twice to measure noise), Jev Noul, and a hybrid. The hybrid keeps Jev answers outside a probability band and sends the rest to the current model. Julia-1 is optional and stays BLOCKED unless its pinned weights give a yes/no probability. Needle (`cactus-compute/needle`) is a second optional local arm, `P5-needle`. It is a structured-output model for tool calls and extraction, not a yes/no decision model, so the arm poses each pair as one enum field and measures whether that works. Run it local, with telemetry off and without fine-tuning, and keep its confidence score apart from calibrated probabilities. Check A/B order swaps on development pairs.

The proposed gates are `P-G1` to `P-G6`: false merges no worse than the current model with a 95% upper bound below 5%, agreement within 3 points, at least 5 times lower decision time, at most 30% fallback for the hybrid, validity, and zero production writes. The 5 times and 30% limits are placeholders for the user to set before inference. An undefined rate, or too few reviewed contradictions, is INCONCLUSIVE for that decision. Speed never offsets wrong merges.

A pass supports a later integration proposal. It does not integrate Jev or change the import.

## Risks / Trade-offs

| Risk                                                   | Mitigation                                                                       |
| ------------------------------------------------------ | -------------------------------------------------------------------------------- |
| Personal data reaches a hosted provider                | Redact first; require explicit transfer approval and a spending limit            |
| An import initialises the live store                   | Validate paths and isolate the process before importing OMMS services            |
| Duplicate concepts leak into both splits               | Group variants and source sessions before splitting                              |
| Human aliases make the baseline unrealistically strong | Build aliases from development material and report the catalogue provenance      |
| Candidate generation hides a model failure             | Report candidate recall and full-corpus recall alongside conditional results     |
| A fluent score is treated as calibrated confidence     | Keep score types separate and check accepted decisions against reviewed outcomes |
| Packing removes evidence from a high-ranked item       | Judge reviewed spans in final emitted text                                       |
| Local model load time dominates a short benchmark      | Report cold-start and warmed timing separately                                   |
| A pilot meets a numeric gate with weak evidence        | Publish uncertainty and require a later production validation plan               |
| An optional provider blocks all progress               | Mark that arm BLOCKED while complete mandatory arms retain their own results     |
| A faster model merges distinct facts                   | Gate the false-merge rate first; speed never offsets wrong merges                |
| Too few contradictions exist for a conflict verdict    | Search the conflict band, record pairs scanned, report INCONCLUSIVE if short     |

## Migration Plan

No production migration is required.

1. Approve this proposal before implementing the experiment tools.
2. Add isolation guards and deterministic synthetic tests.
3. Obtain setup approval before installing dependencies or downloading models.
4. Prepare and review the approved local corpus.
5. Freeze the manifest and obtain inference approval.
6. Run development and test cells with checkpoints.
7. Write each report and update the experiment index.

Rollback means stopping experiment processes and retaining the recorded evidence. Ask before deleting local artefacts. Do not change production data as part of rollback.

## Open Questions

- Which exact OpenJev repository and backend should form the optional arm? It can remain BLOCKED.
- Which project-memory corpus and current model should be pinned for retrieval? Preparation stops until both are recorded.
- What spending limit and hosted transfer scope will the user approve? Hosted execution stays blocked until approval.

- Which pair counts (200 duplicate, 150 conflict), speed-up factor (proposed 5 times) and fallback limit (proposed 30%) will the user approve?

These choices populate the frozen run manifests. They do not change the pilot questions or permit production changes.
