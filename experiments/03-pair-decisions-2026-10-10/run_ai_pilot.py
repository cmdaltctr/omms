"""Run only the explicitly approved AI-reference diagnostic pilot."""

import argparse
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ai_pilot import PilotStopped, evaluate, render_report, run_scope, spending_scope, summarise, tune, validate
from checkpoint import Checkpoint, atomic_json
from manifest import digest
from safety import output_path
from spending import Budget


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--split", choices=("development", "test"), required=True)
    parser.add_argument("--resume", action="store_true")
    args = parser.parse_args()
    root = args.manifest.absolute().parent
    value = json.loads(output_path(args.manifest.absolute(), root).read_text())
    validate(value, root)
    for model in value["models"].values():
        if not os.environ.get(model["credential_env"]):
            parser.exit(1, "approved credential reference unavailable\n")
    out = output_path(root.parent / "output/ai-pilot", root.parent)
    ledger = out / "spending.json"
    budget = Budget(ledger, root.parent, spending_scope(value), value["approvals"]["spend_usd"], resume=ledger.exists())
    state = out / args.split / "eval_results_checkpoint.json"
    saved = Checkpoint(state, root.parent, run_scope(value, args.split), resume=args.resume and state.exists())
    stop = None
    try:
        evaluate(value, root, args.split, saved, budget)
    except PilotStopped as error:
        stop = str(error)
    atomic_json(out / args.split / "eval_results.json", root.parent, {"manifest_sha256": digest(value), "reference_kind": "ai-draft", "records": saved.records, "stop_reason": stop})
    if args.split == "development" and stop is None:
        frozen = {**value, "settings": tune(value, root, saved.records)}
        frozen["settings_sha256"] = digest(frozen["settings"])
        frozen["development_result_sha256"] = digest(saved.records)
        frozen["test_settings_frozen"] = True
        validate(frozen, root)
        atomic_json(root / "ai-pilot-test-manifest.json", root, frozen)
    records = {}
    for split in ("development", "test"):
        path = out / split / "eval_results.json"
        if path.exists():
            records.update(json.loads(path.read_text())["records"])
    summary = summarise(value, root, records, budget)
    summary["stop_reason"] = stop
    atomic_json(out / "eval_results.json", root.parent, {"reference_kind": "ai-draft", "records": records, "models": value["models"], "stop_reason": stop})
    atomic_json(out / "eval_results.summary.json", root.parent, summary)
    report = output_path(out / "report.md", root.parent)
    temporary = output_path(report.with_suffix(".md.tmp"), root.parent)
    with os.fdopen(os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600), "w") as stream:
        stream.write(render_report(summary))
        stream.flush()
        os.fsync(stream.fileno())
    temporary.replace(report)
    print(json.dumps({"split": args.split, "records": len(saved.records), "accounted_usd": budget.used, "stop_reason": stop}), flush=True)
    if stop is not None:
        parser.exit(1, "pilot stopped; partial results saved\n")


if __name__ == "__main__":
    main()
