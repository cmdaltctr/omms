"""Prepare an approved read-only profile copy for independent AI annotation."""

import argparse
import json
import os
import random
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from checkpoint import atomic_json
from manifest import digest, file_digest
from safety import output_path, redact, snapshot


def export(source, root):
    """Export redacted preferences and patterns without identity fields."""
    secrets = tuple(v for k, v in os.environ.items()
                    if any(w in k.upper() for w in ("API_KEY", "TOKEN", "SECRET", "PASSWORD")) and len(v) >= 8)
    with sqlite3.connect(source.as_uri() + "?mode=ro&immutable=1", uri=True) as db:
        rows = db.execute("SELECT profile_data FROM user_profiles WHERE is_active = 1").fetchall()
    if len(rows) != 1:
        raise ValueError("exactly one active profile required")
    profile = json.loads(rows[0][0])
    entries = []
    for section in ("preferences", "patterns"):
        for i, item in enumerate(profile.get(section, [])):
            text = redact(item["description"], secrets=secrets).strip()
            if not text.replace("[REDACTED]", "").strip():
                continue
            entries.append({"id": digest([section, i, text])[:24], "section": section,
                            "category": redact(item.get("category", ""), secrets=secrets),
                            "description": text})
    atomic_json(root / "corpus/entries.json", root, entries)
    rng = random.Random(20261007)
    selected = []
    for section in ("preferences", "patterns"):
        pool = [e for e in entries if e["section"] == section]
        if len(pool) < 100:
            raise ValueError("insufficient observations")
        selected.extend(rng.sample(pool, 100))
    atomic_json(root / "corpus/annotation-input.json", root, selected)
    atomic_json(root / "corpus/source-provenance.json", root,
                {"snapshot_sha256": file_digest(source), "counts": {s: len(profile.get(s, []))
                 for s in ("preferences", "patterns")}, "seed": 20261007,
                 "annotation": "AI draft required before inference", "human_reviewed": False})
    return len(selected)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--snapshot-approved", action="store_true", required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parent
    target = output_path(root / "corpus/snapshot.db", root)
    snapshot(args.source, target, root, approved=args.snapshot_approved)
    print(json.dumps({"selected": export(target, root), "model_calls": 0}), flush=True)
