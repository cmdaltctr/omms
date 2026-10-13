"""Synthetic, offline tests for Experiment 01 only."""

import copy
import importlib.util
import json
import os
import sys
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
CODE = Path(os.environ.get("LABEL_TEST_CODE", HERE))
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(CODE))
from checkpoint import Checkpoint, atomic_json
from manifest import digest, file_digest
import labels

spec = importlib.util.spec_from_file_location("label_runner", CODE / "run_eval.py")
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


def catalogue():
    return [{"id": f"{s}_{i}", "section": s, "definition": f"Distinct concept {i}",
             "aliases": [f"concept {i}"]} for s in ("preferences", "patterns") for i in range(16)]


def fixture(root):
    cat = catalogue()
    cases = [{"id": f"case{i}", "section": "preferences" if i%2 else "patterns",
              "description": f"Observation {i}", "category": f"concept {(i//2)%16}", "group": f"g{i}",
              "split": "development" if i < 60 else "test", "annotation_status": "resolved",
              "expected": ["none_fit"] if i%5 == 0 else [f'{"preferences" if i%2 else "patterns"}_{(i//2)%16}'], "reason": "Synthetic outcome"}
             for i in range(200)]
    candidates = {c["id"]: {"ids": [x["id"] for x in cat if x["section"] == c["section"]] + ["none_fit"],
                           "similarities": {x["id"]: 0.8 for x in cat if x["section"] == c["section"]}}
                  for c in cases}
    files = {}
    for name, data in (("catalogue", cat), ("reference", cases), ("candidates", candidates),
                       ("annotation_input", cases), ("notes", {"uncertain_cases": []}),
                       ("provenance", {"human_reviewed": False, "development_ids": [c["id"] for c in cases[:60]]})):
        path = root / f"corpus/{name}.json"
        atomic_json(path, root, data)
        files[name] = {"path": str(path.relative_to(root)), "sha256": file_digest(path)}
    settings = {"question": labels.QUESTION, "grid": list(labels.GRID), "thresholds": {a: 0 for a in labels.ARMS},
                "deepseek": {"model": "deepseek-flash", "temperature": 0, "max_tokens": 1024,
                             "response_format": {"type": "json_object"}}}
    value = {"files": files, "code_sha256": labels.code_pins(), "human_reviewed": False, "reference_kind": "ai-draft", "settings": settings,
             "settings_sha256": digest(settings), "approvals": {k: True for k in
             ("corpus", "ai_reference", "transfer_deepseek", "local_calls", "gates", "calls")}, "test_frozen": False}
    value["approvals"]["spend_usd"] = 5
    return value, cat, cases, candidates


def test_spelling_aliases_preserve_section():
    cat = catalogue()
    cat[0]["aliases"] = ["Communication Style"]
    assert labels.validate_catalogue(cat)[("preferences", labels.spelling(" communication-style "))] == "preferences_0"
    assert labels.spelling("communication_style") == "communication style"
    with pytest.raises(ValueError):
        labels.validate_catalogue([*cat, {"id": "other", "section": "preferences", "definition": "Other",
                                         "aliases": ["communication-style"]}])


def test_normalisation_does_not_collapse_related_concepts(tmp_path):
    _, cat, cases, candidates = fixture(tmp_path)
    case = {**cases[1], "category": "concept-0"}
    assert labels.normalise(case, cat, candidates)["answer"] == "preferences_0"
    assert labels.normalise({**case, "category": "concept 0 details"}, cat, candidates)["answer"] == "none_fit"


def test_shortlists_ignore_expected_and_exclude_other_section():
    cat = catalogue()
    case = {"id": "case", "section": "preferences", "expected": ["preferences_15"]}
    vectors = {"case": [1, 0], **{c["id"]: [1, i+1] for i, c in enumerate(cat)}}
    item = labels.shortlist(case, cat, vectors)
    assert len(item["ids"]) == 17 and item["ids"][-1] == "none_fit"
    assert item["ids"][0] == "preferences_0"
    assert not any(i.startswith("patterns") for i in item["ids"])
    assert labels.shortlist({**case, "expected": ["none_fit"]}, cat, vectors) == item
    with pytest.raises(ValueError):
        labels.shortlist(case, cat[:15], vectors)


def test_cosine_rejects_invalid_vectors():
    assert labels.cosine([1, 0], [1, 1]) == pytest.approx(2**-0.5)
    for a, b in (([0], [1]), ([1], [1, 2]), ([float("nan")], [1]), ([True], [1])):
        with pytest.raises(ValueError):
            labels.cosine(a, b)


def test_validation_pins_approvals_and_split_groups(tmp_path):
    value, _, _, _ = fixture(tmp_path)
    assert len(labels.validate(value, tmp_path)[1]) == 200
    for key in ("transfer_deepseek", "gates", "calls", "ai_reference"):
        broken = copy.deepcopy(value)
        broken["approvals"][key] = False
        with pytest.raises(ValueError):
            labels.validate(broken, tmp_path)
    path = tmp_path / value["files"]["reference"]["path"]
    cases = json.loads(path.read_text())
    cases[60]["group"] = cases[0]["group"]
    atomic_json(path, tmp_path, cases)
    with pytest.raises(ValueError, match="file pin"):
        labels.validate(value, tmp_path)
    value["files"]["reference"]["sha256"] = file_digest(path)
    with pytest.raises(ValueError, match="split leakage"):
        labels.validate(value, tmp_path)


def test_matched_model_payloads_and_order(tmp_path):
    value, cat, cases, candidates = fixture(tmp_path)
    case = cases[0]
    options = labels.options_for(case, cat, candidates)
    reverse = labels.options_for(case, cat, candidates, reverse=True)
    assert list(reverse) == list(reversed(options)) and reverse == options
    local = runner.payload(value, case, options, "L3-clef")
    remote = runner.payload(value, case, options, "L2-deepseek")
    remote_input = json.loads(remote["messages"][1]["content"])
    assert remote_input["observation"] == local["state"]
    assert remote_input["options"] == local["questions"]["decision"]["criteria"]


def test_native_choice_keeps_confidence_separate():
    options = {"a": "A", "none_fit": "No label"}
    data = {"model": "clef-flash", "answers": {"decision": {"type": "choice", "choice": "a",
            "probabilities": {"a": 0.8, "none_fit": 0.2}, "confidence": 0.3}}}
    row = runner.parse(data, "L3-clef", options)
    assert row["score"] == 0.8 and row["provider_confidence"] == 0.3
    data["answers"]["decision"]["choice"] = "missing"
    with pytest.raises((ValueError, KeyError)):
        runner.parse(data, "L3-clef", options)


def test_deepseek_validates_ids_and_scores():
    data = {"model": "deepseek-flash", "choices": [{"message": {"content": '{"choice":"a","score":0.8}'}}]}
    assert runner.parse(data, "L2-deepseek", {"a": "A"})["probabilities"] is None
    for reply in ('{"choice":"b","score":0.8}', '{"choice":"a","score":true}', '{"choice":"a","score":2}'):
        data["choices"][0]["message"]["content"] = reply
        with pytest.raises(ValueError):
            runner.parse(data, "L2-deepseek", {"a": "A"})


def test_runner_retains_errors_and_blocks_unfrozen_test(tmp_path):
    value, _, cases, _ = fixture(tmp_path)
    saved = Checkpoint(tmp_path / "output/checkpoint.json", tmp_path, digest({"manifest": value, "split": "test"}))
    calls = []
    def failed(v, c, options, arm):
        calls.append((c["id"], arm))
        return {"status": "error", "code": "invalid-answer"}
    with pytest.raises(ValueError, match="freeze"):
        runner.evaluate(value, tmp_path, "test", saved, failed)
    assert not calls
    saved = Checkpoint(tmp_path / "output/checkpoint.json", tmp_path, digest({"manifest": value, "split": "development"}))
    runner.evaluate(value, tmp_path, "development", saved, failed)
    assert len(saved.records) == 360 and len(calls) == 240
    assert all(r["split"] == "development" for r in saved.records.values())
    runner.evaluate(value, tmp_path, "development", saved, failed)
    assert len(calls) == 240
    with pytest.raises(ValueError, match="valid development"):
        labels.freeze(value, cases, saved.records)
    with pytest.raises(ValueError):
        labels.freeze(value, cases, {**saved.records, "test/extra": {}})


def test_metrics_keep_failures_and_undefined_reuse():
    cases = [{"id": "a", "expected": ["x"]}, {"id": "b", "expected": ["none_fit"]}]
    rows = {"a": {"status": "ok", "answer": "x", "score": 0.8}}
    m = labels.metrics(cases, rows, 0.9)
    assert m["accuracy"] == 0.5 and m["errors_or_missing"] == 1
    assert m["coverage"] == 0 and m["wrong_reuse_rate"] is None and not m["complete"]


@pytest.mark.parametrize("accuracy,baseline,wrong,coverage,g1,g2,g3", [
    (0.8, 0.7, 0.019, 0.7, "PASS", "PASS", "PASS"),
    (0.799, 0.7, 0.02, 0.699, "FAIL", "FAIL", "FAIL"),
    (1, 0.91, None, 1, "INCONCLUSIVE", "INCONCLUSIVE", "PASS"),
])
def test_gate_boundaries(accuracy, baseline, wrong, coverage, g1, g2, g3):
    result = labels.gates({"accuracy": accuracy, "wrong_reuse_rate": wrong, "coverage": coverage, "complete": False},
                          baseline, validity=True, safety=True)
    assert [result[k] for k in ("L-G1", "L-G2", "L-G3")] == [g1, g2, g3]
    assert result["L-G4"] == "INCONCLUSIVE"


def test_group_bootstrap_is_paired():
    cases = [{"id": str(i), "group": "g" + str(i//2), "expected": ["x"]} for i in range(4)]
    records = {f'{c["id"]}/{arm}/0': {"status": "ok", "answer": "x" if arm == "candidate" else "none_fit"}
               for c in cases for arm in ("candidate", "baseline")}
    assert labels.paired_interval(cases, records, "candidate", "baseline", samples=100) == [1, 1]
