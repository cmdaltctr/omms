"""Focused contract tests, also runnable against disposable fault copies."""

import copy
import os
import types
import unittest
from pathlib import Path
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
r = types.ModuleType("experiment11")
r.__file__ = str(HERE / "run_eval.py")
source = Path(os.environ.get("EXPERIMENT11_FAULT_COPY", r.__file__)).read_text()
exec(compile(source, r.__file__, "exec"), r.__dict__)


def synthetic_labels():
    return {name: {"id": name, "section": "patterns"} for name in ("a", "b", "c", "d")}


class RunEvalTests(unittest.TestCase):

    def test_pins_and_inputs(self):
        r.check_pins()
        self.assertEqual(len(r.load_catalogue()), 41)
        self.assertEqual(len(r.load_dev_cases()), 60)
        self.assertEqual(len(r.load_clef_records()), 1230)
        name = next(iter(r.PINS))
        with patch.dict(r.PINS, {name: "0" * 64}):
            with self.assertRaisesRegex(ValueError, "input_hash_drift"):
                r.check_pins()

    def test_build_refuses_test_record(self):
        labels, dev = r.load_catalogue(), r.load_dev_cases()
        records = r.load_clef_records()
        test_case = next(case for case in r.load_reference() if case not in dev)
        leaked = copy.deepcopy(records[0])
        leaked["case_id"] = test_case
        with self.assertRaisesRegex(ValueError, "test_record_in_build"):
            r.similarity_table(labels, dev, records + [leaked])

    def test_build_refuses_missing_pair(self):
        labels, dev = r.load_catalogue(), r.load_dev_cases()
        with self.assertRaisesRegex(ValueError, "missing_pair_score"):
            r.similarity_table(labels, dev, r.load_clef_records()[1:])

    def test_similarity_is_two_way_mean(self):
        labels = synthetic_labels()
        dev = {"x1": "a", "x2": "a", "y1": "b", "z1": "c", "w1": "d"}
        p = {("x1", "b"): 0.2, ("x2", "b"): 0.4, ("y1", "a"): 0.9}
        records = []
        for case, own in dev.items():
            for label in labels:
                if label != own:
                    records.append({"case_id": case, "label_id": label, "phase": "calibration",
                                    "status": "ok", "p_yes": p.get((case, label), 0.1)})
        table = r.similarity_table(labels, dev, records)
        self.assertAlmostEqual(table[("a", "b")], (0.2 + 0.4 + 0.9) / 3)
        self.assertNotIn(("b", "a"), table)

    def test_average_linkage_order_ties_and_nesting(self):
        table = {("a", "b"): 0.9, ("a", "c"): 0.1, ("a", "d"): 0.1,
                 ("b", "c"): 0.5, ("b", "d"): 0.1, ("c", "d"): 0.5}
        snaps = r.cluster_section(["a", "b", "c", "d"], table, {"L3": 3, "L2": 2})
        self.assertEqual(snaps["L3"], [("a", "b"), ("c",), ("d",)])
        # (a,b)-c average is 0.3; c-d is 0.5, so c and d merge next.
        self.assertEqual(snaps["L2"], [("a", "b"), ("c", "d")])
        tied = {k: 0.5 for k in table}
        self.assertEqual(r.cluster_section(["a", "b", "c", "d"], tied, {"L3": 3})["L3"],
                         [("a", "b"), ("c",), ("d",)])

    def test_acceptable_sets_widen_only_label_disputes(self):
        labels = synthetic_labels()
        reference = {"k1": {"label": "a"}, "k2": {"label": "b"}, "k3": {"label": "none_fit"},
                     "k4": {"label": "c"}}
        responses = [
            {"key": "k1", "position": "keep", "draft": "b", "judge": "a"},
            {"key": "k2", "position": "keep", "draft": "none_fit", "judge": "b"},
            {"key": "k3", "position": "keep", "draft": "a", "judge": "none_fit"},
            {"key": "k4", "position": "concede", "draft": "d", "judge": "c"},
        ]
        sets, widened = r.build_acceptable_sets(labels, reference, responses)
        self.assertEqual(sets, {"k1": ["a", "b"], "k2": ["b"], "k3": ["none_fit"], "k4": ["c"]})
        self.assertEqual(widened, ["k1"])

    def test_score_cell_outcomes_and_merging(self):
        cases = ["k1", "k2", "k3", "k4", "k5", "k6"]
        choices = {"k1": "a", "k2": "b", "k3": "a", "k4": "none_fit", "k5": "none_fit",
                   "k6": "uncertain"}
        reference = {"k1": "a", "k2": "a", "k3": "none_fit", "k4": "none_fit", "k5": "c",
                     "k6": "a"}
        sets = {c: [reference[c]] for c in cases}
        plain = r.score_cell(cases, choices, reference, sets, None, True)
        self.assertEqual([plain[c]["outcome"] for c in cases],
                         ["correct_reuse", "wrong_label_vs_label", "wrong_on_none_fit",
                          "none_fit_correct", "none_fit_missed", "uncertain"])
        merged = r.score_cell(cases, choices, reference, sets, {"a": "a+b", "b": "a+b"}, True)
        self.assertEqual(merged["k2"]["outcome"], "correct_reuse")
        self.assertEqual(merged["k3"]["outcome"], "wrong_on_none_fit")
        counts = r.cell_counts(merged)
        self.assertEqual((counts["existing"], counts["correct"], counts["wrong"]), (3, 2, 1))
        self.assertFalse(counts["tier1_pass"])

    def test_single_reference_ignores_sets(self):
        rows = r.score_cell(["k1"], {"k1": "b"}, {"k1": "a"}, {"k1": ["a", "b"]}, None, False)
        self.assertEqual(rows["k1"]["outcome"], "wrong_label_vs_label")
        rows = r.score_cell(["k1"], {"k1": "b"}, {"k1": "a"}, {"k1": ["a", "b"]}, None, True)
        self.assertEqual(rows["k1"]["outcome"], "correct_reuse")

    def test_upper_bound_matches_ruler(self):
        self.assertAlmostEqual(r.upper_bound(19, 0), 1 - 0.05 ** (1 / 19), places=6)
        self.assertLessEqual(r.upper_bound(29, 0), 0.10)
        self.assertGreater(r.upper_bound(28, 0), 0.10)
        self.assertLessEqual(r.upper_bound(59, 0), 0.05)
        self.assertLessEqual(r.upper_bound(93, 1), 0.05)
        self.assertGreater(r.upper_bound(92, 1), 0.05)
        self.assertIsNone(r.upper_bound(0, 0))

    def test_tier1_rule(self):
        rows = {f"k{i}": {"outcome": "correct_reuse"} for i in range(28)}
        self.assertFalse(r.cell_counts(rows)["tier1_pass"])
        rows = {f"k{i}": {"outcome": "correct_reuse"} for i in range(29)}
        self.assertTrue(r.cell_counts(rows)["tier1_pass"])
        rows["k0"] = {"outcome": "wrong_on_none_fit"}
        self.assertFalse(r.cell_counts(rows)["tier1_pass"])

    def test_baseline_reproduces_experiment10(self):
        cases, choices = r.load_score_inputs()
        reference = {c: d["label"] for c, d in r.load_reference().items()}
        rows = r.score_cell(cases, choices, reference, {}, None, False)
        counts = r.cell_counts(rows)
        self.assertEqual((counts["existing"], counts["correct"], counts["wrong"]), (71, 29, 42))
        self.assertEqual((counts["wrong_on_none_fit"], counts["wrong_label_vs_label"]), (28, 14))


if __name__ == "__main__":
    unittest.main()
