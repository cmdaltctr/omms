"""Export redacted candidate pairs from an approved local snapshot."""

import json
import os
import random
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from checkpoint import atomic_json
from manifest import digest, file_digest
from pairs import blind_review, generate, group_pairs, split_pairs
from safety import output_path, redact


def entries_from_snapshot(source, root):
    """Read only the copied active profile, retaining no identity fields.

    Returns the redacted entries, the raw section counts and how many items
    were fully private.
    """
    source = output_path(source, root)
    secrets = tuple(value for key, value in os.environ.items()
                    if any(word in key.upper() for word in ("API_KEY", "TOKEN", "SECRET", "PASSWORD")) and len(value) >= 8)
    entries = []
    counts = {scope: 0 for scope in ("preferences", "patterns", "workflows")}
    excluded_private = 0
    with sqlite3.connect(source.as_uri() + "?mode=ro&immutable=1", uri=True) as db:
        rows = db.execute("SELECT id, profile_data FROM user_profiles WHERE is_active = 1").fetchall()
    if len(rows) != 1:
        raise ValueError("exactly one active profile required")
    profile_id, raw = rows[0]
    profile = json.loads(raw)
    for scope in counts:
        items = profile.get(scope, [])
        if not isinstance(items, list):
            raise ValueError("profile section must be an array")
        counts[scope] = len(items)
        for index, item in enumerate(items):
            description = redact(item["description"], secrets=secrets).strip()
            if not description.replace("[REDACTED]", "").strip():
                excluded_private += 1
                continue
            entries.append({"id": digest([profile_id, scope, index])[:24],
                            "scope": scope,
                            "category": redact(item.get("category") or "", secrets=secrets),
                            "description": description,
                            "centroid": item.get("centroid")})
    return entries, counts, excluded_private


def prepare_copy(source, root, *, seed):
    """Redact and count the copied profile, then export candidate pairs."""
    entries, counts, excluded_private = entries_from_snapshot(source, root)
    candidates = generate(entries)
    scanned = {decision: sum(pair["decision"] == decision for pair in candidates)
               for decision in ("duplicate", "conflict")}
    # Whole groups are assigned before sampling, so shared entries never leak.
    assigned = split_pairs(group_pairs(candidates), seed=seed, development_fraction=0.3)
    selected = []
    rng = random.Random(seed)
    for decision, dev_count, test_count in (("duplicate", 60, 140), ("conflict", 45, 105)):
        for split, count in (("development", dev_count), ("test", test_count)):
            available = sorted([pair for pair in assigned if pair["decision"] == decision and pair["split"] == split], key=lambda pair: pair["cosine"])
            # Stratify across the similarity range without using labels.
            if len(available) > count:
                available = [rng.choice(available[i*len(available)//count:(i+1)*len(available)//count]) for i in range(count)]
            selected.extend(available)
    selected.sort(key=lambda pair: pair["id"])
    atomic_json(root / "pairs.json", root, selected)
    atomic_json(root / "blind-review.json", root, blind_review(selected))
    metadata = {"counts": counts, "excluded_private": excluded_private,
                "missing_centroids": sum(not entry["centroid"] for entry in entries),
                "scanned": scanned, "selected": {
                    decision: {split: sum(pair["decision"] == decision and pair["split"] == split for pair in selected)
                               for split in ("development", "test")}
                    for decision in ("duplicate", "conflict")},
                "split_seed": seed, "test_split_sha256": digest([pair for pair in selected if pair["split"] == "test"]),
                "corpus_sha256": file_digest(root / "pairs.json"),
                "phase": "AWAITING_BLIND_REVIEW", "model_calls": 0}
    atomic_json(root / "preparation.json", root, metadata)
    return metadata
