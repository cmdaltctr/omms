"""Reproduce label metrics and write the AI-pilot report without model calls."""

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from checkpoint import atomic_json
from manifest import digest
from labels import ARMS, gates, metrics, paired_interval, validate
from reference_guards import run_root, verify_freeze


def summarise(value, root):
    """Preserve missing records, failures and the lack of human review."""
    _, cases, candidates = validate(value, root)
    verify_freeze(value, root)
    records = {}
    for split in ("development", "test"):
        path = root / "output" / split / "eval_results.json"
        if path.exists():
            raw = json.loads(path.read_text())
            expected_value = value if split == "test" else json.loads((root / "corpus/development-manifest.json").read_text())
            if raw["manifest_sha256"] != digest(expected_value):
                raise ValueError("result manifest differs")
            records.update(raw["records"])
    expected = {f'{c["id"]}/{arm}/{order}' for c in cases for arm in ARMS
                for order in ((0, 1) if c["split"] == "development" and arm in ARMS[2:] else (0,))}
    if not set(records).issubset(expected):
        raise ValueError("unexpected records")
    development = {k: r for k, r in records.items() if r["split"] == "development"}
    if value.get("development_result_sha256") != digest(development):
        raise ValueError("frozen development results differ")
    test = [c for c in cases if c["split"] == "test"]
    results = {}
    for arm in ARMS:
        rows = {c["id"]: records[f'{c["id"]}/{arm}/0'] for c in test if f'{c["id"]}/{arm}/0' in records}
        results[arm] = metrics(test, rows, value["settings"]["thresholds"][arm])
        results[arm]["threshold"] = value["settings"]["thresholds"][arm]
        results[arm]["by_section"] = {section: metrics([c for c in test if c["section"] == section], rows,
                                                      value["settings"]["thresholds"][arm])
                                             for section in ("preferences", "patterns")}
    baseline = max(ARMS[:3], key=lambda a: results[a]["accuracy"])
    gates_result = gates(results[ARMS[3]], results[baseline], validity=False, safety=True)
    order_checks = {}
    for arm in ARMS[2:]:
        pairs = [(records.get(f'{c["id"]}/{arm}/0', {}), records.get(f'{c["id"]}/{arm}/1', {}))
                 for c in cases if c["split"] == "development"]
        order_checks[arm] = {"cases": len(pairs), "valid_pairs": sum(a.get("status") == b.get("status") == "ok" for a, b in pairs),
                            "different_answers": sum(a.get("answer") != b.get("answer") for a, b in pairs)}
    ledger = json.loads((root / "output/spending.json").read_text())
    scope = digest({"files": value["files"], "models": value["models"], "approvals": value["approvals"]})
    if ledger["fingerprint"] != scope or ledger["limit"] != 5:
        raise ValueError("spending scope differs")
    tickets = [r["spending_ticket"] for r in records.values() if "spending_ticket" in r]
    if len(tickets) != len(set(tickets)) or not set(tickets).issubset(ledger["calls"]):
        raise ValueError("spending tickets differ")
    for r in records.values():
        if "spending_ticket" in r and "usage_cost_usd" in r and ledger["calls"][r["spending_ticket"]] != r["usage_cost_usd"]:
            raise ValueError("usage settlement differs")
    accounted = sum(ledger["calls"].values())
    if not 0 <= accounted <= 5:
        raise ValueError("spending cap exceeded")
    return {"verdict": "INCONCLUSIVE", "reference_kind": "ai-draft", "human_reviewed": False,
            "reason": "AI reference labels have no independent human review.", "arms": results,
            "strongest_baseline": baseline, "gates": gates_result,
            "paired_accuracy_lift_ci95": paired_interval(test, records, ARMS[3], baseline),
            "candidate_recall": sum(bool(set(c["expected"]) & set(candidates[c["id"]]["ids"])) for c in test)/len(test),
            "test_none_fit_cases": sum(c["expected"] == ["none_fit"] for c in test),
            "record_count": len(records), "expected_records": len(expected), "complete": set(records) == expected,
            "order_checks": order_checks, "hosted_calls": len(ledger["calls"]), "accounted_usd": accounted,
            "known_usage_usd": sum(r.get("usage_cost_usd", 0) for r in records.values()),
            "unlinked_reservations": len(set(ledger["calls"]) - set(tickets)),
            "safety": {"production_writes": 0, "cross_section_moves": 0, "description_edits": 0, "entry_merges": 0}}


def report(summary, root):
    """Render one concise report from the reproducible metrics."""
    lines = ["# Experiment 01: label decisions", "", "**Verdict: INCONCLUSIVE**", "",
             "## Result", "", "DeepSeek and local Clef received the same observations and 16 section-specific labels plus `none_fit`.",
             "The answer key was written by an AI before inference. Human review is required before any production recommendation.", "",
             "| Arm | Correct / 140 | Accuracy | Wrong reuse | Automatic coverage | Mean / P95 seconds | Threshold |",
             "| --- | --- | --- | --- | --- | --- | --- |"]
    for arm, row in summary["arms"].items():
        wrong = "undefined" if row["wrong_reuse_rate"] is None else f'{row["wrong_reuse_rate"]:.2%} ({row["wrong_reuse_count"]}/{row["reused"]})'
        lines.append(f'| {arm} | {row["correct"]}/140 | {row["accuracy"]:.2%} | {wrong} | {row["coverage"]:.2%} | {row["mean_seconds"]} / {row["p95_seconds"]} | {row["threshold"]} |')
    lines += ["", "## Gates", "", "| Gate | Verdict |", "| --- | --- |"]
    lines += [f"| {g} | {v} |" for g, v in summary["gates"].items()]
    lines += ["", "## Evidence and limitations", "", f'- Records: {summary["record_count"]}/{summary["expected_records"]}. Complete: {summary["complete"]}.',
              f'- Candidate recall: {summary["candidate_recall"]:.2%}. Test `none_fit` cases: {summary["test_none_fit_cases"]}.',
              f'- Strongest control: `{summary["strongest_baseline"]}`. Group-bootstrap 95% lift interval: `{summary["paired_accuracy_lift_ci95"]}`.',
              f'- Hosted calls: {summary["hosted_calls"]}. Known usage: US${summary["known_usage_usd"]:.6f}. Accounted spend: US${summary["accounted_usd"]:.6f}; cap US$5.',
              '- Rates use the Experiment 03 DeepSeek pin: US$0.30 input and US$1.20 output per million tokens. Cache discounts are ignored.',
              '- Development includes reversed candidate order; test uses the frozen primary order. See summary JSON for disagreement counts.',
              '- Clef uses native Choice probabilities. DeepSeek certainty is self-reported and is not a calibrated probability.',
              '- The embedding control always chooses its highest-ranked label; its threshold determines review deferral. It cannot emit `none_fit`.',
              '- Catalogue definitions and aliases come from development observations. Concept groups keep paraphrases in one split.',
              '- A small AI-labelled sample cannot establish a production wrong-reuse rate below 2%.',
              '- No production settings or stored entries were changed. No files were deleted.', "",
              "## Reproduction", "", "Run from the feature worktree with the existing experiment environment:", "", "```bash",
              f"uv run --project experiments --no-sync python experiments/01-label-decisions-2026-10-07/analysis.py --root {root} --verify",
              "```", "", "## Artefacts", "", "- `corpus/`: ignored snapshot, reference, catalogue, candidates and manifests.",
              "- `output/`: ignored frozen vectors, development/test checkpoints, spending ledger and summary JSON.",
              "- `run_eval.py`, `summarise_eval.py`, `analysis.py`: experiment-local execution and read-only verification.", ""]
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--verify", action="store_true")
    parser.add_argument("--root", type=Path, required=True)
    args = parser.parse_args()
    root = run_root(args.root)
    value = json.loads((root / "corpus/test-manifest.json").read_text())
    summary = summarise(value, root)
    target = root / "output/eval_results.summary.json"
    if args.verify:
        if json.loads(target.read_text()) != summary:
            raise ValueError("saved metrics differ")
        print(json.dumps({"metrics_reproduced": True, "records": summary["record_count"], "complete": summary["complete"]}), flush=True)
    else:
        atomic_json(target, root, summary)
        (root / "report.md").write_text(report(summary, root))
        print(json.dumps(summary, indent=2), flush=True)


if __name__ == "__main__":
    main()
