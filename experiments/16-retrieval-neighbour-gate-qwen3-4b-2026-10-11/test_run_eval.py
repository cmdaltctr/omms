"""Focused tests with a fake embedder: no download, no model calls."""

import os
import types
import unittest
from pathlib import Path
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
r = types.ModuleType("experiment16")
r.__file__ = str(HERE / "run_eval.py")
source = Path(os.environ.get("EXPERIMENT16_FAULT_COPY", r.__file__)).read_text()
exec(compile(source, r.__file__, "exec"), r.__dict__)


def fake_embed(texts):
    return [[float(len(t) % 7 + 1), float(len(t) % 5 + 1), 1.0] for t in texts]


class RunEvalTests(unittest.TestCase):

    def test_pin_refuses_changed_runner(self):
        with patch.object(r, "EXP12_RUNNER_SHA256", "0" * 64):
            with self.assertRaisesRegex(ValueError, "input_hash_drift"):
                r.load_experiment12()

    def test_text_formats(self):
        self.assertEqual(r.normalise_text("Run tests.  Then: ship"), "Run tests Then ship")
        self.assertEqual(r.embed_text("Run tests.", "plain"), "Run tests")
        self.assertEqual(r.embed_text("Run tests.", "instruct"),
                         f"Instruct: {r.INSTRUCTION}\nQuery:Run tests")

    def test_build_vectors_covers_every_case(self):
        saved = r.build_vectors("plain", embed=fake_embed)
        self.assertEqual(len(saved["vectors"]), 200)
        self.assertEqual(saved["dimensions"], 3)
        other = r.build_vectors("instruct", embed=fake_embed)
        self.assertNotEqual(saved["inputs_sha256"], other["inputs_sha256"])

    def test_cell_uses_new_vectors_and_restores_loader(self):
        saved = r.build_vectors("plain", embed=fake_embed)
        original = r.e12.load_inputs
        result = r.run_cell(saved)
        self.assertIs(r.e12.load_inputs, original)
        self.assertEqual(result["counts"]["n"], 140)
        cases, unit = r.with_vectors(saved)
        self.assertEqual(len(next(iter(unit.values()))), 3)

    def test_missing_vector_refused(self):
        saved = r.build_vectors("plain", embed=fake_embed)
        saved["vectors"].pop(next(iter(saved["vectors"])))
        with self.assertRaisesRegex(ValueError, "vector_coverage"):
            r.with_vectors(saved)

    def test_launch_args_and_download_check(self):
        args = r.launch_args()
        self.assertIn("--embedding", args)
        self.assertEqual(args[args.index("--pooling") + 1], "last")
        self.assertEqual(args[args.index("--ubatch-size") + 1], "8192")
        self.assertEqual(args[args.index("--port") + 1], "3007")

        class Fake:
            def __init__(self, data):
                self.data = [data, b""]
            def read(self, n):
                return self.data.pop(0)
            def __enter__(self):
                return self
            def __exit__(self, *a):
                return False
        with patch.object(r, "GGUF_PATH", r.OUT / "test-tmp" / "x.gguf"), patch.object(r, "GGUF_BYTES", 3):
            with self.assertRaisesRegex(ValueError, "gguf_drift"):
                r.ensure_gguf(fetch=lambda url, timeout: Fake(b"abc"))
            self.assertFalse((r.OUT / "test-tmp" / "x.part").exists())

    def test_interpretation_thresholds(self):
        self.assertEqual(r.interpret(50), "embedder was the main gap")
        self.assertEqual(r.interpret(40), "data (about 3 examples per label) is the main gap")
        self.assertEqual(r.interpret(45), "both matter")

    def test_nearest_diagnostic(self):
        cases = {"a": {"label": "x", "accept": ["x"]}, "b": {"label": "none_fit", "accept": ["none_fit"]},
                 "c": {"label": "y", "accept": ["y"]}}
        decisions = {"a": {"neighbours": [["m", "x", 0.9]]}, "b": {"neighbours": [["m", "x", 0.9]]},
                     "c": {"neighbours": [["m", "none_fit", 0.9]]}}
        self.assertEqual(r.nearest_diagnostic(decisions, cases),
                         {"labelled": 2, "nearest_acceptable": 1, "none_fit_cases": 1,
                          "nearest_label_on_none_fit": 1})


if __name__ == "__main__":
    unittest.main()
