"""Enrich the pair corpus with likely positives for independent blind review.

The original stratified selection sampled the cosine range evenly, so the
development split held almost no likely duplicates and thresholds could not be
tuned against positive examples. This pass keeps every original pair and its
split unchanged, then adds each unused duplicate candidate at cosine 0.75 or
above. Groups that already appear in the original corpus keep their split; new
groups join the development split. The whole conflict band is already in the
corpus, so no fresh conflict pairs can exist; the script fails loudly if that
ever stops being true. No model call is made.
"""

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from checkpoint import atomic_json
from manifest import _validate_pairs, digest, file_digest
from pairs import blind_review, generate, group_pairs
from safety import output_path, require_redacted

ENRICHMENT_COSINE = 0.75
# Known-usage unit costs observed in the completed AI-reference pilot ledger.
DEEPSEEK_USD_PER_CALL = 0.156124500 / 580
JEV_USD_PER_CALL = 0.008690556 / 570


def _snapshot_unchanged(root):
    """Refuse enrichment when the copied snapshot no longer matches its pin."""
    value = json.loads((root / "corpus" / "manifest.json").read_text())
    pinned = value["files"]["source"]["sha256"]
    if file_digest(root / "corpus" / "snapshot.db") != pinned:
        raise ValueError("snapshot drift: copied database differs from manifest pin")
    return pinned


def _histogram(pairs):
    bands = {"0.50-0.65": lambda c: 0.5 <= c < 0.65, "0.65-0.75": lambda c: 0.65 <= c < 0.75,
             "0.75-0.85": lambda c: 0.75 <= c < 0.85, "0.85-1.00": lambda c: 0.85 <= c <= 1.0}
    return {name: sum(pair["decision"] == "duplicate" and test(pair["cosine"]) for pair in pairs)
            for name, test in bands.items()}


def planned_calls(pairs):
    """Count the hosted calls the reviewed runner would make per provider."""
    development = sum(pair["split"] == "development" for pair in pairs)
    test = sum(pair["split"] == "test" for pair in pairs)
    return {"deepseek": development * 4 + test * 2, "jev": development * 4 + test * 2,
            "estimated_known_usage_usd": round(development * 4 * DEEPSEEK_USD_PER_CALL + test * 2 * DEEPSEEK_USD_PER_CALL
                                               + development * 4 * JEV_USD_PER_CALL + test * 2 * JEV_USD_PER_CALL, 6)}


def build_manifest(original, enriched, metadata, root):
    """Freeze the v2 corpus pins while every inference approval stays withheld."""
    value = {key: original[key] for key in ("version", "source_commit", "reference_time", "split_seed",
                                            "snapshot", "requested_counts", "approved_gates")}
    value["files"] = {"corpus": {"path": "pairs-v2.json", "sha256": file_digest(root / "corpus" / "pairs-v2.json")},
                      "review": {"path": "blind-review-v2.json", "sha256": file_digest(root / "corpus" / "blind-review-v2.json")},
                      "source": original["files"]["source"]}
    value["pairs"] = enriched
    value["models"] = original["models"]
    value["settings"] = {}
    value["settings_sha256"] = digest(value["settings"])
    value["approvals"] = {"setup": original["approvals"].get("setup", {"approved": True}),
                          "snapshot": original["approvals"].get("snapshot", True),
                          "corpus_preparation": True,
                          "corpus_v2_enrichment": {"approved": True, "scope": metadata["enrichment_rule"]},
                          "reduced_pair_counts": original["approvals"].get("reduced_pair_counts", True),
                          "gates": True, "review": False, "calls": False, "transfer": {}, "spend_usd": None}
    value["estimated_cost_usd"] = metadata["planned_reviewed_run"]["estimated_known_usage_usd"]
    value["test_split_sha256"] = metadata["test_split_sha256"]
    value["phase"] = "AWAITING_BLIND_REVIEW"
    value["preparation"] = metadata
    return value


def enrich(old_pairs, candidates, *, threshold):
    """Keep original pairs and splits, adding high-similarity fresh duplicates."""
    old = {pair["id"]: pair for pair in old_pairs}
    grouped = {pair["id"]: pair for pair in group_pairs(candidates)}
    for pair in old_pairs:
        regenerated = grouped.get(pair["id"])
        if regenerated is None:
            raise ValueError("original pair missing from regenerated pool")
        for key in ("decision", "entries", "A", "B", "cosine", "group"):
            if regenerated[key] != pair[key]:
                raise ValueError(f"original pair changed: {key} differs for {pair['id']}")
    old_group_split = {pair["group"]: pair["split"] for pair in old_pairs}
    fresh_conflicts = [pair for pair in candidates if pair["decision"] == "conflict" and pair["id"] not in old]
    if fresh_conflicts:
        raise ValueError("fresh conflict candidates exist; the whole band must be reviewed before enrichment changes")
    added = {"inherited": 0, "new_group": 0}
    enriched = list(old_pairs)
    for pair in candidates:
        if pair["id"] in old or pair["decision"] != "duplicate" or pair["cosine"] < threshold:
            continue
        current = grouped[pair["id"]]
        split = old_group_split.get(current["group"], "development")
        added["inherited" if current["group"] in old_group_split else "new_group"] += 1
        enriched.append({**current, "split": split})
    enriched.sort(key=lambda pair: pair["id"])
    if any(pair["split"] != old[pair["id"]]["split"] for pair in enriched if pair["id"] in old):
        raise ValueError("original split assignment changed")
    _validate_pairs([{key: pair[key] for key in ("id", "split", "entries", "group")} for pair in enriched])
    return enriched, added


def main():
    default = Path(__file__).resolve().parent
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=default)
    parser.add_argument("--enrichment-cosine", type=float, default=ENRICHMENT_COSINE)
    args = parser.parse_args()
    root = args.root.absolute()
    try:
        from prepare import entries_from_snapshot
        snapshot_sha256 = _snapshot_unchanged(root)
        old_pairs = json.loads((root / "corpus" / "pairs.json").read_text())
        entries, counts, excluded_private = entries_from_snapshot(root / "corpus" / "snapshot.db", root)
        candidates = generate(entries)
        enriched, added = enrich(old_pairs, candidates, threshold=args.enrichment_cosine)
        for pair in enriched:
            require_redacted(pair["A"])
            require_redacted(pair["B"])
        atomic_json(root / "corpus" / "pairs-v2.json", root, enriched)
        atomic_json(root / "corpus" / "blind-review-v2.json", root, blind_review(enriched))
        old_ids = {pair["id"] for pair in old_pairs}
        metadata = {
            "corpus_sha256": file_digest(root / "corpus" / "pairs-v2.json"),
            "source_corpus_sha256": file_digest(root / "corpus" / "pairs.json"),
            "snapshot_sha256": snapshot_sha256,
            "phase": "AWAITING_BLIND_REVIEW", "model_calls": 0,
            "structural_gap": {
                "duplicate_pairs_at_or_above_0.90": sum(pair["decision"] == "duplicate" and pair["cosine"] >= 0.9 for pair in candidates),
                "fresh_conflict_pairs_available": sum(pair["decision"] == "conflict" and pair["id"] not in {item["id"] for item in old_pairs} for pair in candidates),
                "note": "Production deduplication and conflict merging already consumed near-identical entries, so the snapshot holds few clear duplicates and possibly no genuine contradictions; supplemental challenge cases need separate approval and stay outside this benchmark.",
            },
            "enrichment_rule": {"decision": "duplicate", "minimum_cosine": args.enrichment_cosine,
                                "new_groups_join": "development", "note": "production bands unchanged"},
            "excluded_private": excluded_private,
            "counts": counts,
            "counts": {"original": len(old_pairs), "added": len(enriched) - len(old_ids),
                       "total": len(enriched),
                       "added_by_assignment": added,
                       "selected": {decision: {split: sum(pair["decision"] == decision and pair["split"] == split
                                                          for pair in enriched)
                                               for split in ("development", "test")}
                                    for decision in ("duplicate", "conflict")}},
            "duplicate_histogram": {"original": _histogram(old_pairs), "enriched": _histogram(enriched)},
            "scanned": {decision: sum(pair["decision"] == decision for pair in candidates)
                        for decision in ("duplicate", "conflict")},
            "original_splits_preserved": True,
            "test_split_sha256": digest([pair for pair in enriched if pair["split"] == "test"]),
            "planned_reviewed_run": planned_calls(enriched),
        }
        atomic_json(root / "corpus" / "preparation-v2.json", root, metadata)
        original = json.loads((root / "corpus" / "manifest.json").read_text())
        manifest = build_manifest(original, enriched, metadata, root)
        atomic_json(root / "corpus" / "manifest-v2.json", root, manifest)
        result = {"candidate_preparation_v2": metadata, "comparison_verdict": "INCONCLUSIVE",
                  "model_calls": 0, "phase": "AWAITING_BLIND_REVIEW",
                  "reason": "Blind review pending; ground truth and run approvals incomplete."}
        atomic_json(root.parent / "output" / "preparation-v2-result.json", root.parent, result)
        print(json.dumps({"status": "prepared", "original": len(old_pairs), "added": len(enriched) - len(old_ids),
                          "total": len(enriched)}), flush=True)
    except (ValueError, KeyError, OSError, TypeError) as error:
        parser.exit(1, f"corpus v2 preparation failed: {error}\n")


if __name__ == "__main__":
    main()
