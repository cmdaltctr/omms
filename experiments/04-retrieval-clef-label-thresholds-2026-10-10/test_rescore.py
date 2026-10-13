"""Synthetic tests for Experiment 04, using no original experiment data."""

import copy
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
CODE = Path(os.environ.get("RESCORE_TEST_CODE", HERE / "rescore.py"))
spec = importlib.util.spec_from_file_location("rescore", CODE)
rescore = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rescore)


def synthetic_data():
    options = [f"label{i}" for i in range(16)] + ["none_fit"]
    records, references, candidates = {}, [], {}
    for i in range(140):
        case = str(i)
        expected = "label0" if i < 54 else "none_fit"
        if i < 38:
            answer, score = "label0", 0.9
        elif i < 51:
            answer, score = "label1", 0.95
        elif i < 54:
            answer, score = "none_fit", 0.8
        elif i < 110:
            answer, score = "label1", 0.6
        else:
            answer, score = "none_fit", 0.7
        probabilities = {option: (1-score)/16 for option in options}
        probabilities[answer] = score
        records[f"{case}/L3-clef/0"] = {
            "case_id": case, "arm": "L3-clef", "split": "test", "order": 0,
            "status": "ok", "answer": answer, "score": score,
            "score_kind": "native_choice_probability", "provider_confidence": 0.01,
            "probabilities": probabilities,
        }
        references.append({"id": case, "split": "test", "expected": [expected]})
        candidates[case] = {"ids": options}
    return records, references, candidates


def fixture(root):
    source = root / "experiments/01-label-decisions-2026-10-07/output/revision-01-batch8192"
    source.mkdir(parents=True)
    records, refs, candidates = synthetic_data()
    def write(name, value):
        path = source / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(value))
        return rescore.file_digest(path)
    files = {}
    for name, path, value in (
        ("reference", "corpus/ground-truth.json", refs),
        ("candidates", "corpus/candidates.json", candidates),
        ("provenance", "corpus/ai-reference-provenance.json", {"human_reviewed": False}),
    ):
        files[name] = {"path": path, "sha256": write(path, value)}
    manifest = {"files": files, "test_frozen": True, "source_commit": "d22b578",
                "human_reviewed": False}
    manifest_digest = rescore.digest(manifest)
    write("corpus/test-manifest.json", manifest)
    write("output/eval_results.json", {"records": records, "human_reviewed": False,
                                      "test_manifest_sha256": manifest_digest})
    original = root / "experiments/original.txt"
    original.write_text("Preserve this synthetic original")
    write("preserved-files.json", {"original.txt": rescore.file_digest(original)})
    pins = {name: rescore.file_digest(source / name) for name in rescore.PINS}
    return source, root / "experiment04/output", pins, manifest_digest


class ScoringTests(unittest.TestCase):
    def setUp(self):
        self.records, self.refs, self.candidates = synthetic_data()
        self.items = rescore.validate_records(self.records, self.refs, self.candidates)

    def test_baseline_and_paired_differences(self):
        cells = {str(t): rescore.score_cell(self.items, t) for t in rescore.GRID}
        self.assertEqual(cells["0"]["counts"], {
            "N": 140, "A": 140, "E": 107, "W": 69, "C": 38, "F": 30,
            "B": 0, "accepted_none_fit": 33, "raw_correct": 68})
        result = rescore.summary({}, cells)
        self.assertEqual(result["validity"], "INCONCLUSIVE")
        self.assertEqual(result["exploratory_gates"], "FAIL")
        self.assertIsNone(result["selected_threshold"])
        row = result["rows"][2]
        self.assertEqual(row["routing_effects"]["avoided_wrong_reuse"], 56)
        self.assertEqual(row["routing_effects"]["lost_correct_decisions"], 0)
        self.assertAlmostEqual(row["difference_from_baseline"]["review_load"], 56/140)
        self.assertEqual(row["routing_effects"]["raw_prediction_ties"], 140)

    def test_inclusive_threshold(self):
        self.assertEqual(rescore.score_cell(self.items, 0.9)["counts"]["C"], 38)
        self.assertEqual(rescore.score_cell(self.items, 0.900001)["counts"]["C"], 0)

    def test_review_is_not_correct_none_fit(self):
        cell = rescore.score_cell(self.items, 0.8)
        self.assertEqual(cell["counts"]["F"], 0)
        self.assertEqual(cell["counts"]["accepted_none_fit"], 3)
        self.assertEqual(cell["counts"]["raw_correct"], 68)
        reviewed = [r for r in cell["rows"] if r["answer"] == "none_fit" and r["correct"]]
        self.assertEqual(len(reviewed), 30)
        self.assertTrue(all(r["route"] == "REVIEW" and not r["automatic_correct"] for r in reviewed))

    def test_empty_acceptance_is_undefined_and_cannot_pass(self):
        cell = rescore.score_cell(self.items, 1)
        self.assertIsNone(cell["rates"]["wrong_reuse"])
        self.assertIsNone(cell["rates"]["accepted_precision"])
        self.assertFalse(cell["gates"]["nonempty_existing"])
        self.assertFalse(cell["qualifies"])
        self.assertEqual(cell["counts"]["B"], 140)

    def test_strict_wrong_reuse_boundary(self):
        items = [{"case_id": str(i), "answer": "label", "score": 1, "correct": i > 0}
                 for i in range(50)]
        self.assertFalse(rescore.score_cell(items, 0)["gates"]["wrong_reuse_below_2_percent"])
        items.append({"case_id": "50", "answer": "label", "score": 1, "correct": True})
        self.assertTrue(rescore.score_cell(items, 0)["gates"]["wrong_reuse_below_2_percent"])

    def test_coverage_guard_and_smallest_threshold(self):
        items = [{"case_id": str(i), "answer": "label", "score": 0.9, "correct": True}
                 for i in range(19)]
        self.assertTrue(rescore.score_cell(items, 0)["qualifies"])
        self.assertFalse(rescore.score_cell(items[:18], 0)["qualifies"])
        items.append({"case_id": "wrong", "answer": "label", "score": 0.5, "correct": False})
        result = rescore.summary({}, {str(t): rescore.score_cell(items, t) for t in rescore.GRID})
        self.assertEqual(result["selected_threshold"], 0.65)
        self.assertEqual(result["exploratory_gates"], "PASS")
        self.assertEqual(result["validity"], "INCONCLUSIVE")

    def test_chosen_probability_not_provider_confidence(self):
        self.assertEqual(len(self.items), 140)
        changed = copy.deepcopy(self.records)
        changed["0/L3-clef/0"]["score"] = 0.01
        with self.assertRaisesRegex(ValueError, "Chosen probability mismatch"):
            rescore.validate_records(changed, self.refs, self.candidates)

    def test_probability_validation(self):
        mutations = [
            lambda row: row.update(score_kind="confidence"),
            lambda row: row["probabilities"].pop("label15"),
            lambda row: row["probabilities"].update(label15=float("nan")),
            lambda row: row["probabilities"].update(label15=True),
            lambda row: row["probabilities"].update(label15=1.1),
            lambda row: row["probabilities"].update(label15=0.5),
        ]
        for mutate in mutations:
            changed = copy.deepcopy(self.records)
            mutate(changed["0/L3-clef/0"])
            with self.subTest(mutation=mutate), self.assertRaises(ValueError):
                rescore.validate_records(changed, self.refs, self.candidates)

    def test_missing_duplicate_failed_and_reference_composition(self):
        changed = copy.deepcopy(self.records)
        changed.pop("0/L3-clef/0")
        with self.assertRaisesRegex(ValueError, "Missing or extra"):
            rescore.validate_records(changed, self.refs, self.candidates)
        changed = {**self.records, "duplicate": self.records["0/L3-clef/0"]}
        with self.assertRaisesRegex(ValueError, "Duplicate selected"):
            rescore.validate_records(changed, self.refs, self.candidates)
        with self.assertRaisesRegex(ValueError, "Duplicate reference"):
            rescore.validate_records(self.records, self.refs + [self.refs[0]], self.candidates)
        changed = copy.deepcopy(self.records)
        changed["0/L3-clef/0"]["status"] = "error"
        with self.assertRaisesRegex(ValueError, "failed record"):
            rescore.validate_records(changed, self.refs, self.candidates)
        changed_refs = copy.deepcopy(self.refs)
        changed_refs[0]["expected"] = ["none_fit"]
        with self.assertRaisesRegex(ValueError, "composition"):
            rescore.validate_records(self.records, changed_refs, self.candidates)


class PersistenceTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()
        self.source, self.output, self.pins, self.manifest = fixture(self.root)

    def run_experiment(self, **kwargs):
        return rescore.execute(self.source, self.output, self.pins, self.manifest, **kwargs)

    def test_input_hash_manifest_and_preservation_guards(self):
        wrong_pins = {**self.pins, "output/eval_results.json": "wrong"}
        with self.assertRaisesRegex(ValueError, "Input hash"):
            rescore.load_inputs(self.source, wrong_pins, self.manifest)
        with self.assertRaisesRegex(ValueError, "Manifest digest"):
            rescore.load_inputs(self.source, self.pins, "wrong")
        (self.root / "experiments/original.txt").write_text("changed")
        with self.assertRaisesRegex(ValueError, "Preserved file"):
            self.run_experiment(resume=True)
        self.assertFalse(self.output.exists())

    def test_resume_and_verify_are_read_only_when_complete(self):
        self.run_experiment(resume=True)
        before = {p.name: (p.read_bytes(), p.stat().st_mtime_ns) for p in self.output.iterdir()}
        self.run_experiment(verify=True)
        after = {p.name: (p.read_bytes(), p.stat().st_mtime_ns) for p in self.output.iterdir()}
        self.assertEqual(before, after)
        with patch.object(rescore, "atomic_json", wraps=rescore.atomic_json) as save:
            self.run_experiment(resume=True)
            self.assertEqual(save.call_count, 1)
        with self.assertRaisesRegex(ValueError, "requires --resume"):
            self.run_experiment()
        self.assertEqual(len(rescore.read_json(self.output / "rescored.json")["cells"]), 8)

    def test_interrupted_checkpoint_and_fingerprint_refusal(self):
        real_save = rescore.atomic_json
        def interrupted(path, value):
            real_save(path, value)
            raise RuntimeError("Synthetic interruption")
        with patch.object(rescore, "atomic_json", side_effect=interrupted):
            with self.assertRaisesRegex(RuntimeError, "Synthetic interruption"):
                self.run_experiment(resume=True)
        self.assertEqual(len(rescore.read_json(self.output / "rescored.json")["cells"]), 1)
        with self.assertRaisesRegex(ValueError, "Incomplete saved"):
            self.run_experiment(verify=True)
        self.run_experiment(resume=True)
        self.run_experiment(verify=True)
        with patch.object(rescore, "MIN_CORRECT", 20):
            with self.assertRaisesRegex(ValueError, "fingerprint"):
                self.run_experiment(resume=True)

    def test_corrupt_raw_and_summary_are_refused(self):
        self.run_experiment(resume=True)
        raw_path = self.output / "rescored.json"
        raw = rescore.read_json(raw_path)
        original = copy.deepcopy(raw)
        raw["cells"]["0"]["counts"]["C"] = 999
        rescore.atomic_json(raw_path, raw)
        with self.assertRaisesRegex(ValueError, "Checkpoint metric"):
            self.run_experiment(resume=True)
        rescore.atomic_json(raw_path, original)
        saved = rescore.read_json(self.output / "summary.json")
        saved["selected_threshold"] = 0
        rescore.atomic_json(self.output / "summary.json", saved)
        with self.assertRaisesRegex(ValueError, "Summary mismatch"):
            self.run_experiment(verify=True)

    def test_duplicate_json_nonfinite_and_symlinks_are_refused(self):
        path = self.root / "bad.json"
        for text in ('{"a":1,"a":2}', '{"a":NaN}'):
            path.write_text(text)
            with self.assertRaises(ValueError):
                rescore.read_json(path)
        self.output.parent.mkdir(parents=True)
        self.output.symlink_to(self.source, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, "Symlink"):
            self.run_experiment(resume=True)
        with self.assertRaisesRegex(ValueError, "Unsafe path"):
            rescore.checked_path(self.root, "../outside.json")


if __name__ == "__main__":
    unittest.main()
