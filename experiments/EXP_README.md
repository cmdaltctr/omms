# OMMS experiments

Experiments test proposed changes against reviewed data before production behaviour changes. Each experiment has its own dated folder and a complete `protocol.md`.

| ID  | Question                                                     | Status  | Protocol                                                             | Report             |
| --- | ------------------------------------------------------------ | ------- | -------------------------------------------------------------------- | ------------------ |
| 01  | Can bounded decisions reuse profile categories safely?       | PLANNED | [Label decisions](01-label-decisions-2026-10-07/protocol.md)         | Pending evaluation |
| 02  | Can decisions select more useful memory and profile context? | PLANNED | [Retrieval decisions](02-retrieval-decisions-2026-10-07/protocol.md) | Pending evaluation |

Both experiments belong to the [evaluate-memory-decision-models proposal](../openspec/changes/evaluate-memory-decision-models/proposal.md). One change covers their evaluation setup. Results are judged separately.

## Approval and run status

The current files record plans only. Runners, snapshots, ground truth and results have not been created.

1. Approve the OpenSpec proposal before implementation.
2. Approve installations and model downloads before setup.
3. Review ground truth and freeze the controls before inference.
4. Approve hosted data transfer and a spending limit before hosted calls.

Mark a protocol READY TO RUN only after its prerequisites and approvals are complete. Use ACTIVE during evaluation. Finish with PASS, FAIL or INCONCLUSIVE, and record the reason in `report.md`.

A result supports a later production proposal. It cannot authorise a production change.

## Files and data

- Commit protocols, runner code, analysis code and reviewed synthetic fixtures.
- Keep profile snapshots, real queries, ground truth, raw results and model weights in ignored local paths.
- Create ignore rules before exporting data.
- Use metadata-only logs and redact `<private>` content and secrets before inference.
- Checkpoint under each experiment's `output/` directory, using `.tmp` followed by rename.
- Use `--resume` only when the saved manifest and evaluation settings match.
- Keep one human-readable results document per experiment: `report.md`.
- Generate `analysis.py` from local JSON after results exist. Keep generated notebooks ignored.

## Scope

The pilot compares the current language model, Jev and Julia-1 against simpler controls. OpenJev is optional until its exact repository and backend are selected.

The experiments leave production stores, host sessions and live configuration unchanged. Profile translation, entry merging and coloured category badges need separate changes.
