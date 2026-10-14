"""Focused tests: the frozen runner is pinned, K really changes, and nothing is written to Experiment 12."""

import unittest
from pathlib import Path
from unittest.mock import patch

import importlib.util

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("experiment14", HERE / "run_eval.py")
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)


def case(label, group):
    return {"split": "test", "section": "patterns", "group": group, "label": label, "accept": [label]}


class RunEvalTests(unittest.TestCase):

    def test_pin_refuses_changed_runner(self):
        with patch.object(r, "EXP12_RUNNER_SHA256", "0" * 64):
            with self.assertRaisesRegex(ValueError, "input_hash_drift"):
                r.load_experiment12()

    def test_k_changes_the_rule(self):
        e12 = r.load_experiment12()
        cases = {"q": case("x", "gq"), "a": case("a", "g1"), "b": case("b", "g2"),
                 "c": case("a", "g3")}
        sims = {"q": {"a": 0.9, "b": 0.8, "c": 0.7}}
        ranked = ["a", "b", "c"]
        e12.K = 1
        self.assertEqual(e12.features("q", ranked, cases, sims)["label"], "a")
        e12.K = 2
        self.assertIsNone(e12.features("q", ranked, cases, sims))

    def test_no_writes_into_experiment12(self):
        e12 = r.load_experiment12()
        self.assertNotEqual(e12.OUT.resolve().parent.parent, r.EXP12.resolve())
        self.assertTrue(str(e12.OUT.resolve()).startswith(str(r.HERE)))


if __name__ == "__main__":
    unittest.main()
