"""Production-band candidate pairs and blinded review rows."""

import math
import random

from manifest import digest
from safety import require_redacted


def cosine(a, b):
    """Compare finite, equally sized stored centroids without model calls."""
    if not a or len(a) != len(b) or any(type(v) not in (float, int) or not math.isfinite(v) for v in [*a, *b]):
        raise ValueError("invalid centroid")
    norm = math.sqrt(sum(v * v for v in a)) * math.sqrt(sum(v * v for v in b))
    return sum(x * y for x, y in zip(a, b)) / norm if norm else 0.0


def generate(entries):
    """Generate candidates within one profile section and category."""
    if len({entry["id"] for entry in entries}) != len(entries):
        raise ValueError("duplicate entry ID")
    for entry in entries:
        require_redacted(entry["description"])
        require_redacted(entry.get("category") or "")
    result = []
    for index, a in enumerate(entries):
        for b in entries[index + 1:]:
            if a.get("scope") != b.get("scope") or (a.get("category") or "_uncategorized") != (b.get("category") or "_uncategorized"):
                continue
            if not a.get("centroid") or not b.get("centroid"):
                continue
            score = cosine(a["centroid"], b["centroid"])
            decisions = []
            if score >= 0.5:
                decisions.append("duplicate")
            if a.get("scope") == "preferences" and 0.65 <= score < 0.9 and a.get("category") == b.get("category"):
                decisions.append("conflict")
            for decision in decisions:
                result.append({"id": digest([decision, a["id"], b["id"]])[:24], "decision": decision, "entries": [a["id"], b["id"]], "A": a["description"], "B": b["description"], "cosine": score})
    return sorted(result, key=lambda pair: (-pair["cosine"], pair["id"]))


def group_pairs(pairs):
    """Join all pairs sharing any entry, across both decision types."""
    parent = {}

    def find(entry):
        parent.setdefault(entry, entry)
        while parent[entry] != entry:
            entry = parent[entry]
        return entry

    for pair in pairs:
        a, b = pair["entries"]
        parent[find(b)] = find(a)
    members = {}
    for entry in parent:
        members.setdefault(find(entry), []).append(entry)
    groups = {root: digest(sorted(entries))[:24] for root, entries in members.items()}
    return [{**pair, "group": groups[find(pair["entries"][0])]} for pair in pairs]


def split_pairs(pairs, *, seed, development_fraction):
    """Assign whole connected groups before any human labels or predictions."""
    groups = sorted({pair["group"] for pair in pairs})
    rng = random.Random(seed)
    rng.shuffle(groups)
    count = round(len(groups) * development_fraction)
    development = set(groups[:count])
    return [{**pair, "split": "development" if pair["group"] in development else "test"} for pair in pairs]


def blind_review(pairs):
    """Expose the descriptions and review fields, without model or vector data."""
    return [{"id": pair["id"], "decision": pair["decision"], "A": pair["A"], "B": pair["B"], "outcome": "", "reason": ""} for pair in sorted(pairs, key=lambda pair: pair["id"])]
