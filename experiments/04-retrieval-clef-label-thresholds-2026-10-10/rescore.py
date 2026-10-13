"""Rescore pinned Clef answers locally without importing inference code."""

import argparse
import hashlib
import json
import math
import os
from pathlib import Path

HERE = Path(__file__).resolve().parent
SOURCE = HERE.parent / "01-label-decisions-2026-10-07/output/revision-01-batch8192"
GRID = (0, 0.5, 0.65, 0.8, 0.9, 0.95, 0.99, 1)
MIN_CORRECT = 19
MANIFEST_DIGEST = "2c36194f63fd87cd9147701ac6b93c027bc59ff8b96d4a011aefa65ceb61cb44"
PINS = {
    "output/eval_results.json": "39ce9b53cf63ccaba9e93fad6355571de704a60a46e800ef4d417115baa35ebe",
    "corpus/ground-truth.json": "8a4771923c458c45aff494839adf932eb42cdd72cf8bd452c44074bba7484f7c",
    "corpus/test-manifest.json": "9572035106415d4c60d608c7948185fa08b030c18c79fa386f53f2935b8bbefd",
    "corpus/ai-reference-provenance.json": "acf37b8e8f460433e956b301d5363e2609d9dc627aec03189a9a816d43584f80",
    "preserved-files.json": "602d6bba39b07c2fc67f63d30227d688c6bd7b441a22f50f0dafbcbeae795649",
}


def require(condition, message):
    """Stop on an invalid input instead of excluding a case."""
    if not condition:
        raise ValueError(message)


def digest(value):
    """Hash canonical JSON, independently of file formatting."""
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"),
                                     allow_nan=False).encode()).hexdigest()


def file_digest(path):
    """Hash file bytes without writing to the source."""
    return hashlib.sha256(path.read_bytes()).hexdigest()


def checked_path(root, relative):
    """Keep pinned files and outputs inside their declared root without symlinks."""
    path = root / relative
    require(path.is_relative_to(root) and ".." not in path.parts, "Unsafe path")
    require(not any(p.is_symlink() for p in (path, *path.parents)), "Symlink refused")
    return path


def read_json(path):
    """Reject duplicate JSON keys and non-finite JSON constants."""
    def pairs(entries):
        result = {}
        for key, value in entries:
            require(key not in result, "Duplicate JSON key")
            result[key] = value
        return result

    def invalid_constant(value):
        raise ValueError("Non-finite JSON constant")

    return json.loads(path.read_text(), object_pairs_hook=pairs,
                      parse_constant=invalid_constant)


def verify_preservation(source):
    """Check all original files named by the saved preservation manifest."""
    pins = read_json(checked_path(source, "preserved-files.json"))
    experiments = source.parents[2]
    require(bool(pins), "Empty preservation manifest")
    for name, expected in pins.items():
        require(file_digest(checked_path(experiments, name)) == expected,
                "Preserved file hash mismatch")
    return len(pins)


def validate_records(records, references, candidates):
    """Validate the complete pinned test selection and chosen probabilities."""
    refs = {}
    for reference in references:
        require(reference["id"] not in refs, "Duplicate reference ID")
        refs[reference["id"]] = reference
    refs = {key: value for key, value in refs.items() if value["split"] == "test"}
    require(len(refs) == 140, "Expected 140 test references")
    require(sum(r["expected"] == ["none_fit"] for r in refs.values()) == 86,
            "Reference composition changed")
    items = {}
    for key, row in records.items():
        if (row.get("arm"), row.get("split"), row.get("order")) != ("L3-clef", "test", 0):
            continue
        case_id = row["case_id"]
        require(case_id not in items, "Duplicate selected case")
        require(key == f"{case_id}/L3-clef/0", "Record key mismatch")
        require(case_id in refs and row["status"] == "ok", "Missing reference or failed record")
        require(row["score_kind"] == "native_choice_probability", "Wrong score kind")
        probabilities = row["probabilities"]
        options = candidates[case_id]["ids"]
        require(len(options) == len(set(options)) == 17 and "none_fit" in options,
                "Incomplete candidate choices")
        require(set(probabilities) == set(options) and row["answer"] in probabilities,
                "Incomplete probability distribution")
        require(all(type(p) in (int, float) and math.isfinite(p) and 0 <= p <= 1
                    for p in probabilities.values()), "Invalid probability")
        require(math.isclose(sum(probabilities.values()), 1, rel_tol=0, abs_tol=1e-6),
                "Probabilities do not sum to one")
        require(type(row["score"]) in (int, float) and
                row["score"] == probabilities[row["answer"]], "Chosen probability mismatch")
        expected = refs[case_id]["expected"]
        require(bool(expected) and (expected == ["none_fit"] or "none_fit" not in expected),
                "Invalid reference outcome")
        items[case_id] = {"case_id": case_id, "answer": row["answer"],
                          "score": row["score"], "correct": row["answer"] in expected}
    require(set(items) == set(refs), "Missing or extra selected cases")
    return [items[key] for key in sorted(items)]


def load_inputs(source, pins, expected_manifest):
    """Load only authenticated files and retain provenance for resume checks."""
    for name, expected in pins.items():
        require(file_digest(checked_path(source, name)) == expected, "Input hash mismatch")
    manifest = read_json(checked_path(source, "corpus/test-manifest.json"))
    results = read_json(checked_path(source, "output/eval_results.json"))
    require(digest(manifest) == expected_manifest == results["test_manifest_sha256"],
            "Manifest digest mismatch")
    require(manifest["test_frozen"] and manifest["source_commit"] == "d22b578",
            "Source manifest changed")
    provenance = read_json(checked_path(source, "corpus/ai-reference-provenance.json"))
    require(all(x["human_reviewed"] is False for x in (manifest, results, provenance)),
            "Reference provenance changed")
    for name in ("reference", "candidates", "provenance"):
        pin = manifest["files"][name]
        require(file_digest(checked_path(source, pin["path"])) == pin["sha256"],
                "Manifest input hash mismatch")
    candidates = read_json(checked_path(source, manifest["files"]["candidates"]["path"]))
    references = read_json(checked_path(source, "corpus/ground-truth.json"))
    items = validate_records(results["records"], references, candidates)
    counts = score_cell(items, 0)["counts"]
    require(counts == {"N": 140, "A": 140, "E": 107, "W": 69, "C": 38,
                       "F": 30, "B": 0, "accepted_none_fit": 33, "raw_correct": 68},
            "Baseline counts changed")
    metadata = {"experiment_id": HERE.name, "input_sha256": pins,
                "manifest_digest": expected_manifest, "source_commit": "d22b578",
                "rescore_sha256": file_digest(Path(__file__)), "human_reviewed": False,
                "settings": {"grid": list(GRID), "min_correct": MIN_CORRECT,
                             "wrong_reuse_limit": 0.02, "comparison": "score >= threshold"},
                "preserved_files": verify_preservation(source)}
    return items, metadata


def score_cell(items, threshold):
    """Keep saved correctness separate from automatic routing and review."""
    rows = []
    for item in items:
        accepted = item["score"] >= threshold
        route = ("NONE_FIT" if item["answer"] == "none_fit" else "EXISTING") if accepted else "REVIEW"
        rows.append({**item, "route": route, "automatic_correct": accepted and item["correct"]})
    n = len(rows)
    a = sum(r["route"] != "REVIEW" for r in rows)
    e = sum(r["route"] == "EXISTING" for r in rows)
    c = sum(r["route"] == "EXISTING" and r["correct"] for r in rows)
    f = sum(r["route"] == "NONE_FIT" and r["correct"] for r in rows)
    raw = sum(r["correct"] for r in rows)
    counts = {"N": n, "A": a, "E": e, "W": e-c, "C": c, "F": f, "B": n-a,
              "accepted_none_fit": a-e, "raw_correct": raw}
    def rate(value, total):
        return value / total if total else None
    rates = {"wrong_reuse": rate(e-c, e), "accepted_precision": rate(c+f, a),
             "automatic_coverage": rate(a, n), "existing_coverage": rate(e, n),
             "retained_correct_positive": c/38, "positive_coverage": c/54,
             "review_load": rate(n-a, n), "correct_automatic_yield": rate(c+f, n),
             "raw_accuracy": rate(raw, n)}
    gates = {"integrity": True, "nonempty_existing": e > 0,
             "wrong_reuse_below_2_percent": e > 0 and (e-c)/e < 0.02,
             "useful_coverage": c >= MIN_CORRECT}
    return {"threshold": threshold, "rows": rows, "counts": counts, "rates": rates,
            "gates": gates, "qualifies": all(gates.values()),
            "routing_effects": {
                "avoided_wrong_reuse": sum(r["route"] == "REVIEW" and
                    r["answer"] != "none_fit" and not r["correct"] for r in rows),
                "lost_correct_decisions": raw-c-f, "raw_prediction_wins": 0,
                "raw_prediction_losses": 0, "raw_prediction_ties": n}}


def summary(metadata, cells):
    """Describe every grid row without treating exploratory gates as validation."""
    rows = [{key: value for key, value in cell.items() if key != "rows"} for cell in cells.values()]
    baseline = rows[0]
    for row in rows:
        row["difference_from_baseline"] = {
            key: value - baseline["rates"][key] if value is not None else None
            for key, value in row["rates"].items()}
    selected = next((row["threshold"] for row in rows if row["qualifies"]), None)
    return {"metadata": metadata, "rows": rows, "selected_threshold": selected,
            "exploratory_gates": "PASS" if selected is not None else "FAIL",
            "validity": "INCONCLUSIVE", "inference_calls": 0}


def atomic_json(path, value):
    """Flush a checkpoint before replacing its previous version."""
    path = checked_path(path.parent, path.name)
    temporary = checked_path(path.parent, path.name + ".tmp")
    with temporary.open("w") as stream:
        json.dump(value, stream, indent=2, sort_keys=True, allow_nan=False)
        stream.write("\n")
        stream.flush()
        os.fsync(stream.fileno())
    temporary.replace(path)


def execute(source, output, pins, expected_manifest, resume=False, verify=False):
    """Checkpoint thresholds, or verify completed outputs without writing."""
    items, metadata = load_inputs(source, pins, expected_manifest)
    raw_path = checked_path(output, "rescored.json")
    summary_path = checked_path(output, "summary.json")
    expected_cells = {str(t): score_cell(items, t) for t in GRID}
    saved = read_json(raw_path) if raw_path.exists() else None
    if saved is not None:
        require(resume or verify, "Existing output requires --resume")
        require(saved["metadata"] == metadata, "Resume fingerprint mismatch")
        keys = list(saved["cells"])
        require(set(keys) <= set(expected_cells), "Unknown checkpoint threshold")
        for key in keys:
            require(saved["cells"][key] == expected_cells[key], "Checkpoint metric mismatch")
    if verify:
        require(saved == {"metadata": metadata, "cells": expected_cells}, "Incomplete saved results")
        require(read_json(summary_path) == summary(metadata, expected_cells), "Summary mismatch")
        verify_preservation(source)
        print("Verified 8/8 thresholds; original files unchanged; zero inference calls", flush=True)
        return
    output.mkdir(parents=True, exist_ok=True)
    cells = saved["cells"] if saved is not None else {}
    for key, cell in expected_cells.items():
        if key not in cells:
            cells[key] = cell
            atomic_json(raw_path, {"metadata": metadata, "cells": cells})
            print(f"Checkpoint threshold {key}: {cell['counts']['A']} accepted", flush=True)
    # Sorting the checkpoint's JSON keys must not change grid order on resume.
    cells = {key: cells[key] for key in expected_cells}
    verify_preservation(source)
    result = summary(metadata, cells)
    atomic_json(summary_path, result)
    print(f"Exploratory gates: {result['exploratory_gates']}; validity: INCONCLUSIVE", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--resume", action="store_true")
    mode.add_argument("--verify", action="store_true")
    args = parser.parse_args()
    execute(SOURCE, HERE / "output", PINS, MANIFEST_DIGEST, args.resume, args.verify)
