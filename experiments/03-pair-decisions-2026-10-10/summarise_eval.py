"""Summarise local pair records without making model calls."""

import argparse
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from checkpoint import atomic_json
from pair_metrics import summarise
from safety import output_path


def render_report(summary, models):
    """Render verdicts and missing optional arms without including pair text."""
    lines = ["# Experiment 03 results", "", "These verdicts apply to the recorded test cells only. Missing evidence remains INCONCLUSIVE.", "", "| Decision | Arm | Verdict | Agreement | False-merge rate | Mean seconds |", "| --- | --- | --- | --- | --- | --- |"]
    for decision in ("duplicate", "conflict"):
        for arm in ("P0", "P1", "P2", "P3"):
            result = summary[decision][arm]
            item = result["metrics"]
            lines.append(f'| {decision} | {arm} | {result["verdict"]} | {item["agreement"]} | {item["false_merge_rate"]} | {item["mean_seconds"]} |')
    lines.extend(["", "## Optional arms", ""])
    for arm in ("OpenJev", "P4", "P5"):
        model = models.get(arm, {"status": "blocked", "reason": "No approved backend pin."})
        lines.append(f'- {arm}: {model["status"]}. {model.get("reason", "Pinned local backend.")}')
    lines.extend(["", "## Interpretation", "", "P1 is the reference control. Its INCONCLUSIVE verdict does not apply candidate speed gates to the control itself.", "", "False-merge intervals use the upper end of a two-sided 95% Wilson interval. Pair independence is an approximation; inspect entry-group coverage before interpreting a pilot pass. Paired agreement intervals resample entry groups. Small accepted samples and undefined rates cannot pass.", "", "Uncertain reviewed pairs remain separate from correct and wrong answers. An arm accepting them cannot pass. Missing cells, invalid answers and timeouts remain recorded.", "", "No result authorises production integration or merging.", "", "## Separate follow-up", "", "The production duplicate cache key truncates the joined descriptions to 100 characters. Track and fix that separately. This experiment does not change it.", ""])
    return "\n".join(lines)


def main():
    default = Path(__file__).resolve().parent
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=default / "corpus/manifest.json")
    args = parser.parse_args()
    try:
        root = args.manifest.absolute().parent
        manifest = json.loads(output_path(args.manifest.absolute(), root).read_text())
        pairs = json.loads(output_path(root / manifest["files"]["corpus"]["path"], root).read_text())
        truth = json.loads(output_path(root / manifest["files"]["ground_truth"]["path"], root).read_text())
        records = []
        for split in ("development", "test"):
            path = output_path(root.parent / "output" / split / "eval_results.json", root.parent)
            if path.exists():
                records.extend(json.loads(path.read_text())["records"].values())
        summary = summarise(pairs, truth, records, gates=manifest["approved_gates"])
        out = root.parent / "output"
        atomic_json(out / "eval_results.json", root.parent, {"records": records, "models": manifest["models"]})
        atomic_json(out / "eval_results.summary.json", root.parent, summary)
        report = output_path(root.parent / "report.md", root.parent)
        temporary = output_path(report.with_suffix(".md.tmp"), root.parent)
        with os.fdopen(os.open(temporary, os.O_CREAT | os.O_WRONLY | os.O_TRUNC | os.O_NOFOLLOW, 0o600), "w") as stream:
            stream.write(render_report(summary, manifest["models"]))
            stream.flush()
            os.fsync(stream.fileno())
        temporary.replace(report)
        print(json.dumps({"status": "summarised", "records": len(records)}), flush=True)
    except (ValueError, OSError, KeyError, TypeError):
        parser.exit(1, "summary prerequisites failed\n")


if __name__ == "__main__":
    main()
