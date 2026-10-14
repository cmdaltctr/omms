"""Append an unfrozen Clef cut-off table to the review-pilot report from saved records.

Read-only: no model calls. The table is post hoc and never feeds a gate. The pinned
runner writes the report, so this lives apart and leaves the pinned code unchanged.
"""

import argparse
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from review_pilot import CLEF, validate
from safety import output_path

CUTOFFS = (0.5, 0.65, 0.8, 0.9, 0.95, 0.99)
MARKER = "## Extra (not frozen): Clef at other cut-offs"


def rows(pairs, reference, records, split, decision):
    """Count Clef's original-order answers at each cut-off against the AI labels."""
    positive = "same" if decision == "duplicate" else "contradict"
    subset = [pair for pair in pairs if pair["split"] == split and pair["decision"] == decision]
    found = sum(reference[pair["id"]]["outcome"] == positive for pair in subset)
    table = []
    for cutoff in CUTOFFS:
        yes = right = wrong = uncertain = 0
        for pair in subset:
            record = records.get(f'{pair["id"]}/{CLEF}/1/0', {})
            if record.get("status") != "ok" or record["probability"] < cutoff:
                continue
            outcome = reference[pair["id"]]["outcome"]
            yes += 1
            right += outcome == positive
            uncertain += outcome == "uncertain"
            wrong += outcome not in (positive, "uncertain")
        table.append({"cutoff": cutoff, "yes": yes, "right": right, "wrong": wrong, "uncertain": uncertain, "missed": found - right})
    return len(subset), found, table


def section(value, pairs, reference, records):
    lines = [MARKER, "", "**Post hoc. Not frozen. Not used for any gate.** These rows re-score Clef's saved probabilities "
             "at other cut-offs, with no new model calls. The frozen cut-offs are "
             f'`{json.dumps(value["settings"]["clef_thresholds"], sort_keys=True)}`. Labels are AI-generated.', ""]
    for split in ("test", "challenge"):
        for decision in ("duplicate", "conflict"):
            count, found, table = rows(pairs, reference, records, split, decision)
            noun = "same" if decision == "duplicate" else "contradict"
            lines += [f"### {split.capitalize()} {decision} ({count} pairs, {found} labelled `{noun}`)", "",
                      "| Cut-off | YES | Correct YES | Wrong YES | YES on uncertain | Missed |", "| --- | --- | --- | --- | --- | --- |"]
            lines += [f'| {row["cutoff"]} | {row["yes"]} | {row["right"]} | {row["wrong"]} | {row["uncertain"]} | {row["missed"]} |' for row in table]
            lines.append("")
    return "\n".join(lines)


def append(report_text, extra):
    """Replace any earlier extra section, so reruns give the same file."""
    base = report_text.split(MARKER)[0].rstrip("\n")
    return base + "\n\n" + extra


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    args = parser.parse_args()
    path = args.manifest.absolute()
    root = path.parent
    experiment = root.parent
    value = json.loads(output_path(path, root).read_text())
    pairs, reference = validate(value, root)
    out = experiment / "output/review-pilot"
    records = {}
    for split in ("test", "challenge"):
        records.update(json.loads(output_path(out / split / "eval_results.json", experiment).read_text())["records"])
    report = output_path(out / "report.md", experiment)
    text = append(report.read_text(), section(value, pairs, reference, records))
    temporary = output_path(report.with_suffix(".md.tmp"), experiment)
    with os.fdopen(os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600), "w") as stream:
        stream.write(text)
        stream.flush()
        os.fsync(stream.fileno())
    temporary.replace(report)
    print(json.dumps({"report": "updated", "section": MARKER}), flush=True)


if __name__ == "__main__":
    main()
