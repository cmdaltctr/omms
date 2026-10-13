"""Experiment 19: validate the candidate labels and write counts only (no observation text)."""

import hashlib
import json
import os
from pathlib import Path

HERE = Path(__file__).resolve().parent
SOURCE = HERE.parent / "18-retrieval-fresh-confirmation-all-methods-2026-10-12/corpus"
PINS = {
    "fresh-reference.json": "906eb69719c245d7727e58ac7fa858f9bf3f083979e9c0c3a06c57d5d3749925",
    "fresh-cases.json": "7d89a84610b5cd9b6ccc24b149c81a2a4e7cc6d9bc8c1b6b6b8d03def391e940",
    "label-input.json": "a2b8f496fdc4c98c8ffcfeb4bb97a76a9572761c3e3e1b9f4a854bb0c670e96b",
}
MIN_MEMBERS = 3
PASS_COVERAGE = 0.60
MAX_CANDIDATES = 25


def require(condition, code):
    if not condition:
        raise ValueError(code)


def read(path):
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def file_hash(path):
    with open(path, "rb") as handle:
        return hashlib.file_digest(handle, "sha256").hexdigest()


def none_fit_sections():
    for name, expected in PINS.items():
        require(file_hash(SOURCE / name) == expected, "input_hash_drift")
    reference = read(SOURCE / "fresh-reference.json")["decisions"]
    cases = {c["id"]: c for c in read(SOURCE / "fresh-cases.json")["cases"]}
    existing = {l["id"] for l in read(SOURCE / "label-input.json")["catalogue"]}
    return {k: cases[k]["section"] for k, v in reference.items() if v["label"] == "none_fit"}, existing


def validate(payload, sections, existing):
    seen = set()
    ids = set()
    for cand in payload["candidates"]:
        require(cand["id"] not in ids and cand["id"] not in existing, "candidate_id")
        ids.add(cand["id"])
        prefix = "preference_" if cand["section"] == "preferences" else "pattern_"
        require(cand["section"] in ("preferences", "patterns") and cand["id"].startswith(prefix), "candidate_section")
        require(len(cand["members"]) >= MIN_MEMBERS, "group_too_small")
        require(cand["definition"].strip() and "xclude" in cand["definition"], "definition_needs_exclusion")
        for member in cand["members"]:
            require(member in sections and member not in seen, "member_ids")
            require(sections[member] == cand["section"], "member_section")
            seen.add(member)
    for member in payload["unassigned"]:
        require(member in sections and member not in seen, "member_ids")
        seen.add(member)
    require(seen == set(sections), "coverage")


def summarise(payload, sections):
    covered = sum(len(c["members"]) for c in payload["candidates"])
    return {
        "observations": len(sections), "covered": covered, "coverage": covered / len(sections),
        "candidates": len(payload["candidates"]),
        "per_section": {s: sum(1 for c in payload["candidates"] if c["section"] == s) for s in ("preferences", "patterns")},
        "unassigned": len(payload["unassigned"]),
        "passes": covered / len(sections) >= PASS_COVERAGE and len(payload["candidates"]) <= MAX_CANDIDATES,
        "labels": [{"id": c["id"], "section": c["section"], "members": len(c["members"]),
                    "nearest_existing_label": c.get("nearest_existing_label"), "definition": c["definition"],
                    "aliases": c.get("aliases", [])}
                   for c in sorted(payload["candidates"], key=lambda c: (c["section"], -len(c["members"]), c["id"]))],
    }


def main():
    sections, existing = none_fit_sections()
    payload = read(HERE / "corpus/catalogue-v2-candidates.json")
    validate(payload, sections, existing)
    summary = summarise(payload, sections)
    out = HERE / "output/summary.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.with_suffix(".tmp")
    tmp.write_text(json.dumps(summary, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    os.replace(tmp, out)
    print(json.dumps({k: summary[k] for k in ("observations", "covered", "coverage", "candidates",
                                              "per_section", "unassigned", "passes")}), flush=True)


if __name__ == "__main__":
    main()
