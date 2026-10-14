"""Focused contract tests, also runnable against disposable fault copies."""

import copy
import json
import os
import subprocess
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
r = types.ModuleType("experiment09")
r.__file__ = str(HERE / "run_eval.py")
source = Path(os.environ.get("EXPERIMENT09_FAULT_COPY", r.__file__)).read_text()
exec(compile(source, r.__file__, "exec"), r.__dict__)


def pick_fixture(cases, baseline):
    """Arm rows for every existing-label pick; correct and wrong picks score apart."""
    rows = {}
    for case in cases:
        choice = baseline[case["id"]]["choice"]
        if choice == "none_fit":
            continue
        accept = choice in case["expected"]
        rows[f"nli/test/{case['id']}"] = {"arm": "nli", "phase": "test", "case_id": case["id"],
                                          "verified_choice": choice, "status": "ok",
                                          "p_entailment": 0.99 if accept else 0.01,
                                          "argmax": "entailment" if accept else "neutral",
                                          "tokens": 42, "duration_seconds": 0.01}
    return rows


def calibration_fixture(pairs):
    """Development rows: every positive scores high, every negative scores low."""
    rows = {}
    for pair in pairs:
        rows[f"nli/calibration/{pair['pair_id']}"] = {
            "arm": "nli", "phase": "calibration", "pair_id": pair["pair_id"],
            "case_id": pair["case_id"], "label_id": pair["label_id"], "kind": pair["kind"],
            "status": "ok", "p_entailment": 0.99 if pair["kind"] == "positive" else 0.01,
            "argmax": "entailment" if pair["kind"] == "positive" else "neutral",
            "tokens": 40, "duration_seconds": 0.01}
    return rows


class RunnerTests(unittest.TestCase):

    def test_pins_and_inputs(self):
        dev, test, catalogue, labels, baseline, _ = r.load_inputs()
        self.assertEqual((len(dev), len(test), len(catalogue)), (60, 140, 41))
        metrics = r.baseline_metrics(test, baseline)
        self.assertEqual({k: metrics[k] for k in r.BASELINE_COUNTS}, r.BASELINE_COUNTS)
        with tempfile.TemporaryDirectory(dir=HERE) as folder:
            path = Path(folder) / "input.json"
            path.write_text("original")
            pins = {path.name: r.b.file_hash(path)}
            r.check_pins(path.parent, pins)
            path.write_text("changed")
            with self.assertRaisesRegex(ValueError, "input_hash_drift"):
                r.check_pins(path.parent, pins)

    def test_dev_pairs(self):
        dev, test, catalogue, labels, baseline, _ = r.load_inputs()
        pairs = r.dev_pairs(dev, catalogue)
        by_id = {l["id"]: l for l in catalogue}
        self.assertEqual((len(pairs), len({p["pair_id"] for p in pairs})), (60 + 1170, 1230))
        for pair in pairs:
            case = next(c for c in dev if c["id"] == pair["case_id"])
            self.assertEqual(by_id[pair["label_id"]]["section"], case["section"])
            if pair["kind"] == "positive":
                self.assertEqual(case["expected"], [pair["label_id"]])
            else:
                self.assertNotEqual(case["expected"][0], pair["label_id"])

    def test_pair_text(self):
        definition = "Obtain <private>token</private> explanations before acting"
        self.assertEqual(r.hypothesis_text(definition),
                         "The primary requirement of this observation is to obtain [REDACTED] "
                         "explanations before acting.")
        self.assertTrue(r.hypothesis_text("Sort items").endswith("sort items."))
        description = "Likes <private>hidden</private> release automation."
        self.assertEqual(r.premise_text({"description": description}),
                         "Likes [REDACTED] release automation.")
        with self.assertRaisesRegex(ValueError, "unredacted_secret"):
            r.premise_text({"description": "key sk-abcdefghij0123456789 stored"})
        state = r.clef_state({"description": "Likes automation.", "section": "patterns"},
                              {"id": "label_x", "definition": "Prefers automated flows."})
        self.assertEqual(state["section"], "patterns")
        self.assertEqual(state["candidate"], {"id": "label_x", "definition": "Prefers automated flows."})

    def test_nli_scoring_and_accept(self):
        self.assertEqual(r.softmax3([0.0, 0.0, 0.0]), [1 / 3, 1 / 3, 1 / 3])
        weights = r.softmax3([2.0, 0.0, 0.0])
        self.assertAlmostEqual(sum(weights), 1.0)
        self.assertEqual(weights.index(max(weights)), 0)
        with self.assertRaisesRegex(ValueError, "nli_logit_shape"):
            r.softmax3([1.0, 0.0])
        self.assertTrue(r.nli_accept({"argmax": "entailment", "p_entailment": 0.75}, 0.75))
        self.assertFalse(r.nli_accept({"argmax": "entailment", "p_entailment": 0.7499}, 0.75))
        self.assertFalse(r.nli_accept({"argmax": "contradiction", "p_entailment": 0.99}, 0.75))
        self.assertFalse(r.nli_accept({"argmax": "neutral", "p_entailment": 0.9}, 0.5))
        self.assertTrue(r.clef_accept({"p_yes": 0.6}, 0.6))
        self.assertFalse(r.clef_accept({"p_yes": 0.5999}, 0.6))

    def test_calibration_selection(self):
        pairs = ([{"pair_id": f"pos{i}", "kind": "positive"} for i in range(60)]
                 + [{"pair_id": f"neg{i}", "kind": "negative"} for i in range(1170)])

        def records(pos_score, neg_scores):
            rows = {}
            negative = iter(neg_scores)
            for pair in pairs:
                if pair["kind"] == "positive":
                    rows[f"nli/calibration/{pair['pair_id']}"] = (
                        {"status": "ok", "argmax": "entailment", "p_entailment": pos_score})
                else:
                    rows[f"nli/calibration/{pair['pair_id']}"] = (
                        {"status": "ok", "argmax": "entailment", "p_entailment": next(negative)})
            return rows

        mixed = records(0.9, [0.55 if i < 25 else 0.2 for i in range(1170)])
        points = r.calibration_points(pairs, mixed, "nli")
        at_half = next(p for p in points if p["threshold"] == 0.5)
        self.assertEqual((at_half["wrong_accepts"], at_half["accepted"]), (25, 85))
        self.assertFalse(at_half["qualifies"])
        self.assertEqual(r.frozen_threshold(points), 0.6)
        sparse = records(0.9, [0.2] * 1170)
        self.assertEqual(r.frozen_threshold(r.calibration_points(pairs, sparse, "nli")), 0.5)
        weak = records(0.55, [0.51] * 1170)
        self.assertIsNone(r.frozen_threshold(r.calibration_points(pairs, weak, "nli")))
        all_rejected = records(0.4, [0.1] * 1170)
        empty = r.calibration_points(pairs, all_rejected, "nli")
        self.assertFalse(any(p["qualifies"] for p in empty))

    def test_clef_contract(self):
        reply = {"model": "clef-flash", "answers": {"decision": {
            "type": "choice", "choice": "yes", "confidence": 0.9,
            "probabilities": {"yes": 0.8, "no": 0.2}}},
            "usage": {"input_tokens": 100, "output_tokens": 0}}
        self.assertEqual(r.parse_clef(reply)["p_yes"], 0.8)
        for mutate in ("wrong_model", "sum", "options", "usage", "choice", "type", "confidence"):
            bad = copy.deepcopy(reply)
            if mutate == "wrong_model":
                bad["model"] = "other"
            elif mutate == "sum":
                bad["answers"]["decision"]["probabilities"]["no"] = 0.3
            elif mutate == "options":
                bad["answers"]["decision"]["probabilities"] = {"yes": 1.0}
            elif mutate == "usage":
                bad["usage"]["output_tokens"] = 3
            elif mutate == "choice":
                bad["answers"]["decision"]["choice"] = "maybe"
            elif mutate == "type":
                bad["answers"]["decision"]["type"] = "noul"
            else:
                bad["answers"]["decision"]["confidence"] = 1.5
            with self.assertRaises(ValueError):
                r.parse_clef(bad)
        payload = r.clef_payload({"description": "Likes automation.", "section": "patterns"},
                                  {"id": "label_x", "definition": "Prefers automated flows."})
        question = payload["questions"]["decision"]
        self.assertEqual(question["instructions"], r.CLEF_QUESTION)
        self.assertEqual(set(question["criteria"]), {"yes", "no"})
        self.assertEqual(set(payload["state"]), {"description", "section", "candidate"})

    def test_routing_and_gates(self):
        dev, test, catalogue, labels, baseline, _ = r.load_inputs()
        records = pick_fixture(test, baseline)
        metrics = r.arm_metrics(test, baseline, records, "nli", 0.9)
        self.assertEqual((metrics["accepted_reuse"], metrics["correct_accepted"],
                          metrics["wrong_accepted"]), (23, 23, 0))
        self.assertEqual((metrics["routed_review"], metrics["routing"]["blocked_wrong"],
                          metrics["routing"]["lost_correct"]), (48, 48, 0))
        self.assertEqual((metrics["classified"], metrics["none_fit_passthrough"]), (140, 69))
        self.assertTrue(all(metrics["gates"].values()))
        accept_all = dict(records)
        del accept_all[next(iter(accept_all))]
        partial = r.arm_metrics(test, baseline, accept_all, "nli", 0.9)
        self.assertFalse(partial["gates"]["G2_completeness"])
        rows = dict(records)
        wrong_pick = next(k for k, row in rows.items() if row["p_entailment"] == 0.01)
        rows[wrong_pick] = {**rows[wrong_pick], "p_entailment": 0.99, "argmax": "entailment"}
        boundary = r.arm_metrics(test, baseline, rows, "nli", 0.9)
        self.assertEqual((boundary["accepted_reuse"], boundary["wrong_accepted"]), (24, 1))
        self.assertFalse(boundary["gates"]["G3_safety"])
        self.assertTrue(boundary["gates"]["G4_retention"])
        errored = dict(records)
        errored[next(iter(errored))] = {"arm": "nli", "phase": "test", "case_id": "x",
                                        "status": "error", "error_code": "OSError"}
        with_errors = r.arm_metrics(test, baseline, errored, "nli", 0.9)
        self.assertEqual(with_errors["verifier_errors"], 1)
        self.assertTrue(with_errors["gates"]["G2_completeness"])
        self.assertEqual(with_errors["classified"], 140)

    def test_interval(self):
        self.assertAlmostEqual(r.binom_upper(0, 20), 1 - 0.05 ** (1 / 20), places=9)
        self.assertAlmostEqual(r.binom_upper(0, 71), 1 - 0.05 ** (1 / 71), places=9)
        self.assertEqual(r.binom_upper(5, 5), 1.0)
        self.assertIsNone(r.binom_upper(0, 0))
        self.assertGreater(r.binom_upper(3, 71), r.binom_upper(1, 71))
        self.assertAlmostEqual(r.binom_upper(1, 50), 0.10, delta=0.02)

    def test_resume_and_records(self):
        dev, test, catalogue, labels, baseline, _ = r.load_inputs()
        records = pick_fixture(test, baseline)
        saved = {"manifest_digest": "pin", "records": records}
        r.validate_saved(saved, "pin", dev, test, catalogue, baseline)
        with self.assertRaisesRegex(ValueError, "resume_fingerprint_mismatch"):
            r.validate_saved(saved, "changed", dev, test, catalogue, baseline)
        unknown = {"manifest_digest": "pin",
                   "records": {**records, "nli/test/nonexistent": next(iter(records.values()))}}
        with self.assertRaisesRegex(ValueError, "unknown_saved_record"):
            r.validate_saved(unknown, "pin", dev, test, catalogue, baseline)
        leak = copy.deepcopy(records)
        key = next(iter(leak))
        leak[key] = {**leak[key], "prompt": "text"}
        with self.assertRaisesRegex(ValueError, "content_leak"):
            r.validate_saved({"manifest_digest": "pin", "records": leak}, "pin", dev, test,
                             catalogue, baseline)
        unscored = copy.deepcopy(records)
        key = next(iter(unscored))
        unscored[key].pop("p_entailment")
        with self.assertRaisesRegex(ValueError, "invalid_saved_score"):
            r.validate_saved({"manifest_digest": "pin", "records": unscored}, "pin", dev, test,
                             catalogue, baseline)
        checkpointed = {}
        with patch.object(r, "score_pair", return_value={"status": "error", "error_code": "OSError"}):
            items = [{"key": "nli/test/x", "case": {"id": "x"}, "label": {}}]
            r.checkpoint_pairs("nli", None, items, {"records": {}},
                               lambda value: checkpointed.update(value), lambda item: item["key"],
                               lambda item: {"arm": "nli", "phase": "test",
                                             "case_id": item["case"]["id"]})
        self.assertEqual(checkpointed["records"]["nli/test/x"]["status"], "error")

    def test_read_only_verify(self):
        dev, test, catalogue, labels, baseline, _ = r.load_inputs()
        pairs = r.dev_pairs(dev, catalogue)
        earlier = r.earlier_hashes()
        preserved = r.b.preservation(r.SOURCE)
        static = {"earlier_file_sha256": earlier, "preservation": preserved}
        fingerprint = r.b.digest(static)
        records = {**calibration_fixture(pairs), **pick_fixture(test, baseline)}
        saved = {"manifest_digest": fingerprint, "records": records}
        points = r.calibration_points(pairs, records, "nli")
        calibration = {"manifest_digest": fingerprint, "arms": {"nli": {
            "status": "frozen", "frozen_threshold": r.frozen_threshold(points),
            "pairs": {"positive": 60, "negative": 1170}, "grid": r.GRID, "points": points,
            "selection_rule": r.SELECTION_RULE}}}
        run_manifest = {"static": static, "frozen_thresholds": {
            "nli": r.frozen_threshold(points)}, "events": [
            {"event": "calibrate_complete", "arm": "nli", "status": "frozen",
             "threshold": r.frozen_threshold(points)},
            {"event": "test_start", "arm": "nli", "threshold": r.frozen_threshold(points)}]}
        summary = r.summarise(test, baseline, saved, calibration, run_manifest, integrity=True)
        with tempfile.TemporaryDirectory(dir=HERE) as folder:
            output = Path(folder) / "output"
            output.mkdir()
            for name, value in (("run-manifest", run_manifest), ("eval_results", saved),
                                ("calibration", calibration), ("summary", summary)):
                (output / f"{name}.json").write_text(json.dumps(value))
            before = {p.name: p.read_bytes() for p in output.iterdir()}
            from contextlib import ExitStack
            guards = [patch.object(r, "HERE", Path(folder)),
                      patch.object(r, "manifest_for", return_value=static),
                      patch.object(r, "verify_model_files", side_effect=lambda *a: None),
                      patch.object(r, "earlier_hashes", return_value=earlier),
                      patch.object(r.b, "preservation", return_value=preserved),
                      patch.object(r.b, "atomic_json", side_effect=AssertionError("write during verify")),
                      patch.object(r.OwnedServer, "__init__", side_effect=AssertionError("server during verify")),
                      patch.object(r, "nli_runtime", side_effect=AssertionError("inference during verify"))]
            with ExitStack() as stack:
                for guard in guards:
                    stack.enter_context(guard)
                r.execute("verify", None, False)
            self.assertEqual(before, {p.name: p.read_bytes() for p in output.iterdir()})
            tampered = json.loads(json.dumps(summary))
            tampered["arms"]["nli"]["threshold"] = 0.7
            (output / "summary.json").write_text(json.dumps(tampered))
            with ExitStack() as stack:
                for guard in guards[:5]:
                    stack.enter_context(guard)
                with self.assertRaisesRegex(ValueError, "summary_mismatch"):
                    r.execute("verify", None, False)


FAULTS = [
    ("test_pins_and_inputs",
     'if b.file_hash(b.path_in(root, name)) != expected:\n            raise ValueError("input_hash_drift")',
     "pass  # fault: accept any input hash"),
    ("test_dev_pairs",
     'if label["section"] == case["section"] and label["id"] != want:',
     'if label["id"] != want:  # fault: ignore section'),
    ("test_pair_text",
     'text = b.private_safe(definition).strip()',
     "text = definition.strip()  # fault: skip redaction"),
    ("test_pair_text",
     'return b.private_safe(case["description"])',
     'return case["description"]  # fault: skip redaction'),
    ("test_nli_scoring_and_accept",
     'return row["argmax"] == "entailment" and row["p_entailment"] >= tau',
     'return row["p_entailment"] >= tau  # fault: ignore argmax'),
    ("test_calibration_selection",
     'for point in points:\n        if point["qualifies"]:\n            return point["threshold"]',
     'for point in reversed(points):\n        if point["qualifies"]:\n            return point["threshold"]  # fault: pick largest'),
    ("test_clef_contract",
     'b.require(abs(sum(values.values()) - 1) <= 1e-6, "invalid_probability_sum")',
     "pass  # fault: skip probability sum check"),
    ("test_routing_and_gates",
     'wrong_reuse = wrong / accepted if accepted else None',
     'wrong_reuse = wrong / len(test) if accepted else None  # fault: wrong denominator'),
    ("test_interval",
     'if cdf(middle) > alpha:',
     'if cdf(middle) < alpha:  # fault: wrong tail'),
    ("test_resume_and_records",
     'b.require(saved.get("manifest_digest") == fingerprint, "resume_fingerprint_mismatch")',
     "pass  # fault: accept mismatched fingerprint"),
    ("test_read_only_verify",
     'b.require(b.read_json(summary_path) == summary, "summary_mismatch")',
     "pass  # fault: skip summary comparison"),
]


def prove_faults():
    """Run each test against a disposable faulty copy and record the outcome."""
    output = HERE / "output"
    (output / "fault-copies").mkdir(parents=True, exist_ok=True)
    results = []
    for test_id, old, new in FAULTS:
        assert source.count(old) == 1, f"anchor not unique: {test_id}"
        faulty = source.replace(old, new)
        copy_path = output / "fault-copies" / f"{test_id}.py"
        copy_path.write_text(faulty)
        environment = dict(os.environ, EXPERIMENT09_FAULT_COPY=str(copy_path))
        completed = subprocess.run(
            [sys.executable, "-m", "pytest", "-q", f"{Path(__file__).name}::RunnerTests::{test_id}"],
            cwd=HERE, env=environment, capture_output=True, text=True, timeout=600)
        evidence = output / f"{test_id}-fault.txt"
        evidence.write_text(completed.stdout + completed.stderr)
        results.append({"test": test_id, "fault": new, "detected": completed.returncode != 0,
                        "exit_code": completed.returncode, "evidence": evidence.name,
                        "copy": str(copy_path.relative_to(HERE))})
        print(f"{test_id}: fault detected = {completed.returncode != 0}", flush=True)
    report = {"focused_tests": 10, "faults": results,
              "all_detected": all(item["detected"] for item in results)}
    (output / "test-proof.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"all_detected": report["all_detected"]}), flush=True)
    raise SystemExit(0 if report["all_detected"] else 1)


if __name__ == "__main__":
    if "--prove-faults" in sys.argv:
        prove_faults()
    unittest.main()
