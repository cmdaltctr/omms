"""Verify the approved challenge cases keep blindness and the approved shape."""

import importlib.util
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def script():
    path = Path(__file__).resolve().parents[1] / "03-pair-decisions-2026-10-10" / "challenge_cases.py"
    assert path.is_file(), "challenge case builder required"
    spec = importlib.util.spec_from_file_location("challenge_cases", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def built(tmp_path):
    module = script()
    (tmp_path / "corpus").mkdir(parents=True)
    import sys as _sys
    old = _sys.argv
    _sys.argv = ["challenge_cases.py", "--root", str(tmp_path)]
    try:
        module.main()
    finally:
        _sys.argv = old
    review = json.loads((tmp_path / "corpus" / "challenge-blind-review.json").read_text())
    design = json.loads((tmp_path / "corpus" / "challenge-design.json").read_text())
    return review, design


def test_counts_match_the_approved_shape(tmp_path):
    review, design = built(tmp_path)
    assert len(review) == 80
    assert design["intended_counts"] == {"same": 20, "different": 20, "contradict": 24, "compatible": 16}


def test_decisions_and_intended_outcomes_stay_consistent(tmp_path):
    review, design = built(tmp_path)
    intended = {case["id"]: case["intended"] for case in design["cases"]}
    for record in review:
        if record["decision"] == "duplicate":
            assert intended[record["id"]] in ("same", "different")
        else:
            assert intended[record["id"]] in ("contradict", "compatible")


def test_blind_file_holds_no_intended_outcome_or_score(tmp_path):
    review, design = built(tmp_path)
    blob = json.dumps(review).lower()
    assert all(set(record) == {"id", "decision", "A", "B", "outcome", "reason"} for record in review)
    assert "intended" not in blob and "cosine" not in blob and "centroid" not in blob
    assert all(record["outcome"] == "" and record["reason"] == "" for record in review)


def test_ids_are_unique_and_design_covers_every_case(tmp_path):
    review, design = built(tmp_path)
    ids = [record["id"] for record in review]
    assert len(ids) == len(set(ids)) == len(design["cases"])
    assert {case["id"] for case in design["cases"]} == set(ids)


def test_a_case_short_of_the_approved_shape_fails(tmp_path):
    module = script()
    cases = module.build_cases()
    module.build_cases = lambda: cases[:-1]
    import sys as _sys
    (tmp_path / "corpus").mkdir(parents=True)
    old = _sys.argv
    _sys.argv = ["challenge_cases.py", "--root", str(tmp_path)]
    try:
        with pytest.raises(SystemExit) as raised:
            module.main()
        assert raised.value.code == 1
    finally:
        _sys.argv = old
