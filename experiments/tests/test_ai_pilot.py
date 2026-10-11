"""Test the approved AI-reference pilot without real hosted calls."""

import copy
import importlib
import json
import sys
from pathlib import Path
from urllib.error import HTTPError

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def module():
    assert (Path(__file__).resolve().parents[1] / "ai_pilot.py").exists(), "AI-reference pilot safeguards required"
    return importlib.import_module("ai_pilot")


@pytest.fixture
def ready(tmp_path):
    from manifest import digest, file_digest
    from providers import QUESTIONS
    pairs = [
        {"id": "d1", "decision": "duplicate", "entries": ["a", "b"], "group": "g1", "split": "development", "A": "First preference", "B": "Second preference", "cosine": 0.7},
        {"id": "t1", "decision": "duplicate", "entries": ["c", "d"], "group": "g2", "split": "test", "A": "Third preference", "B": "Fourth preference", "cosine": 0.8},
    ]
    labels = [{**pair, "outcome": "different", "reason": "Distinct requirements", "label_source": "AI-generated draft", "human_reviewed": False} for pair in pairs]
    reference = {"label_source": "AI-generated draft", "human_reviewed": False, "eligible_as_blind_user_ground_truth": False, "labels": labels}
    for name, value in (("source", []), ("corpus", pairs), ("reference", reference)):
        (tmp_path / (name + ".json")).write_text(json.dumps(value))
    files = {name: {"path": name + ".json", "sha256": file_digest(tmp_path / (name + ".json"))} for name in ("source", "corpus", "reference")}
    settings = {"embedding_thresholds": {"duplicate": 0.8, "conflict": 0.8}, "jev_thresholds": {"duplicate": 0.5, "conflict": 0.5}, "hybrid_band": [0.3, 0.7], "questions": QUESTIONS, "concurrency": 1, "code_sha256": module().code_pins()}
    value = {"version": 1, "reference_kind": "ai-draft", "source_commit": "a" * 40, "reference_time": "2026-10-10T00:00:00+00:00", "split_seed": 42, "files": files, "pairs": pairs,
             "models": module().model_pins(), "settings": settings,
             "test_split_sha256": digest([pairs[1]]), "settings_sha256": digest(settings),
             "approvals": {"review": False, "ai_reference": True, "gates": True, "calls": True, "transfer": {"P1": files["corpus"]["sha256"], "P2": files["corpus"]["sha256"]}, "spend_usd": 5},
             "estimated_cost_usd": 4.25}
    value["test_settings_frozen"] = True
    value["development_result_sha256"] = "a" * 64
    return value, tmp_path


def test_ai_reference_stays_separate_from_human_review(ready):
    from manifest import validate
    value, root = ready
    assert len(module().validate(value, root)) == 64
    with pytest.raises(ValueError):
        validate(value, root, hosted_arms=["P1", "P2"])
    value["approvals"]["review"] = True
    with pytest.raises(ValueError, match="human"):
        module().validate(value, root)


@pytest.mark.parametrize("field", ["ai_reference", "calls", "transfer", "spend_usd"])
def test_missing_approval_blocks_before_io(ready, field):
    value, root = ready
    del value["approvals"][field]
    with pytest.raises(ValueError):
        module().validate(value, root)


def test_changed_reference_and_code_pins_refused(ready):
    from manifest import digest
    value, root = ready
    value["settings"]["code_sha256"]["ai_pilot.py"] = "b" * 64
    value["settings_sha256"] = digest(value["settings"])
    with pytest.raises(ValueError, match="code"):
        module().validate(value, root)
    value["settings"]["code_sha256"] = module().code_pins()
    value["settings_sha256"] = digest(value["settings"])
    (root / "reference.json").write_text("[]")
    with pytest.raises(ValueError, match="hash"):
        module().validate(value, root)


def test_deepseek_reserves_and_bills_even_invalid_answers(ready, monkeypatch):
    from spending import Budget
    value, root = ready
    pilot = module()
    budget = Budget(root / "spending.json", root, pilot.spending_scope(value), 5)
    calls = []
    def transport(url, payload, env):
        calls.append(1)
        assert budget.used >= 0.39
        assert "outcome" not in json.dumps(payload)
        return {"model": "deepseek-flash", "choices": [{"message": {"content": '{"duplicate": "yes"}'}}], "usage": {"prompt_tokens": 100, "completion_tokens": 50}}
    monkeypatch.setattr(pilot, "http_json", transport)
    result = pilot.request(value, root, "P1", value["pairs"][0], budget)
    assert calls == [1]
    assert result["status"] == "error" and result["code"] == "invalid-answer"
    assert budget.used == pytest.approx(0.00009)
    assert result["usage_cost_usd"] == pytest.approx(0.00009)


def test_spending_limit_stops_before_request(ready, monkeypatch):
    from spending import Budget
    value, root = ready
    value["approvals"]["spend_usd"] = 0.1
    value["estimated_cost_usd"] = 0.05
    pilot = module()
    budget = Budget(root / "spending.json", root, pilot.spending_scope(value), 0.1)
    calls = []
    monkeypatch.setattr(pilot, "http_json", lambda *args: calls.append(1))
    with pytest.raises(pilot.PilotStopped, match="spending"):
        pilot.request(value, root, "P1", value["pairs"][0], budget)
    assert calls == []


def test_timeout_retains_reservation_without_secret_logging(ready, monkeypatch):
    from spending import Budget
    value, root = ready
    pilot = module()
    budget = Budget(root / "spending.json", root, pilot.spending_scope(value), 5)
    def transport(*args):
        raise TimeoutError("synthetic secret")
    monkeypatch.setattr(pilot, "http_json", transport)
    result = pilot.request(value, root, "P2", value["pairs"][0], budget)
    assert result["status"] == "error" and result["code"] == "timeout"
    assert budget.used > 0
    assert "synthetic secret" not in json.dumps(result)


def test_mismatched_payload_and_budget_never_call_provider(ready, monkeypatch):
    from spending import Budget
    value, root = ready
    pilot = module()
    budget = Budget(root / "spending.json", root, pilot.spending_scope(value), 5)
    calls = []
    monkeypatch.setattr(pilot, "http_json", lambda *args: calls.append(1))
    changed = {**value["pairs"][0], "A": "Unapproved content"}
    with pytest.raises(ValueError, match="pair"):
        pilot.request(value, root, "P2", changed, budget)
    budget.state["fingerprint"] = "b" * 64
    with pytest.raises(ValueError, match="budget"):
        pilot.request(value, root, "P2", value["pairs"][0], budget)
    assert calls == []


def test_calls_repeats_swaps_resume_and_safety_verdict(ready, monkeypatch):
    from checkpoint import Checkpoint
    from spending import Budget
    value, root = ready
    pilot = module()
    budget = Budget(root / "spending.json", root, pilot.spending_scope(value), 5)
    saved = Checkpoint(root / "state.json", root, pilot.run_scope(value, "development"))
    calls = []
    def transport(url, payload, env):
        calls.append(payload)
        if "questions" in payload:
            return {"model": "jev-1.13.0", "answers": {"decision": {"type": "noul", "noul": 0.5}}, "usage": {"input_tokens": 100, "output_tokens": 5}}
        return {"model": "deepseek-flash", "choices": [{"message": {"content": '{"duplicate": false}'}}], "usage": {"prompt_tokens": 100, "completion_tokens": 20}}
    monkeypatch.setattr(pilot, "http_json", transport)
    pilot.evaluate(value, root, "development", saved, budget)
    assert len(saved.records) == 9
    assert len(calls) == 10
    assert all(record["pair_id"] == "d1" for record in saved.records.values())
    assert all(record["reference_kind"] == "ai-draft" for record in saved.records.values())
    pilot.evaluate(value, root, "development", saved, budget)
    assert len(calls) == 10
    summary = pilot.summarise(value, root, saved.records, budget)
    assert summary["merge_safety_verdict"] == "INCONCLUSIVE"
    assert summary["human_reviewed"] is False


def test_fatal_auth_error_is_saved_then_stops(ready, monkeypatch):
    from checkpoint import Checkpoint
    from spending import Budget
    value, root = ready
    pilot = module()
    budget = Budget(root / "spending.json", root, pilot.spending_scope(value), 5)
    saved = Checkpoint(root / "state.json", root, pilot.run_scope(value, "test"))
    calls = []
    def transport(*args):
        calls.append(1)
        raise HTTPError("https://synthetic", 401, "secret", {}, None)
    monkeypatch.setattr(pilot, "http_json", transport)
    with pytest.raises(pilot.PilotStopped, match="provider"):
        pilot.evaluate(value, root, "test", saved, budget)
    assert len(calls) == 1
    assert any(record.get("http_status") == 401 for record in saved.records.values())
    assert "secret" not in (root / "state.json").read_text()


def test_tuning_uses_development_only_and_freezes_settings(ready):
    from manifest import digest
    value, root = ready
    pilot = module()
    assert hasattr(pilot, "tune"), "Development-only tuning required"
    records = {
        "d1/P2": {"pair_id": "d1", "arm": "P2", "repeat": 1, "swapped": False, "split": "development", "status": "ok", "probability": 0.7},
        "d1/P1": {"pair_id": "d1", "arm": "P1", "repeat": 1, "swapped": False, "split": "development", "status": "ok", "answer": False},
    }
    settings = pilot.tune(value, root, records)
    assert settings["jev_thresholds"]["duplicate"] > 0.7
    changed = {**records, "t1/P2": {"pair_id": "t1", "arm": "P2", "repeat": 1, "swapped": False, "split": "test", "status": "ok", "probability": 1}}
    assert pilot.tune(value, root, changed) == settings
    value["settings"] = settings
    value["settings_sha256"] = digest(settings)
    assert len(pilot.validate(value, root)) == 64


def test_report_cannot_claim_safety_pass(ready):
    from spending import Budget
    value, root = ready
    pilot = module()
    assert hasattr(pilot, "render_report"), "AI-reference limitations required"
    budget = Budget(root / "spending.json", root, pilot.spending_scope(value), 5)
    report = pilot.render_report(pilot.summarise(value, root, {}, budget))
    assert "INCONCLUSIVE" in report
    assert "AI-generated" in report
    assert "independent human" in report
    assert "no test cells" in report


def test_test_inference_requires_saved_freeze_before_io(ready, monkeypatch):
    from checkpoint import Checkpoint
    from spending import Budget
    value, root = ready
    value["test_settings_frozen"] = False
    pilot = module()
    saved = Checkpoint(root / "state.json", root, pilot.run_scope(value, "test"))
    budget = Budget(root / "spending.json", root, pilot.spending_scope(value), 5)
    calls = []
    monkeypatch.setattr(pilot, "http_json", lambda *args: calls.append(1))
    with pytest.raises(ValueError, match="freeze"):
        pilot.evaluate(value, root, "test", saved, budget)
    assert calls == []


def test_changed_served_model_is_saved_and_stops(ready, monkeypatch):
    from spending import Budget
    value, root = ready
    pilot = module()
    budget = Budget(root / "spending.json", root, pilot.spending_scope(value), 5)
    monkeypatch.setattr(pilot, "http_json", lambda *args: {"model": "unapproved-model", "usage": {"prompt_tokens": 100, "completion_tokens": 50}})
    result = pilot.request(value, root, "P1", value["pairs"][0], budget)
    assert result["code"] == "model-mismatch"
    assert result["fatal"] is True
    assert budget.used == pytest.approx(0.00009)


def test_repeat_and_swap_diagnostics_keep_exclusions_visible(ready):
    from spending import Budget
    value, root = ready
    pilot = module()
    budget = Budget(root / "spending.json", root, pilot.spending_scope(value), 5)
    records = {
        "t1/1": {"pair_id": "t1", "decision": "duplicate", "arm": "P1", "repeat": 1, "swapped": False, "split": "test", "status": "ok", "answer": False, "duration_seconds": 2, "cold": True},
        "t1/2": {"pair_id": "t1", "decision": "duplicate", "arm": "P1", "repeat": 2, "swapped": False, "split": "test", "status": "ok", "answer": True, "duration_seconds": 1, "cold": False},
        "d1/0": {"pair_id": "d1", "decision": "duplicate", "arm": "P2", "repeat": 1, "swapped": False, "split": "development", "status": "ok", "answer": False, "duration_seconds": 0.1},
        "d1/1": {"pair_id": "d1", "decision": "duplicate", "arm": "P2", "repeat": 1, "swapped": True, "split": "development", "status": "ok", "answer": True, "duration_seconds": 0.1},
    }
    summary = pilot.summarise(value, root, records, budget)
    assert summary["diagnostics"]["deepseek_repeat_flips"] == 1
    assert summary["diagnostics"]["development_swap_flips"]["P2"] == 1
    assert summary["decisions"]["duplicate"]["P1"]["cold_mean_seconds"] == 2
    assert summary["decisions"]["duplicate"]["P1"]["warmed_mean_seconds"] == 1


def test_documented_cli_writes_results_and_frozen_test_manifest(ready, monkeypatch):
    import importlib.util
    import shutil
    from checkpoint import atomic_json
    value, tmp_path = ready
    root = tmp_path / "corpus"
    root.mkdir()
    for record in value["files"].values():
        shutil.copyfile(tmp_path / record["path"], root / record["path"])
    value["test_settings_frozen"] = False
    manifest_path = root / "ai-pilot-development-manifest.json"
    atomic_json(manifest_path, root, value)
    path = Path(__file__).resolve().parents[1] / "03-pair-decisions-2026-10-10/run_ai_pilot.py"
    spec = importlib.util.spec_from_file_location("pilot_cli", path)
    cli = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(cli)
    pilot = module()
    calls = []
    def transport(url, payload, env):
        calls.append(payload)
        if "questions" in payload:
            return {"model": "jev-1.13.0", "answers": {"decision": {"type": "noul", "noul": 0.1}}, "usage": {"input_tokens": 100, "output_tokens": 5}}
        return {"model": "deepseek-flash", "choices": [{"message": {"content": '{"duplicate": false}'}}], "usage": {"prompt_tokens": 100, "completion_tokens": 20}}
    monkeypatch.setattr(pilot, "http_json", transport)
    monkeypatch.setenv("DEEPSEEK_API_KEY", "synthetic-credential-a")
    monkeypatch.setenv("TYPESAFE_API_KEY", "synthetic-credential-b")
    monkeypatch.setattr(sys, "argv", [str(path), "--manifest", str(manifest_path), "--split", "development"])
    cli.main()
    assert len(calls) == 8
    frozen = root / "ai-pilot-test-manifest.json"
    assert json.loads(frozen.read_text())["test_settings_frozen"] is True
    before = len(calls)
    monkeypatch.setattr(sys, "argv", [str(path), "--manifest", str(frozen), "--split", "test"])
    cli.main()
    out = tmp_path / "output/ai-pilot"
    summary = json.loads((out / "eval_results.summary.json").read_text())
    assert summary["record_count"] == 14
    assert summary["merge_safety_verdict"] == "INCONCLUSIVE"
    assert (out / "report.md").exists()
    assert len(calls) == before + 4
    analysis_path = path.parent / "analysis.py"
    analysis_spec = importlib.util.spec_from_file_location("pilot_analysis", analysis_path)
    analysis = importlib.util.module_from_spec(analysis_spec)
    analysis_spec.loader.exec_module(analysis)
    previous = len(calls)
    analysed = analysis.load_rows(out / "eval_results.summary.json")
    assert len(analysed) == 8
    assert all(row["complete"] for row in analysed if row["decision"] == "duplicate")
    assert len(calls) == previous
    original_files = {file: file.read_bytes() for file in out.rglob("*.json")}
    checked = analysis.verify_saved_results(out / "eval_results.summary.json", frozen)
    assert checked["metrics_reproduced"] is True
    assert checked["all_required_records_accounted"] is True
    assert checked["expected_records"] == 14
    assert checked["unlinked_spending_tickets"] == 0
    assert len(calls) == previous
    assert all(file.read_bytes() == content for file, content in original_files.items())
    corrupted = {**summary, "record_count": 999}
    (out / "eval_results.summary.json").write_text(json.dumps(corrupted))
    with pytest.raises(ValueError, match="record_count"):
        analysis.verify_saved_results(out / "eval_results.summary.json", frozen)


@pytest.mark.parametrize("arm", ["P1", "P2"])
def test_incomplete_response_is_checkpointed_without_retry(ready, monkeypatch, arm):
    from http.client import IncompleteRead
    from checkpoint import Checkpoint
    from spending import Budget
    import providers
    value, root = ready
    pilot = module()
    calls = []
    class BrokenResponse:
        def __enter__(self):
            return self
        def __exit__(self, *args):
            pass
        def read(self):
            raise IncompleteRead(b"synthetic private response")
    class Opener:
        def open(self, request, *, timeout):
            calls.append(request.full_url)
            assert timeout == 30
            return BrokenResponse()
    monkeypatch.setattr(providers, "build_opener", lambda *args: Opener())
    monkeypatch.setenv(value["models"][arm]["credential_env"], "synthetic-credential")
    budget = Budget(root / "spending.json", root, pilot.spending_scope(value), 5)
    saved = Checkpoint(root / "state.json", root, pilot.run_scope(value, "test"))
    pair = value["pairs"][1]
    result = pilot.request(value, root, arm, pair, budget)
    saved.record(f't1/{arm}/1/0', {**result, "pair_id": "t1", "arm": arm, "repeat": 1, "swapped": False, "split": "test"})
    assert result["status"] == "error" and result["code"] == "transport-error"
    assert calls == [value["models"][arm]["endpoint"]]
    assert budget.used == result["reserved_cost_usd"]
    resumed = Checkpoint(root / "state.json", root, pilot.run_scope(value, "test"), resume=True)
    assert resumed.should_run(f't1/{arm}/1/0') is False
    assert "synthetic private response" not in (root / "state.json").read_text()
    assert "synthetic-credential" not in (root / "state.json").read_text()
