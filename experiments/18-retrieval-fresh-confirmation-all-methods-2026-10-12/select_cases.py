"""Experiment 18: select 400 fresh, privacy-safe profile observations never used in earlier experiments."""

import hashlib
import importlib.util
import json
import os
import random
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
EXPERIMENTS = HERE.parent
CORPUS = HERE / "corpus"
OUT = HERE / "output"
ENTRIES = EXPERIMENTS / "01-label-decisions-2026-10-07/corpus/entries.json"
ENTRIES_SHA256 = "3bf06ac9b1c710bda1d65b695929a59371516ca459bcd88458f16beca05769d4"
GROUND_TRUTH = EXPERIMENTS / "01-label-decisions-2026-10-07/output/revision-01-batch8192/corpus/ground-truth.json"
GROUND_TRUTH_SHA256 = "8a4771923c458c45aff494839adf932eb42cdd72cf8bd452c44074bba7484f7c"
CATALOGUE = EXPERIMENTS / "01-label-decisions-2026-10-07/output/revision-01-batch8192/corpus/catalogue.json"
CATALOGUE_SHA256 = "3d9af990a51225037e5bca52bcaa28ca0d9486da7166a02d27cbb2366f0d52bc"
SAFETY = EXPERIMENTS / "safety.py"
SAFETY_SHA256 = "dd0629b8237eca6455fa580fb49f2815a9f7fbba802d8ebb7c8177d6b04c4628"
SEED = 20261012
PER_SECTION = {"preferences": 200, "patterns": 200}
MIN_LENGTH = 15
EXTRA_PATTERNS = {
    "email": r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}",
    "url": r"https?://|\bwww\.",
    "home_path": r"/Users/|/home/|[A-Za-z]:\\Users\\",
    "ipv4": r"\b(?:\d{1,3}\.){3}\d{1,3}\b",
    "long_token": r"[A-Fa-f0-9]{32,}|[A-Za-z0-9+/_-]{32,}",
}


def file_hash(path):
    with open(path, "rb") as handle:
        return hashlib.file_digest(handle, "sha256").hexdigest()


def require(condition, code):
    if not condition:
        raise ValueError(code)


def load_pinned(path, expected):
    require(file_hash(path) == expected, "input_hash_drift")
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def load_safety():
    require(file_hash(SAFETY) == SAFETY_SHA256, "input_hash_drift")
    spec = importlib.util.spec_from_file_location("experiments_safety_readonly", SAFETY)
    module = importlib.util.module_from_spec(spec)
    previous = sys.dont_write_bytecode
    sys.dont_write_bytecode = True
    try:
        spec.loader.exec_module(module)
    finally:
        sys.dont_write_bytecode = previous
    return module


safety = load_safety()


def normalise(text):
    return re.sub(r"\s+", " ", text.strip().lower())


def exclusion_reason(text):
    """The first rule an entry breaks, or None when it is safe to use."""
    if safety.redact(text) != text:
        return "redaction"
    for name, pattern in EXTRA_PATTERNS.items():
        if re.search(pattern, text):
            return name
    if len(text.strip()) < MIN_LENGTH:
        return "too_short"
    return None


def select(entries, gallery_ids, gallery_texts):
    seen = {normalise(t) for t in gallery_texts}
    counts = {}
    chosen = []
    for section, quota in PER_SECTION.items():
        pool = sorted((e for e in entries if e["section"] == section and e["id"] not in gallery_ids),
                      key=lambda e: e["id"])
        random.Random(SEED).shuffle(pool)
        taken = 0
        for entry in pool:
            if taken == quota:
                break
            reason = exclusion_reason(entry["description"])
            if reason is None and normalise(entry["description"]) in seen:
                reason = "duplicate"
            if reason:
                counts[reason] = counts.get(reason, 0) + 1
                continue
            seen.add(normalise(entry["description"]))
            chosen.append({"id": entry["id"], "section": section, "description": entry["description"]})
            taken += 1
        require(taken == quota, f"not_enough_{section}")
    return chosen, counts


def atomic_json(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    os.chmod(tmp, 0o600)
    os.replace(tmp, path)


def main():
    entries = load_pinned(ENTRIES, ENTRIES_SHA256)
    truth = load_pinned(GROUND_TRUTH, GROUND_TRUTH_SHA256)
    catalogue = load_pinned(CATALOGUE, CATALOGUE_SHA256)
    gallery_ids = {row["id"] for row in truth}
    chosen, counts = select(entries, gallery_ids, [row["description"] for row in truth])
    for item in chosen:
        require(exclusion_reason(item["description"]) is None, "privacy_gate")
    atomic_json(CORPUS / "fresh-cases.json", {"seed": SEED, "cases": chosen})
    atomic_json(CORPUS / "label-input.json", {
        "instruction": ("Pick the one label whose definition matches the observation's primary intent. "
                        "Respect each definition's exclusions. Answer none_fit when no label's intent matches. "
                        "Answer uncertain only when two labels fit equally."),
        "answer_format": {"id": "observation id", "label": "label id, none_fit or uncertain",
                          "new_label": "optional short name when none_fit", "note": "at most 200 characters"},
        "catalogue": [{k: l[k] for k in ("id", "section", "definition", "aliases")} for l in catalogue],
        "observations": chosen})
    atomic_json(OUT / "selection.json", {
        "pool": len([e for e in entries if e["id"] not in gallery_ids]), "selected": len(chosen),
        "per_section": {s: sum(1 for c in chosen if c["section"] == s) for s in PER_SECTION},
        "excluded_while_scanning": counts,
        "fresh_cases_sha256": file_hash(CORPUS / "fresh-cases.json"),
        "label_input_sha256": file_hash(CORPUS / "label-input.json")})
    print(f"Selected {len(chosen)}; excluded while scanning: {counts}", flush=True)


if __name__ == "__main__":
    main()
