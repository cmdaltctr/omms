"""Reference freeze tests with synthetic answers only."""

import os
import types
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
f = types.ModuleType("experiment18_finalise")
f.__file__ = str(HERE / "finalise_reference.py")
source = Path(os.environ.get("EXPERIMENT18_FINALISE_FAULT_COPY", f.__file__)).read_text()
exec(compile(source, f.__file__, "exec"), f.__dict__)

OBS = {"o1": {"section": "patterns"}, "o2": {"section": "patterns"}, "o3": {"section": "preferences"},
       "o4": {"section": "preferences"}}
SECTIONS = {"pat_a": "patterns", "pat_b": "patterns", "pref_a": "preferences"}


def payload(name, labels):
    return {"labeller": name, "answers": [{"id": k, "label": v, "note": ""} for k, v in labels.items()]}


class FinaliseTests(unittest.TestCase):

    def test_validation(self):
        good = payload("pass1", {"o1": "pat_a", "o2": "none_fit", "o3": "pref_a", "o4": "uncertain"})
        self.assertEqual(len(f.validate_pass(good, OBS, SECTIONS, "pass1")), 4)
        cross = payload("pass1", {"o1": "pref_a", "o2": "none_fit", "o3": "pref_a", "o4": "uncertain"})
        with self.assertRaisesRegex(ValueError, "answer_label"):
            f.validate_pass(cross, OBS, SECTIONS, "pass1")
        missing = payload("pass1", {"o1": "pat_a", "o2": "none_fit", "o3": "pref_a"})
        with self.assertRaisesRegex(ValueError, "answer_coverage"):
            f.validate_pass(missing, OBS, SECTIONS, "pass1")
        with self.assertRaisesRegex(ValueError, "labeller_name"):
            f.validate_pass(good, OBS, SECTIONS, "pass2")
        stray = payload("pass1", {"o1": "pat_a", "o2": "none_fit", "o3": "pref_a", "o4": "uncertain"})
        stray["answers"][0]["new_label"] = "x"
        with self.assertRaisesRegex(ValueError, "new_label_without_none_fit"):
            f.validate_pass(stray, OBS, SECTIONS, "pass1")

    def test_finalise_rules(self):
        first = {"o1": {"label": "pat_a"}, "o2": {"label": "pat_a"}, "o3": {"label": "pref_a"}, "o4": {"label": "none_fit"}}
        second = {"o1": {"label": "pat_a"}, "o2": {"label": "pat_b"}, "o3": {"label": "none_fit"}, "o4": {"label": "none_fit"}}
        self.assertEqual(f.disagreements(first, second), ["o2", "o3"])
        responses = [{"id": "o2", "position": "concede", "final": "pat_b"},
                     {"id": "o3", "position": "keep", "final": "pref_a"}]
        final = f.finalise(first, second, responses)
        self.assertEqual(final, {"o1": "pat_a", "o2": "pat_b", "o3": "disputed", "o4": "none_fit"})
        self.assertEqual(f.counts(final), {"label": 2, "none_fit": 1, "uncertain": 0, "disputed": 1})
        with self.assertRaisesRegex(ValueError, "reconcile_final"):
            f.finalise(first, second, [{"id": "o2", "position": "concede", "final": "pat_a"},
                                       {"id": "o3", "position": "keep", "final": "pref_a"}])
        with self.assertRaisesRegex(ValueError, "reconcile_coverage"):
            f.finalise(first, second, responses[:1])
        self.assertEqual(f.G5_MIN_AGREEMENT, 0.75)


if __name__ == "__main__":
    unittest.main()
