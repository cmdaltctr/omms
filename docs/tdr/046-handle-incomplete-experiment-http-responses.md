# TDR-046: Handle incomplete experiment HTTP responses

- **Date:** 2026-10-10
- **Status:** Accepted
- **Deciders:** Project owner

## Context

Experiment 03 saved all 648 development records, including one transport error. Test execution stopped after 172 records at P1 repeat 2. The user approved transport-only recovery after freeze. Frozen questions and thresholds remain unchanged, along with model pins and the original shared US$5 cap.

### Root Cause Analysis

Python 3.11 `urllib` encountered a truncated chunked DeepSeek response during `json.load(response)`. Its `http.client.IncompleteRead` exception escaped the existing `URLError` handler.

## Decision

In experiment-only `experiments/providers.py`, import `IncompleteRead` and wrap the response read inside `http_json`:

```python
from http.client import IncompleteRead

# Inside the response context in http_json():
try:
    return json.load(response)
except IncompleteRead:
    raise URLError("incomplete-response") from None
```

The existing handler records metadata-only transport errors without retries.

The one-off recovery script requires separate approval and verifies the exact patch against original code hashes. It checks checkpoint identity and the development freeze, with the original spending scope. One orphan reservation becomes an `incomplete-response` error with unknown timing. The script backs up the original checkpoint and creates `corpus/ai-pilot-test-recovery-manifest.json` with original and corrected code hashes. The ledger stays untouched. Resume skips recorded failures and completed records.

Reported validation: 121 focused tests passed, including both referenced test files. Reverting the catch gave two failures; disabling recovery approval/checkpoint/ledger checks gave three.

## Consequences

### Positive

- Incomplete responses can be checkpointed without retaining partial response text.

### Negative

- The interrupted attempt has unknown timing and retains its full spending reservation.

### Neutral

- Production behaviour is unchanged. Resume was running in the background when this record was written; its final outcome was unknown.

## Alternatives Considered

| Option                     | Rejected Because                                                       |
| -------------------------- | ---------------------------------------------------------------------- |
| Automatic retries          | Changes repeat accounting and can consume more of the approved budget. |
| Reset checkpoint or ledger | Discards completed work and unresolved charges.                        |

## How to Recognise / Handle This Again

1. Check the traceback for `IncompleteRead` during a chunked response read. Inspect the transport code.
2. Match exactly one orphan P1 reservation to the first missing checkpoint record. Refuse ambiguous state.
3. Use this recovery script only for this specific interruption. Never bypass pins or erase charges.
4. After the active runner stops, resume with the existing recovery manifest. A new recovery needs separate approval.

Root-relative commands follow. The tests are offline; resume makes hosted calls under the original approval.

```sh
uv run --project experiments --no-sync python -m pytest -q \
  experiments/tests/test_ai_pilot.py experiments/tests/test_pilot_recovery.py
uv run --project experiments --no-sync python experiments/03-pair-decisions-2026-10-10/run_ai_pilot.py \
  --manifest experiments/03-pair-decisions-2026-10-10/corpus/ai-pilot-test-recovery-manifest.json \
  --split test --resume
```

## Revisit Triggers

Revisit for other transport failures. A client change or multiple orphan reservations requires a new recovery design.

## References

- [Experiment transport](../../experiments/providers.py)
- [Recovery script](../../experiments/03-pair-decisions-2026-10-10/recover_ai_pilot.py)
- [Pilot error handling](../../experiments/ai_pilot.py) and [checkpoint selection](../../experiments/checkpoint.py)
- [Incomplete-response tests](../../experiments/tests/test_ai_pilot.py) and [recovery tests](../../experiments/tests/test_pilot_recovery.py)
