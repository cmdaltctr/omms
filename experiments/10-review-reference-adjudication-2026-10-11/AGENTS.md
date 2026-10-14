# Experiment 10: blind human adjudication of the reference labels

- **Status**: COMPLETE (2026-10-11). Reference frozen; 22 of 140 labels changed; Experiment 06 verdict unchanged. Validity: operator-arbitrated (disputes individually decided; consensus accepted wholesale).
- **Category**: review
- **Size**: Standard; basic statistics
- **Question**: Do the AI-authored test-case labels survive blind human adjudication, and does the Experiment 06 verdict change on the human reference?
- **Files**: `protocol.md` holds the plan; `plan.json` holds the frozen values; `CLAUDE.md` links here.

## Before execution

- Read the repository `AGENTS.md`, `../AGENTS.md` and `protocol.md`.
- Keep Experiments 01 to 09 and shared helpers read-only.
- Two scripts only: `build_page.py` and `finalise_reference.py`; tests are excluded from the limit.

## Fixed comparison

- An independent agent session drafts all 140 cases from blind inputs: descriptions, sections and every same-section definition. It never sees the AI reference, the classifier picks or any report.
- The operator confirms or edits every case in the page. A case counts as done only after confirmation.
- The frozen reference records `ai_drafted: true`, the draft SHA-256 and the confirmation pass; validity notes the confirmation-anchoring risk.
- The summary re-scores the saved Experiment 06 answers against the confirmed reference. No model calls from this experiment's scripts.

## Execution rules

- The page is offline, self-contained, no CDN, autosave in `localStorage`, one JSON download.
- Write only in this folder, plus the authorised index row.
- Incomplete adjudication never freezes; `uncertain` is a valid, reported outcome.
- `--verify` reproduces the summary without writes.
- Record amendments in `plan.json` before the affected work.

## Next step

Read the completed report. Use `finalise_reference.py --verify` for read-only reproduction.
The frozen reference feeds catalogue consolidation (step 2). The `review-first-assignment` OpenSpec proposal awaits the operator's decision.
