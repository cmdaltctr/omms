"""Verify pair metrics and gates against hand-calculated fixtures."""

import importlib
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def module():
    assert (Path(__file__).resolve().parents[1] / "pair_metrics.py").is_file(), "Pair metrics required"
    return importlib.import_module("pair_metrics")


def fixture(count=100, decision="duplicate"):
    pairs = [{"id": str(i), "decision": decision, "split": "test", "group": str(i)} for i in range(count)]
    truth = {str(i): {"outcome": "same" if decision == "duplicate" else "contradict", "reason": "Synthetic reviewed fixture"} for i in range(count)}
    records = []
    for pair in pairs:
        for arm, repeat in (("P0", 1), ("P1", 1), ("P1", 2), ("P2", 1), ("P3", 1)):
            records.append({"pair_id": pair["id"], "decision": decision, "arm": arm, "repeat": repeat, "split": "test", "swapped": False, "status": "ok", "answer": True, "duration_seconds": 2.0 if arm == "P1" else 0.4, "fallback": arm == "P3" and int(pair["id"]) < 30})
    return pairs, truth, records


def test_exact_speed_fallback_and_false_merge_boundaries():
    pairs, truth, records = fixture()
    result = module().summarise(pairs, truth, records)
    assert result["duplicate"]["P2"]["verdict"] == "PASS"
    assert result["duplicate"]["P3"]["verdict"] == "PASS"
    assert result["duplicate"]["P3"]["metrics"]["fallback_rate"] == 0.3
    assert result["duplicate"]["P2"]["metrics"]["seconds_per_60"] == pytest.approx(24)
    assert result["duplicate"]["P2"]["metrics"]["false_merge_rate"] == 0
    assert result["duplicate"]["P2"]["metrics"]["false_merge_upper95"] < 0.05
    assert result["conflict"]["P2"]["verdict"] == "INCONCLUSIVE"


def test_wrong_merges_fail_despite_speed():
    pairs, truth, records = fixture()
    for record in records:
        if record["arm"] == "P2":
            record["duration_seconds"] = 0.001
    truth["0"]["outcome"] = "different"
    for record in records:
        if record["pair_id"] == "0" and record["arm"] == "P1":
            record["answer"] = False
    result = module().summarise(pairs, truth, records)
    assert result["duplicate"]["P2"]["verdict"] == "FAIL"
    assert result["duplicate"]["P2"]["metrics"]["false_merge_rate"] == 0.01


def test_undefined_rates_incomplete_cells_and_few_contradictions():
    pairs, truth, records = fixture(29, "conflict")
    result = module().summarise(pairs, truth, records)
    assert result["conflict"]["P2"]["verdict"] == "INCONCLUSIVE"
    pairs, truth, records = fixture()
    records = [record for record in records if not (record["arm"] == "P1" and record["repeat"] == 2 and record["pair_id"] == "0")]
    result = module().summarise(pairs, truth, records)
    assert result["duplicate"]["P2"]["gates"]["P-G5"] == "INCONCLUSIVE"
    for record in records:
        if record["arm"] == "P2":
            record["answer"] = False
    result = module().summarise(pairs, truth, records)
    assert result["duplicate"]["P2"]["metrics"]["false_merge_rate"] is None


def test_errors_count_as_wrong_and_uncertain_answers_cannot_pass():
    pairs, truth, records = fixture()
    for record in records:
        if record["arm"] == "P2" and record["pair_id"] == "0":
            record.update(status="error", code="timeout")
            record.pop("answer")
    result = module().summarise(pairs, truth, records)
    assert result["duplicate"]["P2"]["metrics"]["agreement"] == 0.99
    truth["1"]["outcome"] = "uncertain"
    result = module().summarise(pairs, truth, records)
    assert result["duplicate"]["P2"]["metrics"]["uncertain_accepted"] == 1
    assert result["duplicate"]["P2"]["verdict"] == "INCONCLUSIVE"
