"""Regression and end-to-end checks for the revised label corpus."""

import copy
import json
import shutil
import subprocess
import sys
import uuid
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from test_labels import fixture, labels, runner
from checkpoint import Checkpoint, atomic_json
from manifest import digest, file_digest
from spending import Budget
import build_inputs
import reference_guards
import summarise_eval


def revised_fixture(root):
    value, cat, cases, candidates = fixture(root)
    for i, case in enumerate(cases):
        case["category"] = f"concept {(i//2)%16}"
        case["annotation_status"] = "resolved"
        case["expected"] = ["none_fit"] if i%5 == 0 else [f'{case["section"]}_{(i//2)%16}']
    documents = {"catalogue": cat, "reference": cases, "candidates": candidates,
                 "annotation_input": [{k: c[k] for k in ("id", "section", "category", "description")} for c in cases],
                 "notes": {"uncertain_cases": []},
                 "provenance": {"human_reviewed": False, "development_ids": [c["id"] for c in cases if c["split"] == "development"]}}
    for name, data in documents.items():
        path = root / f"corpus/{name}.json"
        atomic_json(path, root, data)
        value["files"][name] = {"path": str(path.relative_to(root)), "sha256": file_digest(path)}
    return value, cat, cases, candidates


def repin(value, root, name, data):
    path = root / value["files"][name]["path"]
    atomic_json(path, root, data)
    value["files"][name]["sha256"] = file_digest(path)


def test_unresolved_reference_blocks_before_calls(tmp_path):
    value, _, cases, _ = revised_fixture(tmp_path)
    assert len(labels.validate(value, tmp_path)[1]) == 200
    cases[0]["annotation_status"] = "unresolved"
    repin(value, tmp_path, "reference", cases)
    with pytest.raises(ValueError, match="unresolved"):
        labels.validate(value, tmp_path)


def test_notes_cannot_hide_uncertainty(tmp_path):
    value, _, _, _ = revised_fixture(tmp_path)
    repin(value, tmp_path, "notes", {"uncertain_cases": [{"id": "case0", "status": "unresolved"}]})
    with pytest.raises(ValueError, match="unresolved"):
        labels.validate(value, tmp_path)


def test_single_class_holdout_is_rejected(tmp_path):
    value, _, cases, _ = revised_fixture(tmp_path)
    for c in cases:
        if c["split"] == "test":
            c["expected"] = ["none_fit"]
    repin(value, tmp_path, "reference", cases)
    with pytest.raises(ValueError, match="positive"):
        labels.validate(value, tmp_path)


def test_development_provenance_and_aliases(tmp_path):
    value, cat, cases, _ = revised_fixture(tmp_path)
    repin(value, tmp_path, "provenance", {"human_reviewed": False, "development_ids": [c["id"] for c in cases]})
    with pytest.raises(ValueError, match="development"):
        labels.validate(value, tmp_path)
    value, cat, cases, _ = revised_fixture(tmp_path)
    cat[0]["aliases"].append("test-only alias")
    repin(value, tmp_path, "catalogue", cat)
    with pytest.raises(ValueError, match="alias"):
        labels.validate(value, tmp_path)


def test_source_wording_is_preserved(tmp_path):
    value, _, cases, _ = revised_fixture(tmp_path)
    cases[0]["description"] = "Altered wording"
    repin(value, tmp_path, "reference", cases)
    with pytest.raises(ValueError, match="source"):
        labels.validate(value, tmp_path)


def test_identical_intents_cannot_leak_under_different_group_ids(tmp_path):
    value, _, cases, _ = revised_fixture(tmp_path)
    cases[60]["description"] = cases[0]["description"]
    repin(value, tmp_path, "reference", cases)
    repin(value, tmp_path, "annotation_input", cases)
    with pytest.raises(ValueError, match="intent leakage"):
        labels.validate(value, tmp_path)


def test_changed_manifest_and_failed_development_block_test(tmp_path):
    value, _, cases, _ = revised_fixture(tmp_path)
    records = {f'{c["id"]}/{arm}/{order}': {"status": "error", "split": "development"}
               for c in cases if c["split"] == "development" for arm in labels.ARMS
               for order in ((0, 1) if arm in labels.ARMS[2:] else (0,))}
    with pytest.raises(ValueError, match="valid development"):
        labels.freeze(value, cases, records)


def test_ten_point_lift_uses_exact_case_counts():
    candidate = {"n": 140, "correct": 97, "accuracy": 97/140, "wrong_reuse_rate": 0,
                 "coverage": 1, "complete": True}
    baseline = {"n": 140, "correct": 83, "accuracy": 83/140}
    assert labels.gates(candidate, baseline, validity=True, safety=True)["L-G1"] == "PASS"


def test_request_settles_usage_before_invalid_answer(tmp_path, monkeypatch):
    value, cat, cases, candidates = revised_fixture(tmp_path)
    budget = Budget(tmp_path / "output/spend.json", tmp_path, "scope", 5)
    def transport(*args):
        assert budget.used > 0
        return {"model": "deepseek-flash", "usage": {"prompt_tokens": 100, "completion_tokens": 10},
                "choices": [{"message": {"content": '{"choice":"bad-id","score":0.8}'}}]}
    monkeypatch.setattr(runner, "http_json", transport)
    result = runner.request(value, cases[0], labels.options_for(cases[0], cat, candidates), "L2-deepseek", budget)
    assert result["status"] == "error" and result["code"] == "invalid-answer"
    assert budget.used == pytest.approx(0.000042)
    assert budget.state["calls"][result["spending_ticket"]] == result["usage_cost_usd"]


def test_timeout_keeps_reservation_and_cap_blocks_transfer(tmp_path, monkeypatch):
    value, cat, cases, candidates = revised_fixture(tmp_path)
    budget = Budget(tmp_path / "output/spend.json", tmp_path, "scope", 0.005)
    calls = []
    def timeout(*args):
        calls.append(1)
        raise TimeoutError()
    monkeypatch.setattr(runner, "http_json", timeout)
    options = labels.options_for(cases[0], cat, candidates)
    result = runner.request(value, cases[0], options, "L2-deepseek", budget)
    assert result["status"] == "error" and budget.used > 0
    with pytest.raises(ValueError, match="spending limit"):
        runner.request(value, cases[0], options, "L2-deepseek", budget)
    assert len(calls) == 1


def test_unapproved_parameters_and_overflow_block_transport(tmp_path, monkeypatch):
    value, cat, cases, candidates = revised_fixture(tmp_path)
    budget = Budget(tmp_path / "output/spend.json", tmp_path, "scope", 5)
    calls = []
    monkeypatch.setattr(runner, "http_json", lambda *a: calls.append(a))
    monkeypatch.setattr(runner, "local_json", lambda *a: calls.append(a))
    options = labels.options_for(cases[0], cat, candidates)
    invalid = copy.deepcopy(value)
    invalid["settings"]["deepseek"]["max_tokens"] = 100000
    with pytest.raises(ValueError, match="parameters"):
        runner.request(invalid, cases[0], options, "L2-deepseek", budget)
    for arm in ("L2-deepseek", "L3-clef"):
        result = runner.request(value, {**cases[0], "description": "x"*9000}, options, arm, budget)
        assert result["status"] == "error" and result["code"] == "input-overflow"
    assert not calls and budget.used == 0


def write_build_fixture(root):
    value, _, _, _ = revised_fixture(root)
    names = {"catalogue": "catalogue.json", "reference": "ground-truth.json",
             "annotation_input": "annotation-input.json", "notes": "annotation-notes.json",
             "provenance": "ai-reference-provenance.json"}
    for key, name in names.items():
        data = json.loads((root / value["files"][key]["path"]).read_text())
        atomic_json(root / "corpus" / name, root, data)
    atomic_json(root / "corpus/entries.json", root,
                json.loads((root / "corpus/annotation-input.json").read_text()))
    atomic_json(root / "corpus/source-provenance.json", root, {"kind": "synthetic", "source_sha256": "fixture"})


def test_original_corpus_and_symlink_roots_are_refused(tmp_path):
    original = reference_guards.EXPERIMENT / "corpus"
    with pytest.raises(ValueError, match="original corpus"):
        reference_guards.run_root(original)
    with pytest.raises(ValueError, match="outside"):
        reference_guards.run_root(tmp_path)
    link = tmp_path / "link"
    link.symlink_to(reference_guards.EXPERIMENT / "output", target_is_directory=True)
    with pytest.raises(ValueError, match="symlink"):
        reference_guards.run_root(link)


def test_preparation_blocks_unresolved_before_embedding(tmp_path):
    write_build_fixture(tmp_path)
    notes = tmp_path / "corpus/annotation-notes.json"
    atomic_json(notes, tmp_path, {"uncertain_cases": [{"id": "case0"}]})
    calls = []
    with pytest.raises(ValueError, match="unresolved"):
        build_inputs.build(tmp_path, {}, {}, embedder=lambda text: calls.append(text))
    assert calls == []


def test_catalogue_needs_sixteen_labels_per_section(tmp_path):
    write_build_fixture(tmp_path)
    path = tmp_path / "corpus/catalogue.json"
    catalogue = json.loads(path.read_text())
    removed = catalogue.pop()["id"]
    with pytest.raises(ValueError, match="16 labels"):
        labels.validate_catalogue(catalogue)
    reference_path = tmp_path / "corpus/ground-truth.json"
    cases = json.loads(reference_path.read_text())
    for c in cases:
        if removed in c["expected"]:
            c["expected"] = ["none_fit"]
    atomic_json(reference_path, tmp_path, cases)
    atomic_json(path, tmp_path, catalogue)
    calls = []
    with pytest.raises(ValueError, match="16 labels"):
        build_inputs.build(tmp_path, {}, {}, embedder=lambda text: calls.append(text))
    assert calls == []


def test_full_mocked_preparation_freeze_resume_and_summary(tmp_path, monkeypatch):
    write_build_fixture(tmp_path)
    embedding_calls = []
    def embed(text):
        embedding_calls.append(text)
        return [1.0] + [0.0]*1023
    pin = {"model": "synthetic", "dimensions": 1024}
    prepared = build_inputs.build(tmp_path, pin, {}, embedder=embed)
    assert len(embedding_calls) == 232
    with pytest.raises(ValueError, match="approval"):
        labels.validate(prepared, tmp_path)
    value = build_inputs.build(tmp_path, pin, {}, embedder=embed, calls_approved=True)
    assert len(embedding_calls) == 232
    _, cases, _ = labels.validate(value, tmp_path)
    transmissions = []
    def response(arm, state, options):
        i = int(state["description"].removeprefix("Observation "))
        answer = "none_fit" if i%5 == 0 else f'{state["section"]}_{(i//2)%16}'
        transmissions.append((arm, i))
        if arm == "deepseek":
            content = '{"choice":"invalid","score":0.9}' if i == 141 else json.dumps({"choice": answer, "score": 0.9})
            return {"model": "deepseek-flash", "usage": {"prompt_tokens": 600, "completion_tokens": 20},
                    "choices": [{"message": {"content": content}}]}
        probabilities = {key: (0.95 if key == answer else 0.05/16) for key in options}
        return {"model": "clef-flash", "usage": {"input_tokens": 600, "output_tokens": 0},
                "answers": {"decision": {"type": "choice", "choice": answer,
                                          "probabilities": probabilities, "confidence": 0.9}}}
    def remote(url, body, env):
        state = json.loads(body["messages"][1]["content"])
        return response("deepseek", state["observation"], state["options"])
    def local(url, body):
        return response("clef", body["state"], body["questions"]["decision"]["criteria"])
    monkeypatch.setattr(runner, "http_json", remote)
    monkeypatch.setattr(runner, "local_json", local)
    scope = digest({"files": value["files"], "models": value["models"], "approvals": value["approvals"]})
    budget = Budget(tmp_path / "output/spending.json", tmp_path, scope, 5)
    call = lambda v, c, o, a: runner.request(v, c, o, a, budget)
    path = tmp_path / "output/development/eval_results_checkpoint.json"
    fingerprint = digest({"manifest": value, "split": "development"})
    saved = Checkpoint(path, tmp_path, fingerprint)
    runner.evaluate(value, tmp_path, "development", saved, call)
    assert len(saved.records) == 360 and len(transmissions) == 240
    resumed = Checkpoint(path, tmp_path, fingerprint, resume=True)
    runner.evaluate(value, tmp_path, "development", resumed, call)
    assert len(transmissions) == 240
    atomic_json(path.with_name("eval_results.json"), tmp_path, {"manifest_sha256": digest(value), "records": resumed.records})
    frozen = labels.freeze(value, cases, resumed.records)
    atomic_json(tmp_path / "corpus/test-manifest.json", tmp_path, frozen)
    reference_guards.verify_freeze(frozen, tmp_path)
    forged = copy.deepcopy(frozen)
    forged["settings"]["thresholds"][labels.ARMS[3]] = 0.99
    forged["settings_sha256"] = digest(forged["settings"])
    with pytest.raises(ValueError, match="freeze differs"):
        reference_guards.verify_freeze(forged, tmp_path)
    testpath = tmp_path / "output/test/eval_results_checkpoint.json"
    test_saved = Checkpoint(testpath, tmp_path, digest({"manifest": frozen, "split": "test"}))
    runner.evaluate(frozen, tmp_path, "test", test_saved, call)
    atomic_json(testpath.with_name("eval_results.json"), tmp_path, {"manifest_sha256": digest(frozen), "records": test_saved.records})
    result = summarise_eval.summarise(frozen, tmp_path)
    assert result["complete"] and result["record_count"] == result["expected_records"] == 920
    assert result["hosted_calls"] == 260 and len(transmissions) == 520
    assert result["arms"]["L2-deepseek"]["errors_or_missing"] == 1
    assert result["verdict"] == "INCONCLUSIVE" and result["human_reviewed"] is False
    assert result["known_usage_usd"] == pytest.approx(budget.used)
    assert summarise_eval.summarise(frozen, tmp_path) == result
    atomic_json(tmp_path / "output/eval_results.summary.json", tmp_path, result)
    evidence = Path(__file__).resolve().parent / "output" / ("synthetic-script-check-" + uuid.uuid4().hex)
    shutil.copytree(tmp_path, evidence)
    (evidence / "SYNTHETIC.txt").write_text("Offline fixtures. All model responses mocked; zero network requests.\n")
    verified = subprocess.run([sys.executable, str(Path(__file__).resolve().parent / "analysis.py"),
                               "--root", str(evidence), "--verify"], capture_output=True, text=True)
    assert verified.returncode == 0, verified.stderr
    assert json.loads(verified.stdout)["metrics_reproduced"] is True
    with pytest.raises(ValueError, match="after inference"):
        build_inputs.build(tmp_path, pin, {}, embedder=embed)
    raw = json.loads(testpath.with_name("eval_results.json").read_text())
    raw["records"].pop("case141/L2-deepseek/0")
    atomic_json(testpath.with_name("eval_results.json"), tmp_path, raw)
    missing = summarise_eval.summarise(frozen, tmp_path)
    assert not missing["complete"] and not missing["arms"]["L2-deepseek"]["complete"]
