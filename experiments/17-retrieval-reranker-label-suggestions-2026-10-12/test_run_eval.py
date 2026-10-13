"""Focused contract tests, also runnable against disposable fault copies. No server, no model calls."""

import os
import types
import unittest
from pathlib import Path
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
r = types.ModuleType("experiment17")
r.__file__ = str(HERE / "run_eval.py")
source = Path(os.environ.get("EXPERIMENT17_FAULT_COPY", r.__file__)).read_text()
exec(compile(source, r.__file__, "exec"), r.__dict__)

WORLD = r.load_world()


class RunEvalTests(unittest.TestCase):

    def test_pins(self):
        with patch.object(r, "VECTORS_SHA256", "0" * 64):
            with self.assertRaisesRegex(ValueError, "input_hash_drift"):
                r.load_world()

    def test_requests_cover_both_routes_and_variants(self):
        cases, sims, fold_of, texts, labels = WORLD
        requests = r.build_requests(WORLD)
        self.assertEqual(len(requests), 140 * 2 * 2)
        case = sorted(fold_of)[0]
        a = requests[f"A|plain|{case}"]
        self.assertEqual(len(a["documents"]), 10)
        self.assertEqual(a["query"], texts[case])
        self.assertTrue(requests[f"A|intent|{case}"]["query"].startswith(r.INTENT_PREFIX))
        b = requests[f"B|plain|{case}"]
        section = cases[case]["section"]
        self.assertEqual(b["doc_labels"], sorted(l for l in labels if labels[l]["section"] == section))

    def test_shortlist_outer_gallery_only(self):
        cases, sims, fold_of, texts, labels = WORLD
        for case in sorted(fold_of)[:15]:
            members = r.shortlist(case, cases, sims, fold_of)
            self.assertTrue(all(fold_of.get(m) != fold_of[case] for m in members))
            self.assertTrue(all(cases[m]["group"] != cases[case]["group"] for m in members))

    def test_shortlist_leak_refused(self):
        cases, sims, fold_of, texts, labels = WORLD
        case = sorted(fold_of)[0]
        leak = next(c for c in fold_of if fold_of[c] == fold_of[case] and c != case
                    and cases[c]["section"] == cases[case]["section"] and cases[c]["group"] != cases[case]["group"])
        gallery = sorted(c for c in cases if fold_of.get(c) != fold_of[case]) + [leak]
        sims[case][leak] = sims[leak][case] = 1.0
        try:
            with self.assertRaisesRegex(ValueError, "fold_leak"):
                r.shortlist(case, cases, sims, fold_of, gallery)
        finally:
            fresh = r.load_world()
            sims[case][leak] = sims[leak][case] = fresh[1][case][leak]

    def test_suggestions_skip_none_fit_and_dedupe(self):
        labels = ["none_fit", "a", "a", "b", "none_fit", "c", "d"]
        self.assertEqual(r.suggestions(labels, list(range(7))), ["a", "b", "c"])
        self.assertEqual(r.order_by([0.1, 0.9, 0.9, 0.5]), [1, 2, 3, 0])

    def test_score_route_and_ceiling(self):
        cases = {"c1": {"label": "a", "accept": ["a"]}, "c2": {"label": "b", "accept": ["b", "x"]},
                 "c3": {"label": "none_fit", "accept": ["none_fit"]}, "c4": {"label": "d", "accept": ["d"]}}
        rows = {"c1": {"top3": ["a", "q", "r"], "top_score": 0.9},
                "c2": {"top3": ["q", "x"], "top_score": 0.8},
                "c3": {"top3": ["a"], "top_score": 0.7},
                "c4": {"top3": ["d"], "top_score": 0.6}}
        s = r.score_route(rows, cases, ["c1", "c2", "c3", "c4"])
        self.assertEqual((s["labelled"], s["top1_correct"], s["top3_correct"]), (3, 2, 3))
        self.assertEqual(r.safety_ceiling(rows, cases, ["c1", "c2", "c3", "c4"]), 1)
        rows["c2"]["top3"] = ["b"]
        self.assertEqual(r.safety_ceiling(rows, cases, ["c1", "c2", "c3", "c4"]), 2)

    def test_parse_rerank(self):
        data = {"results": [{"index": 1, "relevance_score": 0.2}, {"index": 0, "relevance_score": 0.9}]}
        self.assertEqual(r.parse_rerank(data, 2), [0.9, 0.2])
        with self.assertRaisesRegex(ValueError, "rerank_shape"):
            r.parse_rerank(data, 3)
        bad = {"results": [{"index": 0, "relevance_score": float("nan")}, {"index": 1, "relevance_score": 0.1}]}
        with self.assertRaisesRegex(ValueError, "invalid_score"):
            r.parse_rerank(bad, 2)

    def test_launch_args(self):
        args = r.launch_args()
        self.assertIn("--reranking", args)
        self.assertEqual(args[args.index("--port") + 1], "3008")
        self.assertEqual(args[args.index("--ubatch-size") + 1], "8192")
        self.assertEqual(r.TARGET, 46)

    def test_cosine_baseline_uses_shortlist_order(self):
        cases, sims, fold_of, texts, labels = WORLD
        requests = r.build_requests(WORLD)
        test_ids = sorted(fold_of)
        scores = {k: {"status": "ok", "scores": [float(-i) for i in range(len(v["documents"]))],
                      "duration_seconds": 0.0} for k, v in requests.items()}
        summary = r.summarise(scores, requests, cases, test_ids)
        self.assertEqual(summary["routes"]["A|plain"]["top1_correct"], summary["cosine_baseline"]["top1_correct"])
        self.assertEqual(summary["routes"]["A|plain"]["paired_vs_cosine"],
                         {"only_reranker_right": 0, "only_cosine_right": 0})


if __name__ == "__main__":
    unittest.main()
