"""Validate a completed blind review export against the corpus."""

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from safety import output_path, require_redacted

ALLOWED = {"duplicate": ("same", "different", "uncertain"),
           "conflict": ("contradict", "compatible", "uncertain")}
FIELDS = {"id", "decision", "A", "B", "outcome", "reason"}


def validate_export(review: Path, export: Path, root: Path) -> dict:
    """Accept only complete, unchanged and blind review exports."""
    corpus = json.loads(output_path(review, root).read_text())
    records = json.loads(output_path(export, root).read_text())
    if not isinstance(corpus, list) or not corpus:
        raise ValueError("corpus must be a non-empty JSON array")
    if not isinstance(records, list) or not records:
        raise ValueError("review export must be a JSON array")
    for record in records:
        if not isinstance(record, dict) or not FIELDS.issubset(record):
            raise ValueError("invalid review record")
        # The blindness guard: no extra field may travel with a record.
        extra = set(record) - FIELDS
        if extra:
            raise ValueError("unexpected review key: " + sorted(extra)[0])
    ids = [record["id"] for record in records]
    if len(ids) != len(set(ids)):
        raise ValueError("duplicate review id")
    if set(ids) != {record["id"] for record in corpus}:
        raise ValueError("review id set differs from corpus")
    original = {record["id"]: record for record in corpus}
    counts = {outcome: 0 for options in ALLOWED.values() for outcome in options}
    for record in records:
        source = original[record["id"]]
        if (record["A"], record["B"], record["decision"]) != (source["A"], source["B"], source["decision"]):
            raise ValueError("pair text changed against corpus")
        outcome, reason = record["outcome"], record["reason"]
        if not isinstance(outcome, str) or not isinstance(reason, str):
            raise ValueError("invalid review fields")
        if outcome == "":
            if reason.strip():
                raise ValueError("reason without outcome")
            raise ValueError("incomplete review: outcome missing")
        if outcome not in ALLOWED[record["decision"]]:
            raise ValueError("outcome not allowed for decision")
        if not reason.strip():
            raise ValueError("reason required for chosen outcome")
        counts[outcome] += 1
    # Refuse anything the redaction pass would still change.
    try:
        require_redacted(json.dumps(records, sort_keys=True))
    except ValueError as error:
        raise ValueError("review export contains private content") from error
    return {"valid": True, "reviewed": len(records), "outcomes": counts}


def main():
    default = Path(__file__).resolve().parent
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--review", type=Path, default=default / "corpus/blind-review.json")
    parser.add_argument("--file", type=Path, required=True)
    args = parser.parse_args()
    try:
        # Both files stay inside the experiment directory.
        summary = validate_export(args.review, args.file, default)
    except (ValueError, OSError, KeyError, TypeError) as error:
        parser.exit(1, f"review export rejected: {error}\n")
    print(json.dumps(summary, sort_keys=True), flush=True)


if __name__ == "__main__":
    main()
