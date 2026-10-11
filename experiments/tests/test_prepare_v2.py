"""Verify corpus v2 enrichment keeps splits, groups and blindness intact."""

import importlib.util
import math
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pairs import blind_review, generate, group_pairs


def experiment(name):
    path = Path(__file__).resolve().parents[1] / "03-pair-decisions-2026-10-10" / name
    assert path.is_file(), f"{name} required"
    spec = importlib.util.spec_from_file_location(name.replace("-", "_"), path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def unit(degrees, size=4):
    """A deterministic centroid with a known cosine against the zero-degree axis."""
    radians = math.radians(degrees)
    return [math.cos(radians), math.sin(radians), 0.0, 0.0]


def entries():
    """Three same-scope clusters whose pair cosines fall in controlled bands.

    Cluster a: e0 0deg, e1 10deg, e2 60deg, e3 55deg. Pairs: (e0,e1) 0.985,
    (e2,e3) 0.996, (e1,e3) 0.707 duplicate-and-conflict, (e0,e2) 0.500.
    Cluster b: e6 0deg, e7 5deg. Pair (e6,e7) 0.996, fully disconnected.
    Cluster c: e8 0deg, e9 60deg, e10 55deg. Pairs: (e8,e9) 0.500,
    (e9,e10) 0.996, (e8,e10) 0.574.
    """
    plan = [("e0", "a", 0.0), ("e1", "a", 10.0), ("e2", "a", 60.0), ("e3", "a", 55.0),
            ("e6", "b", 0.0), ("e7", "b", 5.0),
            ("e8", "c", 0.0), ("e9", "c", 60.0), ("e10", "c", 55.0)]
    return [{"id": name, "scope": "preferences", "category": category,
             "description": f"Synthetic preference {name}", "centroid": unit(degrees)}
            for name, category, degrees in plan]


def corpus():
    """An old corpus of three pairs whose groups cover all inheritance cases."""
    grouped = {pair["id"]: pair for pair in group_pairs(generate(entries()))}
    by_entries = {frozenset(pair["entries"]): pair for pair in grouped.values()}
    old = [{**by_entries[frozenset(("e0", "e2"))], "split": "development"},
           {**by_entries[frozenset(("e8", "e9"))], "split": "test"},
           {**next(pair for pair in grouped.values() if pair["decision"] == "conflict"), "split": "development"}]
    return old, list(grouped.values())


def enriched():
    old, candidates = corpus()
    return experiment("prepare_v2.py").enrich(old, candidates, threshold=0.75)


def test_enrichment_adds_only_fresh_high_cosine_duplicates():
    old, _ = corpus()
    pairs, added = enriched()
    original = {pair["id"]: pair for pair in old}
    fresh = [pair for pair in pairs if pair["id"] not in original]
    assert added == {"inherited": 3, "new_group": 1}
    assert len(fresh) == 4
    assert {frozenset(pair["entries"]) for pair in fresh} == {frozenset(("e0", "e1")), frozenset(("e2", "e3")), frozenset(("e6", "e7")), frozenset(("e9", "e10"))}
    assert all(pair["decision"] == "duplicate" and pair["cosine"] >= 0.75 for pair in fresh)
    for pair in pairs:
        if pair["id"] in original:
            assert pair == original[pair["id"]]
    assert all(pair["id"] in {item["id"] for item in pairs} for pair in old)


def test_inherited_groups_keep_split_and_new_groups_join_development():
    pairs, _ = enriched()
    split = {frozenset(pair["entries"]): pair["split"] for pair in pairs if pair["decision"] == "duplicate"}
    assert split[frozenset(("e0", "e1"))] == "development"  # cluster a is a development group
    assert split[frozenset(("e2", "e3"))] == "development"  # same cluster a group
    assert split[frozenset(("e9", "e10"))] == "test"  # cluster c is a test group
    assert split[frozenset(("e6", "e7"))] == "development"  # disconnected cluster b joins development


def test_original_pair_changes_are_refused():
    old, candidates = corpus()
    for key, value in (("cosine", old[0]["cosine"] + 0.01), ("group", "tampered"),
                       ("A", old[0]["A"] + "!"), ("decision", "conflict")):
        with pytest.raises(ValueError, match="changed"):
            experiment("prepare_v2.py").enrich([{**old[0], key: value, "split": "development"}] + old[1:],
                                               candidates, threshold=0.75)


def test_missing_original_pair_is_refused():
    old, candidates = corpus()
    with pytest.raises(ValueError, match="missing"):
        experiment("prepare_v2.py").enrich(old[:1] + [{"id": "absent", "decision": "duplicate",
                                                       "entries": ["x", "y"], "A": "a", "B": "b",
                                                       "cosine": 0.5, "group": "g", "split": "test"}],
                                           candidates, threshold=0.75)


def test_fresh_conflict_candidates_fail_loudly():
    old, candidates = corpus()
    without_conflicts = [pair for pair in old if pair["decision"] != "conflict"]
    with pytest.raises(ValueError, match="fresh conflict"):
        experiment("prepare_v2.py").enrich(without_conflicts, candidates, threshold=0.75)


def test_blind_file_hides_scores_groups_and_splits():
    pairs, _ = enriched()
    review = blind_review(pairs)
    assert review and all(set(record) == {"id", "decision", "A", "B", "outcome", "reason"} for record in review)
    assert all(record["outcome"] == "" and record["reason"] == "" for record in review)


def test_snapshot_drift_is_refused(tmp_path):
    import json
    root = tmp_path / "experiment"
    (root / "corpus").mkdir(parents=True)
    (root / "corpus" / "snapshot.db").write_bytes(b"not the pinned database")
    (root / "corpus" / "manifest.json").write_text(json.dumps(
        {"files": {"source": {"path": "snapshot.db", "sha256": "0" * 64}}}))
    with pytest.raises(ValueError, match="drift"):
        experiment("prepare_v2.py")._snapshot_unchanged(root)


def test_planned_calls_scale_with_split_sizes():
    pairs = [{"split": "development"}] * 141 + [{"split": "test"}] * 141
    plan = experiment("prepare_v2.py").planned_calls(pairs)
    assert plan["deepseek"] == 141 * 4 + 141 * 2
    assert plan["jev"] == 141 * 4 + 141 * 2
    assert 0 < plan["estimated_known_usage_usd"] < 1


def test_build_manifest_withholds_every_inference_approval(tmp_path):
    import json
    pairs, _ = enriched()
    (tmp_path / "corpus").mkdir()
    (tmp_path / "corpus" / "pairs-v2.json").write_text(json.dumps(pairs))
    (tmp_path / "corpus" / "blind-review-v2.json").write_text(json.dumps(blind_review(pairs)))
    original = {"version": 1, "source_commit": "0" * 40, "reference_time": "2026-10-10T01:11:58+00:00",
                "split_seed": 42, "snapshot": {}, "requested_counts": {}, "approved_gates": {"speedup_factor": 5},
                "files": {"source": {"path": "snapshot.db", "sha256": "s" * 64}},
                "models": {"P1": {"status": "ready", "provider": "deepseek", "model": "deepseek-flash", "parameters": {}}},
                "approvals": {"gates": True}}
    metadata = {"enrichment_rule": {"minimum_cosine": 0.75}, "test_split_sha256": "t" * 64,
                "planned_reviewed_run": {"estimated_known_usage_usd": 0.24}}
    value = experiment("prepare_v2.py").build_manifest(original, pairs, metadata, tmp_path)
    assert value["files"]["corpus"]["path"] == "pairs-v2.json"
    assert value["pairs"] == pairs
    approvals = value["approvals"]
    assert approvals["review"] is False and approvals["calls"] is False
    assert approvals["transfer"] == {} and approvals["spend_usd"] is None
    assert value["phase"] == "AWAITING_BLIND_REVIEW"
