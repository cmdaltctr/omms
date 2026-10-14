"""Exercise the AI-labelled corpus v2 diagnostic with synthetic pairs and mocked providers."""

import hashlib
import importlib
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

LABELS = {"d1": "same", "d2": "compatible", "t1": "same", "t2": "compatible", "t3": "different", "c1": "contradict", "c2": "same"}


def module():
    assert (Path(__file__).resolve().parents[1] / "review_pilot.py").exists(), "Review pilot required"
    return importlib.import_module("review_pilot")


def write(path, data):
    path.write_text(json.dumps(data))
    return hashlib.sha256(path.read_bytes()).hexdigest()


@pytest.fixture
def ready(tmp_path):
    from clef_pilot import GRID
    from providers import QUESTIONS
    corpus = tmp_path / "corpus"
    corpus.mkdir()
    pairs = [{"id": key, "decision": decision, "split": split, "entries": [key + "a", key + "b"], "group": key,
              "A": "Prefer terminal Git work " + key, "B": "Use command line Git " + key, "cosine": cosine}
             for key, decision, split, cosine in (("d1", "duplicate", "development", 0.82), ("d2", "conflict", "development", 0.7),
                                                  ("t1", "duplicate", "test", 0.9), ("t2", "conflict", "test", 0.7),
                                                  ("t3", "duplicate", "test", 0.6))]
    challenge = [{"id": key, "decision": decision, "A": "Always squash " + key, "B": "Never squash " + key, "outcome": "", "reason": ""}
                 for key, decision in (("c1", "conflict"), ("c2", "duplicate"))]
    write(corpus / "pairs-v2.json", pairs)
    write(corpus / "challenge-blind-review.json", challenge)
    exports = {}
    for name, rows in (("ai-review-export.json", pairs), ("ai-challenge-export.json", challenge)):
        labelled = [{key: row[key] for key in ("id", "decision", "A", "B")} | {"outcome": LABELS[row["id"]], "reason": "Synthetic AI label"}
                    for row in rows]
        exports[name] = {"export_sha256": write(corpus / name, labelled)}
    write(corpus / "ai-review-provenance.json", {"human_reviewed": False, "exports": exports})
    weights, server = tmp_path / "clef.gguf", tmp_path / "llama-server"
    weights.write_bytes(b"synthetic weights")
    server.write_bytes(b"synthetic server")
    pin = {"model": "clef-flash", "quantisation": "Q8_0", "gguf_path": str(weights), "server_path": str(server),
           "gguf_sha256": hashlib.sha256(weights.read_bytes()).hexdigest(), "server_sha256": hashlib.sha256(server.read_bytes()).hexdigest(),
           "launch_args": ["--host", "127.0.0.1", "--port", "3002", "--offline", "--log-disable"],
           "server_version": "synthetic", "hardware": {"cpu": "synthetic"}}
    write(corpus / "clef.json", {"model": pin, "settings": {"questions": QUESTIONS, "threshold_grid": GRID}})
    value = module().prepare(corpus, "clef.json", 5.0)
    return value, corpus


def answers(calls, *, deepseek=True, clef=0.9):
    def current(pair):
        calls.append(("P1", pair["id"], pair["A"]))
        return {"status": "ok", "answer": deepseek, "duration_seconds": 2.0}

    def local(pair):
        calls.append(("P6-clef", pair["id"], pair["A"]))
        return {"status": "ok", "probability": clef, "usage_cost_usd": 0, "duration_seconds": 0.2}
    return current, local


def run(value, corpus, split, calls, **options):
    from checkpoint import Checkpoint
    saved = Checkpoint(corpus.parent / f"{split}.json", corpus.parent, module().scope(value, split))
    current, local = answers(calls, **options)
    return module().evaluate(value, corpus, split, saved, deepseek=current, clef=local)


def test_prepare_counts_deepseek_calls_and_validates(ready):
    value, corpus = ready
    # development: 4 calls per pair (2 repeats x 2 orders); test and challenge: 2 repeats.
    assert value["deepseek_calls"] == 2 * 4 + 3 * 2 + 2 * 2
    assert value["approvals"]["review"] is False and value["human_reviewed"] is False
    module().validate(value, corpus)


def test_withheld_arms_are_refused_and_never_called(ready):
    from manifest import digest
    value, corpus = ready
    calls = []
    records = run(value, corpus, "development", calls)
    assert {arm for arm, _, _ in calls} == {"P1", "P6-clef"}
    assert {row["arm"] for row in records.values()} == {"P0", "P1", "P6-clef"}
    assert sum(arm == "P1" for arm, _, _ in calls) == 8 and sum(arm == "P6-clef" for arm, _, _ in calls) == 4
    for change in ({"arms": ["P0", "P1", "P6-clef", "P2"]}, {"arms": ["P0", "P1", "P6-clef", "P3"]}):
        with pytest.raises(ValueError, match="only P0, P1 and local Clef"):
            module().validate({**value, **change}, corpus)
    broken = json.loads(json.dumps(value))
    broken["models"]["P2"] = {"provider": "typesafe", "model": "jev-1.13.0"}
    with pytest.raises(ValueError, match="only P0, P1 and local Clef"):
        module().validate(broken, corpus)
    assert len(calls) == 12
    assert all(arm not in {cell[0] for split in module().SPLITS for cell in module().plan(split)} for arm in ("P2", "P3"))
    assert digest(value) == digest(ready[0])


def test_human_review_claims_and_changed_labels_are_refused(ready):
    value, corpus = ready
    for change in ({"human_reviewed": True}, {"approvals": {**value["approvals"], "review": True}},
                   {"approvals": {**value["approvals"], "spend_usd": 0.001}}):
        with pytest.raises(ValueError):
            module().validate({**value, **change}, corpus)
    rows = json.loads((corpus / "ai-review-export.json").read_text())
    rows[0]["outcome"] = "different"
    (corpus / "ai-review-export.json").write_text(json.dumps(rows))
    with pytest.raises(ValueError, match="file hash changed"):
        module().validate(value, corpus)


def test_test_and_challenge_need_the_development_freeze(ready):
    value, corpus = ready
    calls = []
    for split in ("test", "challenge"):
        with pytest.raises(ValueError, match="freeze"):
            run(value, corpus, split, calls)
    assert calls == []


def test_freeze_uses_development_only_and_test_keeps_order(ready):
    value, corpus = ready
    calls = []
    records = run(value, corpus, "development", calls, clef=0.9)
    # Swapped development orders reach providers; nothing from test does.
    assert {pair_id for _, pair_id, _ in calls} == {"d1", "d2"}
    assert any(text.startswith("Use command line") for _, _, text in calls)
    frozen = module().freeze(value, corpus, records)
    # d1 is a labelled duplicate at 0.82: the lowest cut-off that keeps it is 0.8; the d2 conflict is compatible.
    assert frozen["settings"]["embedding_thresholds"] == {"duplicate": 0.5, "conflict": 0.8}
    assert frozen["settings"]["clef_thresholds"] == {"duplicate": 0.5, "conflict": 0.95}
    rows = json.loads((corpus / "ai-review-export.json").read_text())
    for row in rows:
        if row["id"].startswith("t"):
            row["outcome"] = "uncertain"
    # Changing test labels cannot change the development freeze.
    assert module().freeze(value, corpus, records)["settings"] == frozen["settings"]
    calls.clear()
    run(frozen, corpus, "test", calls)
    assert {pair_id for _, pair_id, _ in calls} == {"t1", "t2", "t3"}
    assert all(not text.startswith("Use command line") for _, _, text in calls)
    with pytest.raises(ValueError, match="complete development"):
        module().freeze(value, corpus, {key: row for key, row in records.items() if row["arm"] != "P6-clef"})


def test_deepseek_caller_stops_at_the_spending_limit(ready, monkeypatch, tmp_path):
    from spending import Budget
    value, corpus = ready
    review = module()
    pairs, _ = review.validate(value, corpus)
    budget = Budget(tmp_path / "ledger.json", tmp_path, review.spending_scope(value), value["approvals"]["spend_usd"])
    monkeypatch.setenv("DEEPSEEK_API_KEY", "sk-synthetic")
    sent = []
    monkeypatch.setattr(review, "http_json", lambda url, payload, env: sent.append(url) or {
        "model": "deepseek-flash", "usage": {"prompt_tokens": 100, "completion_tokens": 10},
        "choices": [{"message": {"content": json.dumps({"duplicate": True})}}]})
    call = review.deepseek_caller(value, pairs, budget)
    first = call(pairs[0])
    assert first["usage_cost_usd"] > 0 and budget.used == first["usage_cost_usd"]
    budget.reserve(budget.state["limit"] - budget.used - 0.01)
    with pytest.raises(review.PilotStopped, match="spending"):
        call(pairs[0])
    assert len(sent) == 1
    with pytest.raises(ValueError, match="order"):
        call({**pairs[2], "A": pairs[2]["B"], "B": pairs[2]["A"]})


def test_summary_counts_wrong_yes_and_keeps_safety_inconclusive(ready):
    value, corpus = ready
    calls = []
    records = dict(run(value, corpus, "development", calls))
    frozen = module().freeze(value, corpus, records)
    records.update(run(frozen, corpus, "test", calls, deepseek=True, clef=0.9))
    records.update(run(frozen, corpus, "challenge", calls, deepseek=True, clef=0.9))
    summary = module().summarise(frozen, corpus, records, spent_usd=0.001)
    assert summary["complete"] and summary["merge_safety_verdict"] == "INCONCLUSIVE"
    duplicates = summary["splits"]["test"]["duplicate"]
    # t1 is same, t3 different: DeepSeek says YES twice per pair, so 4 YES and 2 wrong.
    assert duplicates["arms"]["P1"]["accepted_yes"] == 4 and duplicates["arms"]["P1"]["wrong_merges"] == 2
    clef = duplicates["arms"]["P6-clef"]
    assert clef["accepted_yes"] == 2 and clef["wrong_merges"] == 1 and clef["recognised_positives"] == 1
    assert clef["gates"]["P-G1"] == "INCONCLUSIVE" and clef["gates"]["P-G2"] == "INCONCLUSIVE"
    assert clef["gates"]["P-G3"] == "PASS" and clef["gates"]["P-G4"] == "N/A"
    assert clef["indicative_gates_vs_ai_labels"]["P-G1"] == "FAIL"
    assert summary["splits"]["test"]["conflict"]["arms"]["P6-clef"]["indicative_gates_vs_ai_labels"]["P-G1"] == "INCONCLUSIVE"
    assert "P0" not in summary["splits"]["challenge"]["duplicate"]["arms"]
    assert summary["calls"] == {"P1": 18, "P6-clef": 9}
    report = module().render_report(summary)
    assert "Merge safety: INCONCLUSIVE" in report and "Prefer terminal" not in report and "Synthetic AI label" not in report
