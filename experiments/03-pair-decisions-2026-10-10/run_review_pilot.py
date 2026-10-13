"""Prepare, run or verify the AI-labelled diagnostic on corpus v2 (P0, P1 and local Clef)."""

import argparse
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from checkpoint import Checkpoint, atomic_json
from manifest import digest
from review_pilot import (PilotStopped, clef_caller, deepseek_caller, evaluate, freeze, prepare, render_report,
                          scope, spending_scope, summarise, validate)
from safety import output_path
from spending import Budget

SPLITS = ("development", "test", "challenge")


def write_report(path, root, text):
    temporary = output_path(path.with_suffix(".md.tmp"), root)
    with os.fdopen(os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600), "w") as stream:
        stream.write(text)
        stream.flush()
        os.fsync(stream.fileno())
    temporary.replace(output_path(path, root))


def collect(out):
    records = {}
    for split in SPLITS:
        path = out / split / "eval_results.json"
        if path.exists():
            records.update(json.loads(path.read_text())["records"])
    return records


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--prepare", action="store_true", help="write a new manifest; needs --clef-manifest and --spend-usd")
    parser.add_argument("--clef-manifest", default="clef-test-manifest.json")
    parser.add_argument("--spend-usd", type=float)
    parser.add_argument("--split", choices=SPLITS)
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--retry-failed", action="store_true")
    parser.add_argument("--verify", action="store_true")
    args = parser.parse_args()
    path = args.manifest.absolute()
    root = path.parent
    experiment = root.parent
    out = output_path(experiment / "output/review-pilot", experiment)
    try:
        if args.prepare:
            if path.exists() or args.spend_usd is None:
                raise ValueError("prepare needs --spend-usd and a manifest path that does not exist")
            value = prepare(root, args.clef_manifest, args.spend_usd)
            validate(value, root)
            atomic_json(path, root, value)
            print(json.dumps({"prepared": path.name, "deepseek_calls": value["deepseek_calls"],
                              "estimated_cost_usd": value["estimated_cost_usd"]}), flush=True)
            return
        value = json.loads(output_path(path, root).read_text())
        validate(value, root)
        ledger = out / "spending.json"
        if args.verify:
            saved = json.loads((out / "eval_results.summary.json").read_text())
            saved.pop("stop_reason", None)
            budget = Budget(ledger, experiment, spending_scope(value), value["approvals"]["spend_usd"], resume=True)
            if summarise(value, root, collect(out), spent_usd=budget.used) != saved:
                raise ValueError("saved metrics differ from raw records")
            print(json.dumps({"metrics_reproduced": True, "record_count": saved["record_count"]}), flush=True)
            return
        if args.split is None:
            raise ValueError("inference requires --split")
        if not os.environ.get(value["models"]["P1"]["credential_env"]):
            raise ValueError("approved credential reference unavailable")
        budget = Budget(ledger, experiment, spending_scope(value), value["approvals"]["spend_usd"], resume=ledger.exists())
        state = out / args.split / "eval_results_checkpoint.json"
        saved = Checkpoint(state, experiment, scope(value, args.split), resume=args.resume and state.exists())
        pairs, _ = validate(value, root)
        stop = None
        try:
            evaluate(value, root, args.split, saved, deepseek=deepseek_caller(value, pairs, budget), clef=clef_caller(value),
                     retry_failed=args.retry_failed)
        except PilotStopped as error:
            stop = str(error)
        atomic_json(out / args.split / "eval_results.json", experiment,
                    {"manifest_sha256": digest(value), "records": saved.records, "stop_reason": stop})
        if args.split == "development" and stop is None:
            frozen = freeze(value, root, saved.records)
            validate(frozen, root)
            atomic_json(root / "review-pilot-test-manifest.json", root, frozen)
        summary = summarise(value, root, collect(out), spent_usd=budget.used)
        summary["stop_reason"] = stop
        atomic_json(out / "eval_results.summary.json", experiment, summary)
        write_report(out / "report.md", experiment, render_report(summary))
        print(json.dumps({"split": args.split, "records": len(saved.records), "accounted_usd": budget.used, "stop_reason": stop}), flush=True)
        if stop is not None:
            parser.exit(1, "pilot stopped; partial results saved\n")
    except (ValueError, OSError, KeyError, TypeError) as error:
        parser.exit(1, f"review pilot refused: {error}\n")


if __name__ == "__main__":
    main()
