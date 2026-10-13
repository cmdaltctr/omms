"""Synthetic tests: gallery mapping, scoring and the reference gate. No servers, no real labels."""

import os
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
r = types.ModuleType("experiment20_run")
r.__file__ = str(HERE / "run_eval.py")
source = Path(os.environ.get("EXPERIMENT20_FAULT_COPY", r.__file__)).read_text()
exec(compile(source, r.__file__, "exec"), r.__dict__)


def ok(choice, probs):
    return {"status": "ok", "choice": choice, "probabilities": probs, "duration_seconds": 1.0}


class RunEvalTests(unittest.TestCase):

    def test_gallery_maps_to_version_2(self):
        old = {"o1": {"label": "a", "section": "patterns"}}
        e18_cases = {"f1": {"section": "patterns", "description": "t1"}, "f2": {"section": "patterns", "description": "t2"},
                     "f3": {"section": "patterns", "description": "t3"}, "f4": {"section": "patterns", "description": "t4"}}
        reference = {"f1": "none_fit", "f2": "none_fit", "f3": "disputed", "f4": "b"}
        gallery, texts = r.build_gallery(old, {"o1": "t0"}, e18_cases, reference, {"f1": "pattern_new"})
        self.assertEqual(gallery["f1"]["label"], "pattern_new")
        self.assertEqual(gallery["f2"]["label"], "none_fit")
        self.assertNotIn("f3", gallery)
        self.assertEqual(gallery["f4"]["label"], "b")
        self.assertEqual(texts["f1"], "t1")

    def test_clef_top_excludes_none_fit(self):
        self.assertEqual(r.clef_top({"none_fit": 0.5, "a": 0.3, "b": 0.1, "c": 0.06, "d": 0.04}), ["a", "b", "c"])

    def test_summary(self):
        world = {"reference": {"c1": "a", "c2": "b", "c3": "none_fit", "c4": "none_fit", "c5": "disputed", "c6": "pattern_new"}}
        raw = {"c1": ok("a", {"a": 0.6, "b": 0.3, "none_fit": 0.1}),
               "c2": ok("none_fit", {"none_fit": 0.5, "a": 0.2, "x": 0.2, "y": 0.06, "b": 0.04}),
               "c3": ok("none_fit", {"none_fit": 0.9, "a": 0.1}),
               "c4": ok("a", {"a": 0.9, "none_fit": 0.1}),
               "c5": ok("a", {"a": 1.0}),
               "c6": {"status": "error", "duration_seconds": 0.5}}
        s = r.summarise(raw, world, {"pattern_new"})
        self.assertEqual(s["counts"], {"scored": 5, "labelled": 3, "none_fit": 2, "excluded": 1, "errors": 1})
        self.assertEqual((s["H1"]["none_fit"], s["H1"]["scored"]), (2, 5))
        self.assertFalse(s["H1"]["holds"])
        self.assertEqual(s["H2"]["top3_right"], 1)
        self.assertEqual(s["H3"]["first_pick_right"], 1)
        self.assertEqual((s["H3"]["none_fit_recognised"], s["H3"]["labelled_with_new_label"]), (1, 1))
        self.assertEqual((r.H1_MAX_NONE_SHARE, r.H2_MIN_TOP3), (0.35, 0.90))

    def test_refuses_changed_reference(self):
        with tempfile.TemporaryDirectory() as tmp:
            out, corpus = Path(tmp, "output"), Path(tmp, "corpus")
            out.mkdir()
            corpus.mkdir()
            (corpus / "reference.json").write_text('{"decisions": {}}')
            (out / "reference-manifest.json").write_text('{"reference_sha256": "' + "0" * 64 + '"}')
            with patch.object(r, "OUT", out), patch.object(r, "CORPUS", corpus):
                with self.assertRaisesRegex(ValueError, "reference_not_frozen"):
                    r.load_world()


if __name__ == "__main__":
    unittest.main()
