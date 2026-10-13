"""Focused contract tests, also runnable against disposable fault copies. No server, no calls."""

import os
import types
import unittest
from pathlib import Path
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
r = types.ModuleType("experiment15")
r.__file__ = str(HERE / "run_eval.py")
source = Path(os.environ.get("EXPERIMENT15_FAULT_COPY", r.__file__)).read_text()
exec(compile(source, r.__file__, "exec"), r.__dict__)

WORLD = r.load_world()


def ok(choice, probabilities):
    return {"status": "ok", "choice": choice, "probabilities": probabilities,
            "usage": {"input_tokens": 100, "output_tokens": 0}}


class RunEvalTests(unittest.TestCase):

    def test_pins(self):
        with patch.object(r, "CLEF_MANIFEST_SHA256", "0" * 64):
            with self.assertRaisesRegex(ValueError, "input_hash_drift"):
                r.load_world()
        with patch.object(r, "EXP12_RUNNER_SHA256", "0" * 64):
            with self.assertRaisesRegex(ValueError, "input_hash_drift"):
                r.load_experiment12()

    def test_payloads_cover_every_section_label_and_both_orders(self):
        cases, sims, fold_of, texts, labels = WORLD
        test_ids, requests = r.payloads(WORLD)
        self.assertEqual(len(requests), 280)
        case = test_ids[0]
        section = cases[case]["section"]
        expected = sorted(l for l in labels if labels[l]["section"] == section) + ["none_fit"]
        one = list(requests[f"{case}|1"]["questions"]["decision"]["criteria"])
        two = list(requests[f"{case}|2"]["questions"]["decision"]["criteria"])
        self.assertEqual(one, expected)
        self.assertEqual(two, list(reversed(expected)))
        self.assertEqual(requests[f"{case}|1"]["state"]["description"], texts[case])

    def test_examples_come_from_outer_gallery_only(self):
        cases, sims, fold_of, texts, labels = WORLD
        for case in sorted(fold_of)[:20]:
            chosen = r.examples_for(case, r.outer_gallery(case, fold_of, cases), cases, sims, fold_of)
            members = [m for ms in chosen.values() for m in ms]
            self.assertTrue(all(fold_of.get(m) != fold_of[case] for m in members))
            self.assertTrue(all(cases[m]["group"] != cases[case]["group"] for m in members))
            self.assertTrue(all(len(ms) <= (3 if l == "none_fit" else 2) for l, ms in chosen.items()))
            self.assertTrue(all(cases[m]["label"] == l for l, ms in chosen.items() for m in ms))

    def test_example_leak_is_refused(self):
        cases, sims, fold_of, texts, labels = WORLD
        case = sorted(fold_of)[0]
        same_fold = next(c for c in fold_of if fold_of[c] == fold_of[case] and c != case
                         and cases[c]["section"] == cases[case]["section"]
                         and cases[c]["group"] != cases[case]["group"])
        gallery = r.outer_gallery(case, fold_of, cases) + [same_fold]
        with self.assertRaisesRegex(ValueError, "fold_leak"):
            r.examples_for(case, gallery, cases, sims, fold_of)

    def test_launch_args_raise_batch_size(self):
        args = r.launch_args(r.clef_model())
        self.assertEqual(args[args.index("--port") + 1], "3005")
        self.assertEqual(args[args.index("--batch-size") + 1], "8192")
        self.assertEqual(args[args.index("--ubatch-size") + 1], "8192")
        self.assertEqual(args.count("--batch-size"), 1)

    def test_option_text_lists_examples(self):
        texts = {"m1": "first", "m2": "second"}
        self.assertEqual(r.option_text("Def.", ["m1", "m2"], texts, "Past"), "Def. Past: 1) first 2) second")
        self.assertEqual(r.option_text("Def.", [], texts, "Past"), "Def.")

    def test_decide_needs_same_label_both_orders_above_cutoff(self):
        a = ok("x", {"x": 0.95, "none_fit": 0.05})
        self.assertEqual(r.decide(a, ok("x", {"x": 0.9, "none_fit": 0.1}), 0.9), "x")
        self.assertIsNone(r.decide(a, ok("x", {"x": 0.89, "none_fit": 0.11}), 0.9))
        self.assertIsNone(r.decide(a, ok("y", {"y": 0.95, "x": 0.05}), 0.9))
        self.assertIsNone(r.decide(ok("none_fit", {"none_fit": 1.0}), ok("none_fit", {"none_fit": 1.0}), 0.9))
        self.assertIsNone(r.decide(a, {"status": "error"}, 0.9))
        self.assertEqual(r.CUTOFF, 0.9)

    def test_parse_reply_validation(self):
        good = {"model": "clef-flash", "answers": {"decision": {"type": "choice", "choice": "x",
                "probabilities": {"x": 0.7, "none_fit": 0.3}}},
                "usage": {"input_tokens": 100, "output_tokens": 0}}
        self.assertEqual(r.parse_reply(good, ["x", "none_fit"])["choice"], "x")
        bad = {**good, "answers": {"decision": {**good["answers"]["decision"],
                                                "probabilities": {"x": 0.7, "none_fit": 0.2}}}}
        with self.assertRaisesRegex(ValueError, "invalid_probability_sum"):
            r.parse_reply(bad, ["x", "none_fit"])
        with self.assertRaisesRegex(ValueError, "option_shape"):
            r.parse_reply(good, ["x", "y", "none_fit"])
        long = {**good, "usage": {"input_tokens": 9000, "output_tokens": 0}}
        with self.assertRaisesRegex(ValueError, "invalid_usage"):
            r.parse_reply(long, ["x", "none_fit"])

    def test_summary_scores_with_acceptable_sets(self):
        cases = {"c1": {"label": "a", "accept": ["a"]}, "c2": {"label": "none_fit", "accept": ["none_fit"]},
                 "c3": {"label": "a", "accept": ["a", "b"]}}
        calls = {"c1|1": ok("a", {"a": 0.95}), "c1|2": ok("a", {"a": 0.95}),
                 "c2|1": ok("a", {"a": 0.95}), "c2|2": ok("a", {"a": 0.92}),
                 "c3|1": ok("b", {"b": 0.99}), "c3|2": ok("none_fit", {"none_fit": 0.99})}
        with patch.object(r.e12, "paired_with_experiment06", lambda d, c: {}):
            summary, decisions = r.summarise(calls, cases, ["c1", "c2", "c3"])
        c = summary["counts"]
        self.assertEqual((c["correct"], c["wrong"], c["wrong_on_none_fit"], c["parked"]), (1, 1, 1, 1))
        self.assertEqual(summary["order_consistency"], {"both_ok": 3, "same_choice": 2})


if __name__ == "__main__":
    unittest.main()
