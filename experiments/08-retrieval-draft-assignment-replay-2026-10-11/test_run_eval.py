"""Focused checks for provisional historical-observation replay."""

import copy
import importlib.util
from pathlib import Path

import pytest

SPEC = importlib.util.spec_from_file_location("experiment08", Path(__file__).with_name("run_eval.py"))
r = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(r)


def test_drafts_and_membership(monkeypatch):
    inputs = r.load_inputs()
    assert len(inputs[0]) == 20 and len(inputs[-1]["assignments"]) == 10
    read = r.engine.read_json

    def invalid(path):
        data = read(path)
        if path.name == "drafts.json":
            data["assignments"]["04830c081b284389ce20c550"]["label"] = "not_in_catalogue"
        return data

    monkeypatch.setattr(r.engine, "read_json", invalid)
    with pytest.raises(ValueError, match="draft_membership"):
        r.load_inputs()


def test_provenance(monkeypatch):
    read = r.engine.read_json

    def promoted(path):
        data = read(path)
        if path.name == "drafts.json":
            data["human_reviewed"] = True
        return data

    monkeypatch.setattr(r.engine, "read_json", promoted)
    with pytest.raises(ValueError, match="draft_provenance"):
        r.load_inputs()


def test_phase_order_and_uncached_outcomes():
    inputs = r.load_inputs()
    cells = r.replay(inputs)
    assert list(cells) == ["initial", "repeat", "unseen"]
    assert all(row["source"] == "classifier" for row in cells["initial"] + cells["unseen"])
    assert sum(row["source"] == "assignment" for row in cells["repeat"]) == 3
    assert all(row["source"] == "classifier" for row in cells["repeat"] if not row["eligible_draft"])


def test_scope_and_complete_fallback():
    inputs = r.load_inputs()
    case = inputs[0][3]
    query = r.query_for(case, *inputs[1:4])
    event = {f: query[f] for f in r.engine.FIELDS}
    event.update(id="fixture", type="approval", label=inputs[-1]["assignments"][case["id"]]["label"])
    assert r.engine.decide(query, [event])["source"] == "assignment"
    other = copy.deepcopy(query)
    other["project"] = "other"
    assert r.engine.decide(other, [event])["source"] == "classifier"
    query["baseline"] = {"status": "error", "code": "fixture", "extra": [1, 2]}
    assert r.engine.decide(query, [])["outcome"] == query["baseline"]
    assert r.query_for(case, *inputs[1:4])["description"] == case["description"]


def test_summary_gate():
    inputs = r.load_inputs()
    cells = r.replay(inputs)
    summary = r.summarise(cells, inputs[-1])
    assert summary["functional_result"] == "PASS"
    assert (summary["queries"], summary["draft_hits"], summary["misses"]) == (30, 3, 27)
    cells["repeat"][3]["human_reviewed"] = True
    assert r.summarise(cells, inputs[-1])["functional_result"] == "FAIL"


def test_baseline_missing(monkeypatch):
    read = r.engine.read_json

    def missing(path):
        data = read(path)
        if path.name == "eval_results.json":
            data["records"].pop(next(iter(data["records"])))
        return data

    monkeypatch.setattr(r.engine, "read_json", missing)
    with pytest.raises(ValueError, match="baseline_missing"):
        r.load_inputs()


def test_resume_and_readonly_verify(tmp_path, monkeypatch):
    for name in ("report.md", "drafts.json"):
        (tmp_path / name).write_bytes((r.HERE / name).read_bytes())
    # Keep temporary manifests inside the known experiment tree for relative paths.
    monkeypatch.setattr(r, "HERE", tmp_path)
    monkeypatch.setattr(r, "EXPERIMENTS", Path("/"))
    monkeypatch.setattr(r, "preservation", lambda: {})
    monkeypatch.setattr(r.subprocess, "check_output", lambda *a, **k: "test-commit")
    summary = r.execute()
    assert r.execute(resume=True) == summary
    before = {str(p): p.read_bytes() for p in tmp_path.rglob("*") if p.is_file()}
    assert r.execute(verify=True) == summary
    assert before == {str(p): p.read_bytes() for p in tmp_path.rglob("*") if p.is_file()}
    path = tmp_path / "drafts.json"
    data = r.engine.read_json(path)
    data["assignments"]["0170dd69da3fa2576c9b25b3"]["note"] += "changed"
    r.engine.atomic(path, data)
    with pytest.raises(ValueError, match="fingerprint_drift"):
        r.execute(resume=True)
