"""Run the separately approved local Clef add-on, or verify saved metrics."""

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from checkpoint import Checkpoint, atomic_json
from clef_pilot import evaluate, freeze, scope, summarise, validate
from manifest import digest
from safety import output_path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--split", choices=("development", "test"))
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--retry-failed", action="store_true")
    parser.add_argument("--verify", action="store_true")
    args = parser.parse_args()
    if not args.verify and args.split is None:
        parser.error("inference requires --split")
    root = args.manifest.absolute().parent.parent
    value = json.loads(output_path(args.manifest.absolute(), root).read_text())
    validate(value, root)
    out = output_path(root / "output/clef", root)
    if args.verify:
        raw = json.loads((out / "eval_results.json").read_text())
        if raw["manifest_sha256"] != digest(value):
            raise ValueError("saved manifest differs")
        expected = summarise(value, root, raw["records"])
        if expected != json.loads((out / "eval_results.summary.json").read_text()):
            raise ValueError("saved Clef metrics differ from raw records")
        print(json.dumps({"metrics_reproduced": True, "record_count": expected["record_count"],
                          "expected_records": expected["expected_records"], "complete": expected["complete"], "hosted_calls": 0}), flush=True)
        return
    saved = Checkpoint(out / args.split / "eval_results_checkpoint.json", root, scope(value, args.split), resume=args.resume)
    evaluate(value, root, args.split, saved, retry_failed=args.retry_failed)
    atomic_json(out / args.split / "eval_results.json", root, {"manifest_sha256": digest(value), "records": saved.records})
    if args.split == "development":
        frozen = freeze(value, root, saved.records)
        validate(frozen, root)
        atomic_json(root / "corpus/clef-test-manifest.json", root, frozen)
    records = {}
    for split in ("development", "test"):
        path = out / split / "eval_results.json"
        if path.exists():
            records.update(json.loads(path.read_text())["records"])
    summary = summarise(value, root, records)
    atomic_json(out / "eval_results.json", root, {"manifest_sha256": digest(value), "records": records, "model": value["model"]})
    atomic_json(out / "eval_results.summary.json", root, summary)
    print(json.dumps({"split": args.split, "records": len(saved.records), "hosted_calls": 0}), flush=True)


if __name__ == "__main__":
    main()
