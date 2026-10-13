"""Check production pair bands and blind review output."""

import importlib
import math
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def module():
    assert (Path(__file__).resolve().parents[1] / "pairs.py").is_file(), "Pair generator required"
    return importlib.import_module("pairs")


def entries(cosine, category="synthetic"):
    return [
        {"id": "a", "category": category, "description": "First synthetic preference", "centroid": [1.0, 0.0], "scope": "preferences"},
        {"id": "b", "category": category, "description": "Second synthetic preference", "centroid": [cosine, math.sqrt(1 - cosine * cosine)], "scope": "preferences"},
    ]


@pytest.mark.parametrize("cosine,duplicate,conflict", [(0.4999, False, False), (0.5, True, False), (0.6499, True, False), (0.65, True, True), (0.8999, True, True), (0.9, True, False), (1.0, True, False)])
def test_production_band_edges(cosine, duplicate, conflict):
    pairs = module().generate(entries(cosine))
    assert any(pair["decision"] == "duplicate" for pair in pairs) is duplicate
    assert any(pair["decision"] == "conflict" for pair in pairs) is conflict


def test_cross_category_scope_and_missing_vectors_excluded():
    items = entries(0.7)
    items[1]["category"] = "other"
    assert module().generate(items) == []
    items[1]["category"] = "synthetic"
    items[1]["scope"] = "patterns"
    assert module().generate(items) == []
    items[1]["scope"] = "preferences"
    items[1].pop("centroid")
    assert module().generate(items) == []


def test_shared_entries_form_one_group_and_never_leak():
    items = entries(0.7)
    items.append({**items[1], "id": "c", "description": "Third synthetic preference"})
    pairs = module().group_pairs(module().generate(items))
    assert len({pair["group"] for pair in pairs}) == 1
    selected = module().split_pairs(pairs, seed=42, development_fraction=0.3)
    assignments = {}
    for pair in selected:
        for entry in pair["entries"]:
            assignments.setdefault(entry, set()).add(pair["split"])
    assert all(len(splits) == 1 for splits in assignments.values())


def test_review_hides_similarity_scores_ids_and_models():
    pairs = module().generate(entries(0.7))
    rows = module().blind_review(pairs)
    assert len(rows) == 2
    assert all(set(row) == {"id", "decision", "A", "B", "outcome", "reason"} for row in rows)
    assert all(row["outcome"] == "" and row["reason"] == "" for row in rows)
    assert all(row["A"] == "First synthetic preference" for row in rows)


def test_invalid_vectors_and_unredacted_input_refused():
    items = entries(0.7)
    items[0]["centroid"] = [float("nan"), 0.0]
    with pytest.raises(ValueError):
        module().generate(items)
    items = entries(0.7)
    items[0]["description"] = "<private>secret</private>"
    with pytest.raises(ValueError, match="redaction"):
        module().generate(items)
