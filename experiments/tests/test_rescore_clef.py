"""Check the unfrozen Clef cut-off table with synthetic records."""

import importlib.util
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def module():
    path = Path(__file__).resolve().parents[1] / "03-pair-decisions-2026-10-10/rescore_clef.py"
    spec = importlib.util.spec_from_file_location("rescore_clef", path)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


PAIRS = [{"id": key, "split": "test", "decision": "duplicate"} for key in ("a", "b", "c", "d")]
REFERENCE = {"a": {"outcome": "same"}, "b": {"outcome": "different"}, "c": {"outcome": "uncertain"}, "d": {"outcome": "same"}}
RECORDS = {"a/P6-clef/1/0": {"status": "ok", "probability": 0.92}, "b/P6-clef/1/0": {"status": "ok", "probability": 0.7},
           "c/P6-clef/1/0": {"status": "ok", "probability": 0.96}, "d/P6-clef/1/0": {"status": "error"},
           "a/P6-clef/1/1": {"status": "ok", "probability": 0.1}}


def test_counts_use_original_order_and_split_wrong_from_uncertain():
    count, found, table = module().rows(PAIRS, REFERENCE, RECORDS, "test", "duplicate")
    by_cutoff = {row["cutoff"]: row for row in table}
    assert (count, found) == (4, 2)
    assert by_cutoff[0.65] == {"cutoff": 0.65, "yes": 3, "right": 1, "wrong": 1, "uncertain": 1, "missed": 1}
    assert by_cutoff[0.9] == {"cutoff": 0.9, "yes": 2, "right": 1, "wrong": 0, "uncertain": 1, "missed": 1}
    assert by_cutoff[0.99]["yes"] == 0 and by_cutoff[0.99]["missed"] == 2


def test_section_is_marked_unfrozen_and_rerun_replaces_it():
    rescore = module()
    report = "# Report\n\nbody\n"
    once = rescore.append(report, rescore.MARKER + "\n\nfirst\n")
    twice = rescore.append(once, rescore.MARKER + "\n\nsecond\n")
    assert twice.count(rescore.MARKER) == 1 and "first" not in twice and twice.startswith("# Report\n\nbody")
    assert "not frozen" in rescore.MARKER.lower()
