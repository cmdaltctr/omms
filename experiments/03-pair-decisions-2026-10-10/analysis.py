# %%
"""Read the AI-labelled pilot's saved summary without making model calls."""

import argparse
import json
import math
import sys
from pathlib import Path
from types import SimpleNamespace


def load_rows(path):
    """Return diagnostic metrics, preserving the inconclusive safety verdict."""
    summary = json.loads(path.read_text())
    if summary["reference_kind"] != "ai-draft" or summary["human_reviewed"] is not False:
        raise ValueError("expected an explicitly AI-labelled diagnostic summary")
    if summary["merge_safety_verdict"] != "INCONCLUSIVE":
        raise ValueError("AI labels cannot establish independent merge safety")
    return [
        {"decision": decision, "arm": arm,
         "ai_reference_agreement": item["agreement"],
         "deepseek_agreement": item["agreement_with_deepseek_first_repeat"],
         "mean_seconds": item["mean_seconds"],
         "p95_seconds": item["p95_seconds"],
         "speedup_vs_deepseek": item["speedup_vs_deepseek"],
         "complete": item["complete"], "errors": item["errors"]}
        for decision, arms in summary["decisions"].items()
        for arm, item in arms.items()
    ]


def verify_saved_results(summary_path, manifest_path):
    """Recompute saved metrics and account for records without writing or calling models."""
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from ai_pilot import summarise, spending_scope, validate
    from safety import output_path
    root = manifest_path.absolute().parent
    experiment = root.parent
    value = json.loads(output_path(manifest_path.absolute(), root).read_text())
    validate(value, root)
    summary_path = output_path(summary_path.absolute(), experiment)
    saved = json.loads(summary_path.read_text())
    raw = json.loads(output_path(summary_path.with_name("eval_results.json"), experiment).read_text())
    ledger = json.loads(output_path(summary_path.with_name("spending.json"), experiment).read_text())
    if ledger["fingerprint"] != spending_scope(value) or ledger["limit"] != value["approvals"]["spend_usd"]:
        raise ValueError("saved spending scope differs")
    if raw["models"] != value["models"]:
        raise ValueError("saved model pins differ")
    accounted = sum(ledger["calls"].values())
    if not math.isfinite(accounted) or accounted > ledger["limit"]:
        raise ValueError("invalid saved spending total")
    recalculated = summarise(value, root, raw["records"], SimpleNamespace(state=ledger, used=accounted))
    for key, expected in recalculated.items():
        matches = math.isclose(saved.get(key, float("nan")), expected, rel_tol=1e-12, abs_tol=1e-12) if key == "spending_accounted_usd" else saved.get(key) == expected
        if not matches:
            raise ValueError("saved metric differs from raw records: " + key)
    expected = {f'{pair["id"]}/{arm}/{repeat}/{int(swapped)}'
                for pair in value["pairs"]
                for arm, repeat in (("P0", 1), ("P1", 1), ("P1", 2), ("P2", 1), ("P3", 1))
                for swapped in ((False, True) if pair["split"] == "development" and arm != "P0" else (False,))}
    if not set(raw["records"]).issubset(expected):
        raise ValueError("unexpected raw record IDs")
    linked = set()
    usage = 0
    for row in raw["records"].values():
        for billed in (row, row.get("jev", {})):
            ticket = billed.get("spending_ticket")
            if not ticket:
                continue
            if ticket in linked or ticket not in ledger["calls"]:
                raise ValueError("duplicate or missing spending ticket")
            linked.add(ticket)
            if "usage_cost_usd" in billed:
                cost = billed["usage_cost_usd"]
                if not math.isclose(cost, ledger["calls"][ticket], rel_tol=1e-12, abs_tol=1e-12):
                    raise ValueError("record usage differs from spending ledger")
                usage += cost
    return {"metrics_reproduced": True, "all_required_records_accounted": set(raw["records"]) == expected,
            "expected_records": len(expected), "saved_records": len(raw["records"]),
            "hosted_calls_attempted": len(ledger["calls"]), "unlinked_spending_tickets": len(set(ledger["calls"]) - linked),
            "usage_cost_usd": usage, "unresolved_reservations_usd": accounted - usage,
            "accounted_usd": accounted, "spend_cap_usd": ledger["limit"],
            "unknown_timing_records": sum(row.get("duration_seconds") is None for row in raw["records"].values())}


# %%
if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--summary", type=Path, default=Path(__file__).resolve().parent / "output/ai-pilot/eval_results.summary.json")
    parser.add_argument("--verify", action="store_true")
    parser.add_argument("--manifest", type=Path)
    args = parser.parse_args()
    if args.verify and args.manifest is None:
        parser.error("--verify requires the saved test --manifest")
    result = verify_saved_results(args.summary, args.manifest) if args.verify else load_rows(args.summary)
    print(json.dumps(result, indent=2, allow_nan=False))
