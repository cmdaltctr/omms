"""Prepare redacted pairs from synthetic profile copies only."""

import importlib.util
import json
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def module():
    path = Path(__file__).resolve().parents[1] / "03-pair-decisions-2026-10-10/prepare.py"
    assert path.exists(), "Profile preparation required"
    spec = importlib.util.spec_from_file_location("prepare_pairs", path)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


def test_copy_export_redacts_and_excludes_private_entries(tmp_path):
    source = tmp_path / "copy.db"
    entries = [
        {"category": "tools", "description": "Use a terminal <private>secret</private>", "centroid": [1, 0]},
        {"category": "tools", "description": "Prefer a terminal", "centroid": [0.7, 0.714142842854285]},
        {"category": "tools", "description": "<private>fully hidden</private>", "centroid": [1, 0]},
    ]
    with sqlite3.connect(source) as db:
        db.execute("CREATE TABLE user_profiles (id TEXT, profile_data TEXT, is_active INTEGER)")
        db.execute("INSERT INTO user_profiles VALUES (?, ?, 1)", ("synthetic", json.dumps({"preferences": entries, "patterns": [], "workflows": []})))
    result = module().prepare_copy(source, tmp_path, seed=42)
    assert result["counts"]["preferences"] == 3
    assert result["excluded_private"] == 1
    assert result["scanned"]["duplicate"] == 1
    assert result["scanned"]["conflict"] == 1
    review = json.loads((tmp_path / "blind-review.json").read_text())
    assert len(review) == 2
    assert all(row["outcome"] == "" and row["reason"] == "" for row in review)
    assert "secret" not in json.dumps(review)
    assert "cosine" not in json.dumps(review)


def test_conflicts_do_not_include_patterns():
    from pairs import generate
    entries = [{"id": str(i), "scope": "patterns", "category": "tools", "description": str(i), "centroid": [1, 0]} for i in range(2)]
    entries[1]["centroid"] = [0.7, 0.714142842854285]
    assert not any(pair["decision"] == "conflict" for pair in generate(entries))
