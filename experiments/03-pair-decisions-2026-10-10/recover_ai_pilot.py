"""Record the approved incomplete-response repair without retuning test controls."""

import argparse
import hashlib
import json
import math
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ai_pilot import code_pins, run_scope, spending_scope, validate
from checkpoint import atomic_json
from manifest import digest, file_digest
from safety import output_path


def prepare_recovery(value, root, saved, development, ledger, *, approved=False):
    """Retain one interrupted DeepSeek attempt as an error, with unknown timing."""
    if approved is not True:
        raise ValueError("separate transport recovery approval required")
    current = code_pins()
    previous = value["settings"]["code_sha256"]
    if set(previous) != set(current) or any(previous[key] != current[key] for key in current if key != "providers.py"):
        raise ValueError("only the transport repair may change code")
    source = (Path(__file__).resolve().parents[1] / "providers.py").read_text()
    repaired = '        try:\n            return json.load(response)\n        except IncompleteRead:\n            raise URLError("incomplete-response") from None\n'
    if source.count(repaired) != 1 or source.count("from http.client import IncompleteRead\n") != 1:
        raise ValueError("expected incomplete-response repair missing")
    before = source.replace("from http.client import IncompleteRead\n", "").replace(repaired, '        return json.load(response)\n')
    if hashlib.sha256(before.encode()).hexdigest() != previous["providers.py"]:
        raise ValueError("transport changed beyond the approved repair")
    if saved["fingerprint"] != run_scope(value, "test"):
        raise ValueError("original checkpoint fingerprint changed")
    if value.get("test_settings_frozen") is not True or digest(development) != value["development_result_sha256"]:
        raise ValueError("original development freeze changed")
    if ledger["fingerprint"] != spending_scope(value) or ledger["limit"] != value["approvals"]["spend_usd"]:
        raise ValueError("original spending scope changed")
    costs = ledger["calls"].values()
    if any(type(cost) not in (int, float) or not math.isfinite(cost) or cost < 0 for cost in costs) or sum(costs) > ledger["limit"]:
        raise ValueError("invalid spending ledger")
    pairs = [pair for pair in value["pairs"] if pair["split"] == "test"]
    expected = [(f'{pair["id"]}/{arm}/{repeat}/0', pair, arm, repeat)
                for pair in pairs for arm, repeat in (("P0", 1), ("P1", 1), ("P1", 2), ("P2", 1), ("P3", 1))]
    missing = [item for item in expected if item[0] not in saved["records"]]
    if not missing:
        raise ValueError("no interrupted cell")
    key, pair, arm, repeat = missing[0]
    prefix = {item[0] for item in expected[:len(saved["records"])]}
    if set(saved["records"]) != prefix or arm != "P1":
        raise ValueError("interrupted cell cannot be identified unambiguously")
    linked = set()
    for row in [*development.values(), *saved["records"].values()]:
        for billed in (row, row.get("jev", {})):
            if billed.get("spending_ticket"):
                linked.add(billed["spending_ticket"])
    if not linked.issubset(ledger["calls"]):
        raise ValueError("record spending ticket missing")
    orphaned = set(ledger["calls"]) - linked
    pin = value["models"]["P1"]
    ceiling = sum(pin["reservation_tokens"][kind] * pin["pricing_usd_per_million"][kind] for kind in ("input", "output")) / 1_000_000
    if len(orphaned) != 1 or ledger["calls"][next(iter(orphaned))] != ceiling:
        raise ValueError("interrupted reservation cannot be identified unambiguously")
    ticket = next(iter(orphaned))
    updated = json.loads(json.dumps(value))
    updated["settings"]["code_sha256"] = current
    updated["settings_sha256"] = digest(updated["settings"])
    updated["transport_recovery"] = {
        "approved": True, "approved_at": datetime.now(timezone.utc).isoformat(),
        "original_manifest_sha256": digest(value), "original_checkpoint_sha256": digest(saved),
        "spending_ledger_sha256": digest(ledger), "original_code_sha256": previous,
        "corrected_code_sha256": current, "recovery_code_sha256": file_digest(Path(__file__)),
        "frozen_controls_sha256": digest({name: setting for name, setting in value["settings"].items() if name != "code_sha256"}),
        "failed_key": key, "failure_retried": False,
        "reason": "DeepSeek closed a chunked response; catch IncompleteRead as a transport error. No inference or threshold change.",
    }
    error = {"status": "error", "code": "incomplete-response", "pair_id": pair["id"],
             "decision": pair["decision"], "arm": arm, "repeat": repeat, "swapped": False,
             "split": "test", "reference_kind": "ai-draft", "duration_seconds": None,
             "spending_ticket": ticket, "reserved_cost_usd": ceiling, "recovered_after_interruption": True}
    recovered = {"fingerprint": run_scope(updated, "test"), "records": {**saved["records"], key: error}}
    validate(updated, root)
    if spending_scope(updated) != spending_scope(value):
        raise ValueError("recovery changed spending approval")
    return updated, recovered


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--approve-transport-recovery", action="store_true")
    args = parser.parse_args()
    root = args.manifest.absolute().parent
    value = json.loads(output_path(args.manifest.absolute(), root).read_text())
    out = output_path(root.parent / "output/ai-pilot", root.parent)
    checkpoint = output_path(out / "test/eval_results_checkpoint.json", root.parent)
    ledger_path = output_path(out / "spending.json", root.parent)
    saved = json.loads(checkpoint.read_text())
    development = json.loads(output_path(out / "development/eval_results.json", root.parent).read_text())["records"]
    ledger = json.loads(ledger_path.read_text())
    ledger_hash = file_digest(ledger_path)
    updated, recovered = prepare_recovery(value, root, saved, development, ledger, approved=args.approve_transport_recovery)
    manifest = output_path(root / "ai-pilot-test-recovery-manifest.json", root)
    backup = output_path(out / "test/eval_results_checkpoint.before-transport-recovery.json", root.parent)
    if manifest.exists() or backup.exists():
        raise ValueError("recovery already recorded; use its manifest to resume")
    atomic_json(backup, root.parent, saved)
    atomic_json(manifest, root, updated)
    atomic_json(checkpoint, root.parent, recovered)
    if file_digest(ledger_path) != ledger_hash:
        raise ValueError("spending ledger changed during recovery")
    print(json.dumps({"recovered_error": updated["transport_recovery"]["failed_key"], "record_count": len(recovered["records"]),
                      "accounted_usd": sum(ledger["calls"].values()), "spend_cap_usd": ledger["limit"], "ledger_unchanged": True}), flush=True)


if __name__ == "__main__":
    main()
