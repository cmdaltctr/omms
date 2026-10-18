"""Tests for the pure parts of run.py. Run: python3 -m unittest experiments/27-.../test_run.py"""

import sqlite3
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import run  # noqa: E402


class KeywordQuery(unittest.TestCase):
    # Cases copied from tests/keyword-search-pure.test.ts: gate G3.
    def test_splits_identifier(self):
        self.assertEqual(run.build_keyword_query("why did we write ADR-023"), '"write" OR "adr" OR "023"')

    def test_drops_short_words(self):
        self.assertEqual(run.build_keyword_query("a b c deploy x"), '"deploy"')

    def test_removes_repeats(self):
        self.assertEqual(run.build_keyword_query("deploy Deploy DEPLOY"), '"deploy"')

    def test_none_when_nothing_left(self):
        for text in ("", None, "a - ? !! the of"):
            self.assertIsNone(run.build_keyword_query(text))

    def test_syntax_characters_become_quoted_terms(self):
        query = run.build_keyword_query('"deploy" * (NEAR AND OR NOT) title:secret')
        for part in query.split(" OR "):
            self.assertRegex(part, r'^"[^\W_]+"$')

    def test_caps_terms(self):
        query = run.build_keyword_query(" ".join(f"word{i}" for i in range(60)))
        self.assertEqual(len(query.split(" OR ")), 24)

    def test_index_accepts_every_query(self):
        con = sqlite3.connect(":memory:")
        con.execute("CREATE VIRTUAL TABLE fts USING fts5(content, tags, tokenize='unicode61')")
        con.execute("INSERT INTO fts(rowid, content, tags) VALUES (1, 'ADR-023 sets the release flow', '')")
        for text in ('"', "*", "(", "AND", "NEAR", 'NEAR("a" "b") AND * (', "adr 023"):
            match = run.build_keyword_query(text)
            if match:
                con.execute("SELECT rowid FROM fts WHERE fts MATCH ?", (match,)).fetchall()
        self.assertEqual(con.execute("SELECT rowid FROM fts WHERE fts MATCH ?", (run.build_keyword_query("adr 023"),)).fetchall(), [(1,)])


class Boost(unittest.TestCase):
    def test_share_of_best(self):
        self.assertAlmostEqual(run.apply_boost(0.5, 2, 4, 0.2), 0.6)
        self.assertAlmostEqual(run.apply_boost(0.5, 4, 4, 0.2), 0.7)

    def test_no_change(self):
        self.assertEqual(run.apply_boost(0.5, 4, 4, 0), 0.5)
        self.assertEqual(run.apply_boost(0.5, 0, 4, 0.3), 0.5)

    def test_caps(self):
        self.assertEqual(run.apply_boost(0.95, 4, 4, 0.5), 1.0)
        self.assertAlmostEqual(run.apply_boost(0.1, 9, 3, 0.2), 0.3)


class Rrf(unittest.TestCase):
    def test_item_in_both_lists_wins(self):
        self.assertEqual(run.rrf_rank(["a", "b", "c"], ["c", "x"], top=2), ["c", "a"])

    def test_keyword_only_item_can_enter(self):
        self.assertIn("k", run.rrf_rank(["a"], ["k"], top=2))

    def test_score_values(self):
        # Rank 1 in both lists: 2 / 61. Rank 1 in one list only: 1 / 61.
        self.assertEqual(run.rrf_rank(["a", "b"], ["a"], top=1), ["a"])

    def test_ties_break_by_id_and_top_limits(self):
        self.assertEqual(run.rrf_rank(["b"], ["a"], top=1), ["a"])
        self.assertEqual(len(run.rrf_rank([str(i) for i in range(30)], [], top=10)), 10)

    def test_empty(self):
        self.assertEqual(run.rrf_rank([], []), [])


class Labels(unittest.TestCase):
    def test_missing_pairs_are_reported_not_raised(self):
        arms = {"p1": {"A": ["m1"], "B": ["m1", "m2"], "C": ["m3"]}}
        labels = {("p1", "m1"): 1, ("p1", "m3"): 0}
        self.assertEqual(run.missing_pairs(arms, labels), [("p1", "m2")])

    def test_no_missing_pairs(self):
        arms = {"p1": {"A": ["m1"], "B": ["m1"], "C": ["m1"]}}
        self.assertEqual(run.missing_pairs(arms, {("p1", "m1"): 1}), [])

    def test_ai_only_labels_do_not_read_the_merged_file(self):
        names = run.OLD_LABEL_GLOB
        self.assertEqual(names, "judge_labels_v2_part*.jsonl")


class Summary(unittest.TestCase):
    def test_recall_noise_and_wins(self):
        arms = {"p1": {"A": ["m1"], "B": ["m1", "m2"], "C": ["m3"]},
                "p2": {"A": [], "B": [], "C": []}}
        relevant = {("p1", "m1"), ("p1", "m2")}
        result = run.summarise_arms(arms, lambda p, m: (p, m) in relevant)
        self.assertEqual(result["prompts_with_relevant"], 1)
        self.assertEqual(result["arms"]["A"]["recall"], 0.5)
        self.assertEqual(result["arms"]["B"]["recall"], 1.0)
        self.assertEqual(result["arms"]["C"]["recall"], 0.0)
        self.assertEqual(result["arms"]["C"]["noise_per_prompt"], 0.5)
        self.assertEqual(result["arms"]["A"]["empty_prompts"], 1)
        self.assertEqual((result["B_vs_A"]["wins"], result["B_vs_A"]["losses"]), (1, 0))
        self.assertEqual((result["C_vs_B"]["wins"], result["C_vs_B"]["losses"]), (0, 1))


if __name__ == "__main__":
    unittest.main()
