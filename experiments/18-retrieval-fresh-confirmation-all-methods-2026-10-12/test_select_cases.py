"""Selection tests: privacy exclusions, de-duplication, balance and determinism. Synthetic text only."""

import os
import types
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
s = types.ModuleType("experiment18_select")
s.__file__ = str(HERE / "select_cases.py")
source = Path(os.environ.get("EXPERIMENT18_SELECT_FAULT_COPY", s.__file__)).read_text()
exec(compile(source, s.__file__, "exec"), s.__dict__)

SECRETS = {
    "redaction": "Uses token sk-ant-abcdefghijklmnopqrstuv for the deploy",
    "private": "Keeps <private>my note</private> out of logs please",
    "email": "Sends reports to someone@example.com every Friday",
    "url": "Checks https://example.org/status before releasing",
    "home_path": "Keeps notes in /Users/someone/notes for reference",
    "ipv4": "Connects to 192.168.1.20 for the staging server",
    "long_token": "Pins revision a02f48bb4f057028298c21fa033da2b30d7742d5 always",
}


def entry(i, section, text):
    return {"id": f"id{i:04d}", "section": section, "description": text, "category": "x"}


class SelectTests(unittest.TestCase):

    def test_every_secret_kind_is_excluded(self):
        for kind, text in SECRETS.items():
            self.assertIsNotNone(s.exclusion_reason(text), kind)
        self.assertIsNone(s.exclusion_reason("Prefers short plain answers with numbered steps"))
        self.assertEqual(s.exclusion_reason("Too short"), "too_short")

    def test_selection_balance_dedupe_and_determinism(self):
        quota = {"preferences": 3, "patterns": 3}
        entries = [entry(i, "preferences" if i % 2 else "patterns", f"Safe observation number {i} about work")
                   for i in range(40)]
        entries.append(entry(98, "patterns", SECRETS["email"]))
        entries.append(entry(99, "patterns", "Gallery text that already exists here"))
        original = dict(s.PER_SECTION)
        s.PER_SECTION.clear()
        s.PER_SECTION.update(quota)
        try:
            chosen, counts = s.select(entries, {"id0000"}, ["gallery TEXT that already   exists here"])
            again, _ = s.select(entries, {"id0000"}, ["gallery TEXT that already   exists here"])
        finally:
            s.PER_SECTION.clear()
            s.PER_SECTION.update(original)
        self.assertEqual(chosen, again)
        self.assertEqual(sum(c["section"] == "preferences" for c in chosen), 3)
        self.assertEqual(sum(c["section"] == "patterns" for c in chosen), 3)
        self.assertNotIn("id0000", {c["id"] for c in chosen})
        self.assertTrue(all(s.exclusion_reason(c["description"]) is None for c in chosen))
        texts = [s.normalise(c["description"]) for c in chosen]
        self.assertEqual(len(texts), len(set(texts)))

    def _select_patterns(self, entries, quota, gallery_ids=frozenset(), gallery_texts=()):
        original = dict(s.PER_SECTION)
        s.PER_SECTION.clear()
        s.PER_SECTION.update({"patterns": quota})
        try:
            return s.select(entries, set(gallery_ids), list(gallery_texts))
        finally:
            s.PER_SECTION.clear()
            s.PER_SECTION.update(original)

    def test_duplicates_never_fill_the_quota(self):
        safe = [entry(i, "patterns", f"Safe pattern observation number {i}") for i in range(3)]
        dup = entry(9, "patterns", "Repeats   the GALLERY sentence exactly")
        with self.assertRaisesRegex(ValueError, "not_enough_patterns"):
            self._select_patterns(safe + [dup], 4, gallery_texts=["repeats the gallery sentence exactly"])
        twin = entry(8, "patterns", "Safe pattern observation number 0")
        with self.assertRaisesRegex(ValueError, "not_enough_patterns"):
            self._select_patterns(safe + [twin], 4)

    def test_gallery_ids_never_selected(self):
        safe = [entry(i, "patterns", f"Safe pattern observation number {i}") for i in range(3)]
        old = entry(7, "patterns", "An old case already used in the gallery")
        with self.assertRaisesRegex(ValueError, "not_enough_patterns"):
            self._select_patterns(safe + [old], 4, gallery_ids={"id0007"})

    def test_pins(self):
        with self.assertRaisesRegex(ValueError, "input_hash_drift"):
            s.load_pinned(s.ENTRIES, "0" * 64)


if __name__ == "__main__":
    unittest.main()
