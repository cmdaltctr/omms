"""Focused tests of the approved offline replay contract."""

import copy
import importlib.util
import tempfile
from pathlib import Path

import pytest

SPEC = importlib.util.spec_from_file_location("experiment07", Path(__file__).with_name("run_eval.py"))
r = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(r)


def sample():
    events, _ = r.fixtures()
    query = next(e for e in events if e["id"] == "approved-1")
    state = [e for e in events if e["trace"] == "approved-1" and e["type"] == "approval"]
    return copy.deepcopy(query), copy.deepcopy(state)


@pytest.mark.parametrize("field", r.FIELDS)
def test_scope(field):
    query, state = sample()
    assert r.decide(query, state)["source"] == "assignment"
    query[field] += "different"
    if field == "section":
        query["catalogue"][query[field]] = ["a", "b"]
    assert r.decide(query, state)["source"] == "classifier"
    del query[field]
    with pytest.raises(ValueError, match="missing_scope"):
        r.decide(query, state)


def test_policy_fixture():
    events, answers = r.fixtures()
    rows = r.replay(events)
    assert len(rows) == 48 and len(answers) == 48
    assert sum(e["type"] != "query" for e in events) >= 24
    assert {row["id"]: {k: row[k] for k in ("source", "outcome")} for row in rows} == answers
    assert sum(row["source"] == "correction" for row in rows) == 8
    assert rows[0]["source"] == "classifier"


def test_eligibility_and_conflicts():
    query, state = sample()
    for label in ("none_fit", "invalid"):
        bad = copy.deepcopy(state)
        bad[0]["label"] = label
        assert r.decide(query, bad)["source"] == "classifier"
    query["options"] = ["b", "none_fit"]
    assert r.decide(query, state)["source"] == "classifier"
    query["options"] = ["a", "b"]
    query["catalogue"]["preferences"] = ["b"]
    assert r.decide(query, state)["source"] == "classifier"
    query["catalogue"]["preferences"] = ["a", "b"]
    state.append(dict(state[0], id="conflict", label="b"))
    assert r.decide(query, state)["reason"] == "ambiguous"


def test_explicit_events_only_and_supersession():
    query, state = sample()
    r.apply_event(state, dict(state[0], id="model", type="model", label="b"))
    assert r.decide(query, state)["outcome"]["choice"] == "a"
    r.apply_event(state, dict(state[0], id="correction", type="correction", label="b"))
    assert r.decide(query, state)["outcome"]["choice"] == "b"
    r.apply_event(state, dict(state[0], id="next", type="correction", label="a", supersedes="correction"))
    assert r.decide(query, state)["outcome"]["choice"] == "a"
    with pytest.raises(ValueError, match="invalid_supersession"):
        r.apply_event(state, dict(state[0], id="bad", type="correction", supersedes="future"))


def test_fallback_unchanged():
    query, _ = sample()
    for baseline in ({"status": "error", "code": "invalid"}, {"status": "review", "code": "abstain"},
                     {"status": "ok", "choice": "none_fit", "metadata": [1]}):
        query["baseline"] = baseline
        assert r.decide(query, [])["outcome"] == baseline


def test_inputs_and_original_parity():
    cases, records = r.load_baseline()
    rows = r.original_replay(cases, records)
    assert len(rows) == 140
    assert all(row["source"] == "classifier" and row["outcome"] == row["baseline"] for row in rows)
    events, answers = r.fixtures()
    summary = r.summarise(r.replay(events), rows, answers, cases)
    assert summary["functional_result"] == "PASS"
    assert summary["avoided_calls"] == 11 and summary["fresh_model_calls"] == 0
    assert summary["original_accuracy"]["correct_existing"] == 21
    broken = r.replay(events)
    broken[0]["outcome"] = {"status": "ok", "choice": "a"}
    assert r.summarise(broken, rows, answers, cases)["functional_result"] == "FAIL"


def test_duplicate_ids_and_atomic_json():
    events, _ = r.fixtures()
    with pytest.raises(ValueError, match="duplicate_event"):
        r.replay(events + [events[0]])
    with tempfile.TemporaryDirectory() as directory:
        path = Path(directory) / "cell.json"
        r.atomic(path, {"cell": 1})
        assert r.read_json(path) == {"cell": 1}
        assert not path.with_suffix(".json.tmp").exists()
        path.write_text('{"cell":1,"cell":2}')
        with pytest.raises(ValueError, match="duplicate_json_key"):
            r.read_json(path)


def test_baseline_ids(monkeypatch):
    original = r.read_json

    def missing(path):
        value = original(path)
        if path.name == "eval_results.json":
            value["records"].pop(next(iter(value["records"])))
        return value

    monkeypatch.setattr(r, "read_json", missing)
    with pytest.raises(ValueError, match="baseline_ids"):
        r.load_baseline()


def test_checkpoint_resume_and_readonly_verify(tmp_path, monkeypatch):
    (tmp_path / "report.md").write_text((r.HERE / "report.md").read_text())
    monkeypatch.setattr(r, "HERE", tmp_path)
    monkeypatch.setattr(r, "preserved_files", lambda: {})
    monkeypatch.setattr(r.subprocess, "check_output", lambda *a, **k: "test-commit")
    summary = r.execute(resume=True)
    assert r.execute(resume=True) == summary
    before = {str(p): p.read_bytes() for p in tmp_path.rglob("*") if p.is_file()}
    assert r.execute(verify=True) == summary
    assert before == {str(p): p.read_bytes() for p in tmp_path.rglob("*") if p.is_file()}
    with pytest.raises(ValueError, match="resume_required"):
        r.execute()
    path = tmp_path / "expected.json"
    value = r.read_json(path)
    value["approved-0"]["source"] = "assignment"
    r.atomic(path, value)
    with pytest.raises(ValueError, match="fingerprint_drift"):
        r.execute(resume=True)
