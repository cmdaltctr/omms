"""Exercise pair arms and split isolation through mocked provider calls."""

import importlib.util
import json
import sys
from pathlib import Path

import pytest
from test_manifest import manifest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def module():
    path = Path(__file__).resolve().parents[1] / "03-pair-decisions-2026-10-10/run_eval.py"
    assert path.is_file(), "Pair runner required"
    spec = importlib.util.spec_from_file_location("pair_runner", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def ready(manifest):
    from manifest import digest, file_digest
    value, root = manifest
    for pair in value["pairs"]:
        pair.update(decision="duplicate", A="First synthetic description", B="Second synthetic description", cosine=0.7)
    (root / "corpus.json").write_text(json.dumps(value["pairs"]))
    truth = {pair["id"]: {"outcome": "same" if pair["split"] == "development" else "different", "reason": "Synthetic reviewed fixture"} for pair in value["pairs"]}
    (root / "ground_truth.json").write_text(json.dumps(truth))
    for name in ("corpus", "ground_truth"):
        value["files"][name]["sha256"] = file_digest(root / value["files"][name]["path"])
    value["models"]["P2"] = {"status": "ready", "provider": "typesafe", "model": "jev-1.13.0", "parameters": {}}
    value["approvals"]["transfer"]["P2"] = value["files"]["corpus"]["sha256"]
    value["approvals"]["transfer"]["P1"] = value["files"]["corpus"]["sha256"]
    value["settings"] = {"embedding_thresholds": {"duplicate": 0.8, "conflict": 0.8}, "jev_thresholds": {"duplicate": 0.5, "conflict": 0.5}, "hybrid_band": [0.3, 0.7], "questions": {"duplicate": "same meaning?", "conflict": "contradictory?"}, "concurrency": 1}
    base = Path(__file__).resolve().parents[1]
    names = ["providers.py", "manifest.py", "checkpoint.py", "spending.py", "03-pair-decisions-2026-10-10/run_eval.py"]
    value["settings"]["code_sha256"] = {name: file_digest(base / name) for name in names}
    value["settings_sha256"] = digest(value["settings"])
    value["test_split_sha256"] = digest([value["pairs"][1]])
    return value, root


def test_repeats_swaps_and_resume_keep_test_pairs_out(ready):
    from checkpoint import Checkpoint
    from manifest import validate
    value, root = ready
    current_calls, jev_calls = [], []
    def current(pair):
        current_calls.append(pair)
        return {"status": "ok", "answer": True}
    def jev(pair):
        jev_calls.append(pair)
        return {"status": "ok", "probability": 0.9}
    saved = Checkpoint(root / "state.json", root, module().run_fingerprint(value, root, "development"))
    module().evaluate(value, root, "development", saved, current, jev)
    assert len(current_calls) == 4
    assert len(jev_calls) == 4
    assert all(pair["id"] == "d1" for pair in current_calls + jev_calls)
    assert len(saved.records) == 9
    assert any(record.get("cold") is True for record in saved.records.values())
    assert any(record.get("cold") is False for record in saved.records.values())
    assert {record["repeat"] for record in saved.records.values() if record["arm"] == "P1"} == {1, 2}
    module().evaluate(value, root, "development", saved, current, jev)
    assert len(current_calls) == 4
    assert len(jev_calls) == 4


def test_hybrid_fallback_and_invalid_answers_are_retained(ready):
    from checkpoint import Checkpoint
    from manifest import validate
    value, root = ready
    calls = []
    def current(pair):
        calls.append(pair["id"])
        return {"status": "ok", "answer": "yes"}
    saved = Checkpoint(root / "state.json", root, module().run_fingerprint(value, root, "test"))
    module().evaluate(value, root, "test", saved, current, lambda pair: {"status": "ok", "probability": 0.5})
    assert len(calls) == 3
    p1 = [record for record in saved.records.values() if record["arm"] == "P1"]
    assert all(record["status"] == "error" for record in p1)
    hybrid = next(record for record in saved.records.values() if record["arm"] == "P3")
    assert hybrid["fallback"] is True
    assert hybrid["status"] == "error"
    assert len(saved.records) == 5


def test_timeouts_and_missing_review_block_or_count_as_errors(ready):
    from checkpoint import Checkpoint
    from manifest import validate
    value, root = ready
    def timed_out(pair):
        raise TimeoutError("secret provider message")
    saved = Checkpoint(root / "state.json", root, module().run_fingerprint(value, root, "test"))
    module().evaluate(value, root, "test", saved, timed_out, timed_out)
    records = [record for record in saved.records.values() if record["arm"] != "P0"]
    assert all(record["status"] == "error" and record["code"] == "timeout" for record in records)
    assert "secret" not in json.dumps(records)
    value["approvals"]["review"] = False
    with pytest.raises(ValueError):
        module().evaluate(value, root, "test", saved, timed_out, timed_out)


def test_changed_code_pin_blocks_before_any_provider_call(ready):
    from checkpoint import Checkpoint
    from manifest import digest, validate
    value, root = ready
    value["settings"]["code_sha256"]["providers.py"] = "b" * 64
    value["settings_sha256"] = digest(value["settings"])
    saved = Checkpoint(root / "state.json", root, module().run_fingerprint(value, root, "test"))
    calls = []
    def current(pair):
        calls.append(1)
        return {"status": "ok", "answer": False}
    with pytest.raises(ValueError, match="code"):
        module().evaluate(value, root, "test", saved, current, lambda pair: {"status": "ok", "probability": 0.9})
    assert calls == []


def test_hybrid_retains_jev_usage_when_it_falls_back(ready):
    from checkpoint import Checkpoint
    from manifest import validate
    value, root = ready
    saved = Checkpoint(root / "state.json", root, module().run_fingerprint(value, root, "test"))
    module().evaluate(value, root, "test", saved, lambda pair: {"status": "ok", "answer": False}, lambda pair: {"status": "ok", "probability": 0.5, "usage": {"input_tokens": 300, "output_tokens": 10}, "usage_cost_usd": 0.0000126})
    hybrid = next(record for record in saved.records.values() if record["arm"] == "P3")
    assert hybrid["jev"]["usage"]["input_tokens"] == 300
    assert hybrid["jev"]["usage_cost_usd"] == 0.0000126


def test_checkpoint_from_another_split_is_refused(ready):
    from checkpoint import Checkpoint
    from manifest import validate
    value, root = ready
    saved = Checkpoint(root / "state.json", root, module().run_fingerprint(value, root, "development"))
    saved.record("development-marker", {"status": "ok", "split": "development", "arm": "P0"})
    calls = []
    def current(pair):
        calls.append(1)
        return {"status": "ok", "answer": False}
    with pytest.raises(ValueError, match="split"):
        module().evaluate(value, root, "test", saved, current, lambda pair: {"status": "ok", "probability": 0.9})
    assert calls == []
