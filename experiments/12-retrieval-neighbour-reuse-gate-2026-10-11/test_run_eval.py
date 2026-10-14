"""Focused contract tests, also runnable against disposable fault copies."""

import math
import os
import types
import unittest
from pathlib import Path
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
r = types.ModuleType("experiment12")
r.__file__ = str(HERE / "run_eval.py")
source = Path(os.environ.get("EXPERIMENT12_FAULT_COPY", r.__file__)).read_text()
exec(compile(source, r.__file__, "exec"), r.__dict__)


def case(label, group, split="test", accept=None):
    return {"split": split, "section": "patterns", "group": group, "label": label,
            "accept": accept or [label]}


def sims_from(pairs, ids):
    sims = {i: {} for i in ids}
    for (a, b), value in pairs.items():
        sims[a][b] = sims[b][a] = value
    return sims


class RunEvalTests(unittest.TestCase):

    def test_pins_and_inputs(self):
        cases, vectors = r.load_inputs()
        self.assertEqual(len(cases), 200)
        self.assertAlmostEqual(sum(v * v for v in next(iter(vectors.values()))), 1.0, places=9)
        name = next(iter(r.PINS))
        with patch.dict(r.PINS, {name: "0" * 64}):
            with self.assertRaisesRegex(ValueError, "input_hash_drift"):
                r.check_pins()

    def test_folds_keep_groups_whole(self):
        cases, _ = r.load_inputs()
        fold_of = r.assign_folds(cases)
        self.assertEqual(len(fold_of), 140)
        self.assertEqual(set(fold_of.values()), set(range(5)))
        by_group = {}
        for c, f in fold_of.items():
            by_group.setdefault(cases[c]["group"], set()).add(f)
        self.assertTrue(all(len(f) == 1 for f in by_group.values()))
        self.assertEqual(fold_of, r.assign_folds(cases))

    def test_neighbours_refuse_same_group(self):
        cases = {"q": case("a", "g1"), "m": case("a", "g1"), "n": case("a", "g2")}
        sims = sims_from({("q", "m"): 0.9, ("q", "n"): 0.8}, cases)
        with self.assertRaisesRegex(ValueError, "fold_leak"):
            r.neighbours("q", ["m", "n"], cases, sims)
        self.assertEqual(r.neighbours("q", ["n"], cases, sims), ["n"])

    def test_features_need_unanimous_existing_label(self):
        ids = ["q", "a1", "a2", "a3", "n1", "b1"]
        cases = {"q": case("x", "gq"), "a1": case("a", "g1"), "a2": case("a", "g2"),
                 "a3": case("a", "g3"), "n1": case("none_fit", "g4"), "b1": case("b", "g5")}
        sims = sims_from({("q", "a1"): 0.9, ("q", "a2"): 0.8, ("q", "a3"): 0.7,
                          ("q", "n1"): 0.6, ("q", "b1"): 0.5}, ids)
        ranked = r.neighbours("q", ids[1:], cases, sims)
        f = r.features("q", ranked, cases, sims)
        self.assertEqual(f["label"], "a")
        self.assertAlmostEqual(f["best"], 0.9)
        self.assertAlmostEqual(f["gap"], 0.3)  # rival is the none_fit member at 0.6
        sims["q"]["b1"] = sims["b1"]["q"] = 0.85
        self.assertIsNone(r.features("q", r.neighbours("q", ids[1:], cases, sims), cases, sims))
        nf = {**cases, "a1": case("none_fit", "g1"), "a2": case("none_fit", "g2"),
              "a3": case("none_fit", "g3")}
        sims["q"]["b1"] = sims["b1"]["q"] = 0.5
        self.assertIsNone(r.features("q", r.neighbours("q", ids[1:], nf, sims), nf, sims))
        self.assertIsNone(r.features("q", ["a1", "a2"], cases, sims))

    def test_decide_boundaries(self):
        f = {"label": "a", "best": 0.7, "gap": 0.05}
        self.assertEqual(r.decide(f, (0.7, 0.05)), "a")
        self.assertIsNone(r.decide(f, (0.75, 0.05)))
        self.assertIsNone(r.decide(f, (0.7, 0.08)))
        self.assertIsNone(r.decide(f, None))
        self.assertEqual(r.decide({"label": "a", "best": 0.9, "gap": math.inf}, (0.9, 0.12)), "a")

    def test_choose_rule_zero_wrong_then_strictest(self):
        feats = {"q1": {"label": "a", "best": 0.92, "gap": 0.2},
                 "q2": {"label": "a", "best": 0.81, "gap": 0.2},
                 "q3": {"label": "a", "best": 0.72, "gap": 0.2}}
        cases = {"q1": case("a", "g1"), "q2": case("a", "g2"), "q3": case("b", "g3")}
        with patch.object(r, "neighbours", lambda q, g, c, s: q), \
                patch.object(r, "features", lambda q, ranked, c, s: feats[q]):
            rule, scores = r.choose_rule(["q1", "q2", "q3"], cases, {})
        # tau 0.75 and 0.8 both give 2 correct and 0 wrong; the stricter 0.8 wins, largest delta.
        self.assertEqual(rule, [0.8, 0.12])
        self.assertEqual(scores["0.7|0"], {"correct": 2, "wrong": 1})
        # One wrong pick is never traded for an extra correct one.
        trade = {"q1": case("a", "g1"), "q2": case("b", "g2"), "q3": case("a", "g3")}
        with patch.object(r, "neighbours", lambda q, g, c, s: q), \
                patch.object(r, "features", lambda q, ranked, c, s: feats[q]):
            self.assertEqual(r.choose_rule(["q1", "q2", "q3"], trade, {})[0], [0.9, 0.12])
        cases["q1"] = case("b", "g1")
        cases["q2"] = case("b", "g2")
        with patch.object(r, "neighbours", lambda q, g, c, s: q), \
                patch.object(r, "features", lambda q, ranked, c, s: feats[q]):
            self.assertIsNone(r.choose_rule(["q1", "q2", "q3"], cases, {})[0])

    def test_inner_selection_leaves_out_own_group(self):
        seen = []
        cases = {"q1": case("a", "g1"), "q2": case("a", "g1"), "q3": case("a", "g2")}

        def spy(query, gallery, c, s):
            seen.append((query, sorted(gallery)))
            return []
        with patch.object(r, "neighbours", spy):
            r.choose_rule(["q1", "q2", "q3"], cases, {})
        self.assertEqual(dict(seen), {"q1": ["q3"], "q2": ["q3"], "q3": ["q1", "q2"]})

    def test_score_counts_and_tier1(self):
        cases = {"c1": case("a", "g1"), "c2": case("none_fit", "g2"), "c3": case("a", "g3"),
                 "c4": case("a", "g4", accept=["a", "b"])}
        rows = {"c1": {"decision": "a"}, "c2": {"decision": "a"}, "c3": {"decision": None},
                "c4": {"decision": "b"}}
        s = r.score(rows, cases)
        self.assertEqual((s["existing"], s["correct"], s["wrong"], s["wrong_on_none_fit"],
                          s["parked"]), (3, 2, 1, 1, 1))
        many = {f"k{i}": case("a", f"g{i}") for i in range(29)}
        self.assertFalse(r.score({k: {"decision": "a"} for k in list(many)[:28]}, many)["tier1_pass"])
        self.assertTrue(r.score({k: {"decision": "a"} for k in many}, many)["tier1_pass"])

    def test_run_fold_keeps_held_out_out_of_gallery(self):
        cases = {"t1": case("a", "g1"), "t2": case("a", "g2"), "d1": case("a", "d1", "development"),
                 "d2": case("a", "d2", "development"), "d3": case("a", "d3", "development")}
        fold_of = {"t1": 0, "t2": 1}
        sims = sims_from({(a, b): 0.9 for a in cases for b in cases if a < b}, cases)
        result = r.run_fold(0, fold_of, cases, sims)
        self.assertEqual(sorted(result["decisions"]), ["t1"])
        self.assertNotIn("t1", [m for m, _, _ in result["decisions"]["t1"]["neighbours"]])
        self.assertEqual(result["gallery_size"], 4)

    def test_holding_pen_groups(self):
        ids = ["p1", "p2", "p3", "p4"]
        sims = sims_from({("p1", "p2"): 0.9, ("p2", "p3"): 0.9, ("p3", "p4"): 0.1,
                          ("p1", "p3"): 0.1, ("p1", "p4"): 0.1, ("p2", "p4"): 0.1}, ids)
        decisions = {c: {"decision": None, "fold": 0} for c in ids}
        pen = r.holding_pen(decisions, {0: [0.8, 0]}, sims)
        self.assertEqual((pen["parked"], pen["groups"], pen["groups_of_3_plus"],
                          pen["cases_in_groups_of_3_plus"]), (4, 2, 1, 3))

    def test_upper_bound(self):
        self.assertLessEqual(r.upper_bound(29, 0), 0.10)
        self.assertGreater(r.upper_bound(28, 0), 0.10)
        self.assertIsNone(r.upper_bound(0, 0))


if __name__ == "__main__":
    unittest.main()
