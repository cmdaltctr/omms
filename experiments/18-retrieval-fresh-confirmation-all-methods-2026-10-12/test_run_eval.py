"""Runner tests with synthetic data: no servers, no model calls, no real labels."""

import os
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
r = types.ModuleType("experiment18_run")
r.__file__ = str(HERE / "run_eval.py")
source = Path(os.environ.get("EXPERIMENT18_RUN_FAULT_COPY", r.__file__)).read_text()
exec(compile(source, r.__file__, "exec"), r.__dict__)


def world():
    gallery = {"g1": {"label": "a", "section": "patterns"}, "g2": {"label": "none_fit", "section": "patterns"},
               "g3": {"label": "b", "section": "patterns"}, "g4": {"label": "a", "section": "patterns"},
               "g5": {"label": "x", "section": "preferences"}}
    labels = {"a": {"section": "patterns", "definition": "Def A."}, "b": {"section": "patterns", "definition": "Def B."},
              "x": {"section": "preferences", "definition": "Def X."}}
    texts = {g: f"text {g}" for g in gallery}
    return {"gallery": gallery, "labels": labels, "texts": texts,
            "gallery_vectors": {"g1": [1, 0], "g2": [0.9, 0.1], "g3": [0, 1], "g4": [0.8, 0.2], "g5": [1, 0]}}


def answer(cos, rer, clef):
    return {"cosine": {"top3": [cos] if cos else []}, "reranker": {"top3": [rer] if rer else []},
            "clef": {"pick": clef}}


class RunEvalTests(unittest.TestCase):

    def test_refuses_without_frozen_reference(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(r, "OUT", Path(tmp)):
            with self.assertRaises((ValueError, OSError)):
                r.load_world()

    def test_refuses_changed_reference(self):
        with tempfile.TemporaryDirectory() as tmp:
            out, corpus = Path(tmp, "output"), Path(tmp, "corpus")
            out.mkdir()
            corpus.mkdir()
            (corpus / "fresh-reference.json").write_text('{"decisions": {}}')
            (out / "reference-manifest.json").write_text('{"reference_sha256": "' + "0" * 64 + '"}')
            with patch.object(r, "OUT", out), patch.object(r, "CORPUS", corpus):
                with self.assertRaisesRegex(ValueError, "reference_not_frozen"):
                    r.load_world()

    def test_pins(self):
        with patch.dict(r.RUNNERS, {"e15": (r.RUNNERS["e15"][0], "0" * 64)}):
            with self.assertRaisesRegex(ValueError, "input_hash_drift"):
                r.load_runner("e15")

    def test_ranking_and_cosine_pick(self):
        w = world()
        ranked, sims = r.ranked_gallery([1.0, 0.0], "patterns", w)
        self.assertEqual(ranked, ["g1", "g2", "g4", "g3"])
        self.assertNotIn("g5", ranked)
        self.assertEqual(r.first_labels(["g2", "g1", "g4", "g3"], w["gallery"]), ["a", "b"])

    def test_clef_payload_uses_gallery_examples_only(self):
        w = world()
        case = {"description": "fresh text", "section": "patterns"}
        payload = r.clef_payload(case, ["g1", "g2", "g4", "g3"], w)
        criteria = payload["questions"]["decision"]["criteria"]
        self.assertEqual(list(criteria), ["a", "b", "none_fit"])
        self.assertIn("text g1", criteria["a"])
        self.assertIn("text g4", criteria["a"])
        self.assertIn("text g2", criteria["none_fit"])
        self.assertEqual(payload["state"], {"description": "fresh text", "section": "patterns"})
        with self.assertRaisesRegex(ValueError, "fresh_in_gallery"):
            r.clef_payload(case, ["f99", "g1"], w)

    def test_summary_hypotheses(self):
        w = {"reference": {"c1": "a", "c2": "b", "c3": "a", "c4": "none_fit", "c5": "none_fit", "c6": "disputed"}}
        answers = {"c1": answer("a", "a", "a"), "c2": answer("a", "b", "b"), "c3": answer("b", "b", None),
                   "c4": answer("a", "a", "a"), "c5": answer("a", "b", None), "c6": answer("a", "a", "a")}
        with patch.object(r.e12, "upper_bound", lambda n, k: 0.5), \
                patch.object(r.e12, "paired_with_experiment06", lambda d, c: {}, create=True):
            s = r.summarise(answers, w)
        self.assertEqual(s["reference_counts"], {"labelled": 3, "none_fit": 2, "excluded": 1})
        self.assertEqual((s["H1"]["union_right"], s["H1"]["n"]), (2, 3))
        self.assertFalse(s["H1"]["holds"])
        self.assertEqual((s["H2"]["agree"], s["H2"]["agree_right"], s["H2"]["agree_on_none_fit"]), (1, 1, 1))
        self.assertEqual((s["H4"]["accepted"], s["H4"]["wrong"]), (2, 1))
        self.assertEqual(s["H3"]["first_pick_right"], {"cosine": 1, "reranker": 2, "clef": 2, "vote": 2})
        self.assertEqual(s["clef_none_fit_recognition"], {"none_fit_cases": 2, "clef_said_none_fit": 1})

    def test_statistics(self):
        low, high = r.interval(62, 67)
        self.assertAlmostEqual(low, 0.8345, places=3)
        self.assertAlmostEqual(high, 0.9752, places=3)
        self.assertEqual(r.interval(0, 10)[0], 0.0)
        self.assertEqual(r.interval(10, 10)[1], 1.0)
        self.assertAlmostEqual(r.sign_test(14, 12), 0.845, places=3)
        self.assertEqual(r.sign_test(0, 0), 1.0)
        self.assertEqual((r.H1_MIN, r.H2_MIN, r.H4_MAX_UPPER), (0.85, 0.90, 0.05))


if __name__ == "__main__":
    unittest.main()
