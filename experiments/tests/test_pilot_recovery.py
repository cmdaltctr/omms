"""Preserve frozen controls and spending during the approved transport repair."""

import copy
import hashlib
import importlib.util
import json
from pathlib import Path

import pytest
from test_ai_pilot import ready


def module():
    path = Path(__file__).resolve().parents[1] / "03-pair-decisions-2026-10-10/recover_ai_pilot.py"
    assert path.exists(), "Explicit transport recovery required"
    spec = importlib.util.spec_from_file_location("pilot_recovery", path)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


@pytest.fixture
def interrupted(ready):
    from ai_pilot import run_scope, spending_scope
    from manifest import digest
    value, root = ready
    source = (Path(__file__).resolve().parents[1] / "providers.py").read_text()
    previous = source.replace("from http.client import IncompleteRead\n", "").replace(
        '        try:\n            return json.load(response)\n        except IncompleteRead:\n            raise URLError("incomplete-response") from None\n',
        '        return json.load(response)\n',
    )
    assert previous != source
    value["settings"]["code_sha256"]["providers.py"] = hashlib.sha256(previous.encode()).hexdigest()
    value["settings_sha256"] = digest(value["settings"])
    development = {}
    value["development_result_sha256"] = digest(development)
    records = {
        "t1/P0/1/0": {"pair_id": "t1", "decision": "duplicate", "arm": "P0", "repeat": 1, "swapped": False, "split": "test", "status": "ok", "answer": True, "duration_seconds": 0.01},
        "t1/P1/1/0": {"pair_id": "t1", "decision": "duplicate", "arm": "P1", "repeat": 1, "swapped": False, "split": "test", "status": "ok", "answer": False, "duration_seconds": 1, "spending_ticket": "settled"},
    }
    saved = {"fingerprint": run_scope(value, "test"), "records": records}
    ledger = {"fingerprint": spending_scope(value), "limit": 5, "calls": {"settled": 0.00009, "interrupted": 0.786432}}
    return value, root, saved, development, ledger


def test_transport_recovery_requires_separate_approval(interrupted):
    value, root, saved, development, ledger = interrupted
    with pytest.raises(ValueError, match="approval"):
        module().prepare_recovery(value, root, saved, development, ledger)


def test_recovery_keeps_records_budget_and_frozen_decisions(interrupted):
    from ai_pilot import run_scope, spending_scope, validate
    value, root, saved, development, ledger = interrupted
    originals = copy.deepcopy((value, saved, development, ledger))
    updated, recovered = module().prepare_recovery(value, root, saved, development, ledger, approved=True)
    assert (value, saved, development, ledger) == originals
    assert validate(updated, root)
    assert spending_scope(updated) == spending_scope(value)
    assert recovered["fingerprint"] == run_scope(updated, "test")
    assert updated["test_split_sha256"] == value["test_split_sha256"]
    assert updated["development_result_sha256"] == value["development_result_sha256"]
    for key, setting in value["settings"].items():
        if key != "code_sha256":
            assert updated["settings"][key] == setting
    for key, row in saved["records"].items():
        assert recovered["records"][key] == row
    error = recovered["records"]["t1/P1/2/0"]
    assert error["status"] == "error" and error["code"] == "incomplete-response"
    assert error["spending_ticket"] == "interrupted"
    assert error["duration_seconds"] is None
    assert error["reserved_cost_usd"] == ledger["calls"]["interrupted"]
    assert updated["transport_recovery"]["failed_key"] == "t1/P1/2/0"
    assert updated["transport_recovery"]["failure_retried"] is False


@pytest.mark.parametrize("change", ["code", "checkpoint", "ledger", "development", "orphan"])
def test_recovery_refuses_ambiguous_or_changed_state(interrupted, change):
    value, root, saved, development, ledger = interrupted
    if change == "code":
        value["settings"]["code_sha256"]["ai_pilot.py"] = "b" * 64
    elif change == "checkpoint":
        saved["fingerprint"] = "b" * 64
    elif change == "ledger":
        ledger["limit"] = 10
    elif change == "development":
        value["development_result_sha256"] = "b" * 64
    else:
        ledger["calls"]["unrelated"] = 0.786432
    with pytest.raises(ValueError):
        module().prepare_recovery(value, root, saved, development, ledger, approved=True)


def test_recovered_checkpoint_skips_failure_without_resetting_ledger(interrupted, monkeypatch):
    import ai_pilot
    from checkpoint import Checkpoint, atomic_json
    from spending import Budget
    value, root, saved, development, ledger = interrupted
    updated, recovered = module().prepare_recovery(value, root, saved, development, ledger, approved=True)
    atomic_json(root / "state.json", root, recovered)
    atomic_json(root / "spending.json", root, ledger)
    before = (root / "spending.json").read_bytes()
    state = Checkpoint(root / "state.json", root, ai_pilot.run_scope(updated, "test"), resume=True)
    budget = Budget(root / "spending.json", root, ai_pilot.spending_scope(updated), 5, resume=True)
    calls = []
    def transport(url, payload, env):
        calls.append(url)
        return {"model": "jev-1.13.0", "answers": {"decision": {"type": "noul", "noul": 0.1}}, "usage": {"input_tokens": 100, "output_tokens": 1}}
    monkeypatch.setattr(ai_pilot, "http_json", transport)
    assert state.should_run("t1/P1/2/0") is False
    assert (root / "spending.json").read_bytes() == before
    ai_pilot.evaluate(updated, root, "test", state, budget)
    assert len(calls) == 2
    assert all(url == ai_pilot.JEV_URL for url in calls)
    assert state.records["t1/P1/2/0"] == recovered["records"]["t1/P1/2/0"]
    assert budget.state["calls"]["interrupted"] == 0.786432
    summary = ai_pilot.summarise(updated, root, state.records, budget)
    assert summary["merge_safety_verdict"] == "INCONCLUSIVE"
    assert summary["decisions"]["duplicate"]["P1"]["complete"] is False
    assert summary["decisions"]["duplicate"]["P1"]["errors"] == 1


def test_recovery_cli_preserves_originals_and_writes_resume_manifest(interrupted, monkeypatch):
    import shutil
    from checkpoint import atomic_json
    value, base, saved, development, ledger = interrupted
    root = base / "corpus"
    root.mkdir()
    for item in value["files"].values():
        shutil.copyfile(base / item["path"], root / item["path"])
    manifest_path = root / "ai-pilot-test-manifest.json"
    out = base / "output/ai-pilot"
    state_path = out / "test/eval_results_checkpoint.json"
    ledger_path = out / "spending.json"
    atomic_json(manifest_path, base, value)
    atomic_json(state_path, base, saved)
    atomic_json(ledger_path, base, ledger)
    atomic_json(out / "development/eval_results.json", base, {"records": development})
    originals = (manifest_path.read_bytes(), state_path.read_bytes(), ledger_path.read_bytes())
    recovery = module()
    monkeypatch.setattr(recovery.sys, "argv", [recovery.__file__, "--manifest", str(manifest_path), "--approve-transport-recovery"])
    recovery.main()
    assert manifest_path.read_bytes() == originals[0]
    assert ledger_path.read_bytes() == originals[2]
    assert (state_path.parent / "eval_results_checkpoint.before-transport-recovery.json").read_bytes() == originals[1]
    recovered = json.loads(state_path.read_text())
    resume = json.loads((root / "ai-pilot-test-recovery-manifest.json").read_text())
    assert recovered["fingerprint"] != saved["fingerprint"]
    assert len(recovered["records"]) == len(saved["records"]) + 1
    assert resume["transport_recovery"]["approved"] is True
    with pytest.raises(ValueError):
        recovery.main()
