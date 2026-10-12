"""Synthetic tests for the candidate checks."""

import copy
import os
import types
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
c = types.ModuleType("experiment19")
c.__file__ = str(HERE / "check_candidates.py")
source = Path(os.environ.get("EXPERIMENT19_FAULT_COPY", c.__file__)).read_text()
exec(compile(source, c.__file__, "exec"), c.__dict__)

SECTIONS = {"a": "patterns", "b": "patterns", "d": "patterns", "e": "patterns", "f": "preferences"}
GOOD = {"candidates": [{"id": "pattern_new", "section": "patterns", "definition": "Does X. Excludes Y.",
                        "members": ["a", "b", "d"]}], "unassigned": ["e", "f"]}


class CheckTests(unittest.TestCase):

    def test_good_payload(self):
        c.validate(GOOD, SECTIONS, {"pattern_old"})
        s = c.summarise(GOOD, SECTIONS)
        self.assertEqual((s["covered"], s["unassigned"], s["candidates"]), (3, 2, 1))
        self.assertAlmostEqual(s["coverage"], 0.6)
        self.assertTrue(s["passes"])

    def test_rejections(self):
        cases = {
            "group_too_small": lambda p: p["candidates"][0].update(members=["a", "b"]) or p["unassigned"].append("d"),
            "member_section": lambda p: p["candidates"][0]["members"].append("f") or p["unassigned"].remove("f"),
            "member_ids": lambda p: p["unassigned"].append("a"),
            "coverage": lambda p: p["unassigned"].remove("e"),
            "candidate_id": lambda p: p["candidates"][0].update(id="pattern_old"),
            "definition_needs_exclusion": lambda p: p["candidates"][0].update(definition="Does X."),
        }
        for code, mutate in cases.items():
            bad = copy.deepcopy(GOOD)
            mutate(bad)
            with self.assertRaisesRegex(ValueError, code):
                c.validate(bad, SECTIONS, {"pattern_old"})

    def test_observation_in_two_groups_refused(self):
        bad = copy.deepcopy(GOOD)
        bad["candidates"].append({"id": "pattern_other", "section": "patterns", "definition": "Does Z. Excludes Y.",
                                  "members": ["a", "e", "b"]})
        bad["unassigned"] = ["f"]
        with self.assertRaisesRegex(ValueError, "member_ids"):
            c.validate(bad, SECTIONS, {"pattern_old"})

    def test_pass_rule(self):
        sections = {**SECTIONS, "g": "patterns", "h": "patterns"}
        self.assertFalse(c.summarise(GOOD, sections)["passes"])
        self.assertEqual((c.PASS_COVERAGE, c.MAX_CANDIDATES, c.MIN_MEMBERS), (0.60, 25, 3))


if __name__ == "__main__":
    unittest.main()
