"""Experiment 11: replay saved Experiment 06 answers through development-built merge maps."""

import argparse
import hashlib
import json
import math
import os
from pathlib import Path

HERE = Path(__file__).resolve().parent
EXPERIMENTS = HERE.parent
OUT = HERE / "output"
CORPUS = EXPERIMENTS / "01-label-decisions-2026-10-07/output/revision-01-batch8192/corpus"
EXP06 = EXPERIMENTS / "06-retrieval-primary-intent-label-selection-2026-10-10"
EXP09 = EXPERIMENTS / "09-retrieval-verify-label-reuse-2026-10-11"
EXP10 = EXPERIMENTS / "10-review-reference-adjudication-2026-10-11"
PINS = {
    "06-retrieval-primary-intent-label-selection-2026-10-10/output/eval_results.json": "89de5774c588343003021abe4ddf1343ee37d453d67aa781946155133ec808e8",
    "01-label-decisions-2026-10-07/output/revision-01-batch8192/corpus/ground-truth.json": "8a4771923c458c45aff494839adf932eb42cdd72cf8bd452c44074bba7484f7c",
    "01-label-decisions-2026-10-07/output/revision-01-batch8192/corpus/catalogue.json": "3d9af990a51225037e5bca52bcaa28ca0d9486da7166a02d27cbb2366f0d52bc",
    "09-retrieval-verify-label-reuse-2026-10-11/output/eval_results.json": "ae2624f90289c3ad9d1b0bf12d29f5fe87f9a1a74919fbe747251d3b7ed780fb",
    "09-retrieval-verify-label-reuse-2026-10-11/output/calibration.json": "26eecd08d8513f03ce7030def787c829063887d9cb1ba67d1bf19bd1a29d05f9",
    "10-review-reference-adjudication-2026-10-11/corpus/adjudicated-reference.json": "b920699250d46d14160bf3edab7e1d161c0bfdc284aa87aa521c9dfb1796ecbe",
    "10-review-reference-adjudication-2026-10-11/corpus/agent-draft-decisions.json": "f100795172d4ef27a32005eec2d095adc3cc4ebd12de66a7b407d1335a12460a",
    "10-review-reference-adjudication-2026-10-11/corpus/agent-judge-verdicts.json": "1c81bf1f23c2ff2fde17e79a64d416dbce84807871d13a69f45e9992341cdb53",
    "10-review-reference-adjudication-2026-10-11/corpus/agent-draft-response.json": "9a54e6d1c5fd30500b03df34590178e00e738d6bc14753f9016d89db9d040610",
    "10-review-reference-adjudication-2026-10-11/output/summary.json": "c0075ee85066cbbc8b3bb65450806b57636d5bfd74b89355fe449abf9da6cbe9",
}
SPECIAL = {"none_fit", "uncertain"}
TARGETS = {
    "L30": {"preferences": 16, "patterns": 14},
    "L20": {"preferences": 11, "patterns": 9},
    "L12": {"preferences": 6, "patterns": 6},
}
CELLS = {"C0": (None, False), "C1": (None, True), "C2": ("L30", True),
         "C3": ("L20", True), "C4": ("L12", True)}
PRIMARY_CELL, PRIMARY_LEVEL = "C3", "L20"
BASELINE = {"existing": 71, "correct": 29, "wrong": 42}
GUARDRAIL_SHARE = 0.30
TIER1_MIN_CORRECT = 29


def require(condition, code):
    if not condition:
        raise ValueError(code)


def file_hash(path):
    with open(path, "rb") as handle:
        return hashlib.file_digest(handle, "sha256").hexdigest()


def read_json(path):
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def atomic_json(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    os.replace(tmp, path)


def digest(payload):
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()


def check_pins():
    for name, expected in PINS.items():
        require(file_hash(EXPERIMENTS / name) == expected, "input_hash_drift")


def upper_bound(n, k, alpha=0.05):
    """Exact one-sided Clopper-Pearson upper bound on a rate of k events in n."""
    if n == 0:
        return None
    if k >= n:
        return 1.0
    lo, hi = k / n, 1.0
    for _ in range(80):
        mid = (lo + hi) / 2
        tail = sum(math.comb(n, i) * mid**i * (1 - mid) ** (n - i) for i in range(k + 1))
        lo, hi = (mid, hi) if tail > alpha else (lo, mid)
    return hi


# --- Build: merge maps from development evidence only (G4) ---------------------------


def load_catalogue():
    catalogue = read_json(CORPUS / "catalogue.json")
    require(len(catalogue) == 41, "catalogue_shape")
    return {label["id"]: label for label in catalogue}


def load_dev_cases():
    cases = [c for c in read_json(CORPUS / "ground-truth.json") if c["split"] == "development"]
    require(len(cases) == 60 and all(len(c["expected"]) == 1 for c in cases), "dev_shape")
    return {c["id"]: c["expected"][0] for c in cases}


def load_clef_records():
    records = read_json(EXP09 / "output/eval_results.json")["records"]
    return [r for r in records.values() if r["arm"] == "clef"]


def similarity_table(labels, dev_labels, records):
    """Mean P(yes) across both directions for every same-section label pair."""
    scores = {}
    for record in records:
        require(record["case_id"] in dev_labels, "test_record_in_build")
        require(record["phase"] == "calibration" and record["status"] == "ok", "bad_dev_record")
        require(isinstance(record["p_yes"], float) and 0.0 <= record["p_yes"] <= 1.0, "bad_p_yes")
        scores[(record["case_id"], record["label_id"])] = record["p_yes"]
    by_label = {}
    for case_id, label in dev_labels.items():
        by_label.setdefault(label, []).append(case_id)
    require(set(by_label) == set(labels), "label_without_dev_case")
    table = {}
    for a in sorted(labels):
        for b in sorted(labels):
            if a >= b or labels[a]["section"] != labels[b]["section"]:
                continue
            values = [scores.get((case, b)) for case in by_label[a]]
            values += [scores.get((case, a)) for case in by_label[b]]
            require(None not in values, "missing_pair_score")
            table[(a, b)] = sum(values) / len(values)
    return table


def pair_score(table, a, b):
    return table[(a, b)] if a < b else table[(b, a)]


def cluster_section(members, table, targets):
    """Average-linkage merging; returns a snapshot at each target size."""
    clusters = [(m,) for m in sorted(members)]
    snapshots = {}
    for size in sorted(set(targets.values()), reverse=True):
        require(size <= len(members), "target_too_large")
        while len(clusters) > size:
            best = None
            for i in range(len(clusters)):
                for j in range(i + 1, len(clusters)):
                    a, b = clusters[i], clusters[j]
                    score = sum(pair_score(table, x, y) for x in a for y in b) / (len(a) * len(b))
                    key = (-score, a, b)
                    if best is None or key < best[0]:
                        best = (key, i, j)
            _, i, j = best
            merged = tuple(sorted(clusters[i] + clusters[j]))
            clusters = sorted([c for k, c in enumerate(clusters) if k not in (i, j)] + [merged])
        for level, target in targets.items():
            if target == size:
                snapshots[level] = list(clusters)
    return snapshots


def build_merge_maps(labels, dev_labels, records):
    table = similarity_table(labels, dev_labels, records)
    maps = {level: {} for level in TARGETS}
    for section in ("preferences", "patterns"):
        members = [l for l in labels if labels[l]["section"] == section]
        targets = {level: sizes[section] for level, sizes in TARGETS.items()}
        for level, clusters in cluster_section(members, table, targets).items():
            for cluster in clusters:
                for label in cluster:
                    maps[level][label] = "+".join(cluster)
    for level, mapping in maps.items():
        require(set(mapping) == set(labels), "map_incomplete")
        require(len(set(mapping.values())) == sum(TARGETS[level].values()), "map_size")
    similarity = {f"{a}|{b}": value for (a, b), value in sorted(table.items())}
    return maps, similarity


# --- Build: acceptable-label sets from the Experiment 10 disputes -------------------


def build_acceptable_sets(labels, reference, responses):
    sets = {case: {decision["label"]} for case, decision in reference.items()}
    widened = []
    for row in responses:
        require(row["key"] in sets, "unknown_dispute_case")
        if row["position"] not in ("keep", "other"):
            continue
        draft, judge = row["draft"], row["judge"]
        if draft in labels and judge in labels and draft != judge:
            sets[row["key"]] |= {draft, judge}
            widened.append(row["key"])
    return {case: sorted(values) for case, values in sets.items()}, sorted(widened)


def load_reference():
    reference = read_json(EXP10 / "corpus/adjudicated-reference.json")["decisions"]
    require(len(reference) == 140, "reference_shape")
    return reference


def build_outputs():
    check_pins()
    labels = load_catalogue()
    maps, similarity = build_merge_maps(labels, load_dev_cases(), load_clef_records())
    responses = read_json(EXP10 / "corpus/agent-draft-response.json")["responses"]
    sets, widened = build_acceptable_sets(labels, load_reference(), responses)
    return {"merge_maps": maps, "similarity": similarity, "acceptable_sets": sets,
            "widened_cases": widened, "runner_sha256": file_hash(Path(__file__)), "pins": PINS}


# --- Score ---------------------------------------------------------------------------


def mapper(mapping):
    return (lambda label: label) if mapping is None else (lambda label: mapping.get(label, label))


def score_cell(cases, choices, reference, sets, mapping, use_sets):
    """One outcome per case; none_fit and uncertain answers never count as reuse."""
    m = mapper(mapping)
    rows = {}
    for case in cases:
        ref = reference[case]
        pick = m(choices[case])
        accept = {m(x) for x in (sets[case] if use_sets else [ref])}
        if choices[case] == "uncertain":
            outcome = "uncertain"
        elif choices[case] == "none_fit":
            outcome = "none_fit_correct" if ref == "none_fit" else "none_fit_missed"
        elif pick in accept:
            outcome = "correct_reuse"
        else:
            outcome = "wrong_on_none_fit" if ref == "none_fit" else "wrong_label_vs_label"
        rows[case] = {"pick": pick, "reference": m(ref), "outcome": outcome}
    return rows


def cell_counts(rows):
    count = lambda name: sum(1 for r in rows.values() if r["outcome"] == name)
    correct = count("correct_reuse")
    wrong = count("wrong_on_none_fit") + count("wrong_label_vs_label")
    existing = correct + wrong
    return {"n": len(rows), "existing": existing, "correct": correct, "wrong": wrong,
            "wrong_on_none_fit": count("wrong_on_none_fit"),
            "wrong_label_vs_label": count("wrong_label_vs_label"),
            "none_fit_correct": count("none_fit_correct"),
            "none_fit_missed": count("none_fit_missed"), "uncertain": count("uncertain"),
            "wrong_reuse": wrong / existing if existing else None,
            "upper_bound_95": upper_bound(existing, wrong),
            "tier1_pass": wrong == 0 and correct >= TIER1_MIN_CORRECT}


def largest_share(labels, reference, mapping):
    """Largest merged label's share of its section's reference-positive test cases."""
    m = mapper(mapping)
    totals, groups = {}, {}
    for ref in reference.values():
        if ref["label"] in SPECIAL:
            continue
        section = labels[ref["label"]]["section"]
        totals[section] = totals.get(section, 0) + 1
        key = (section, m(ref["label"]))
        groups[key] = groups.get(key, 0) + 1
    shares = {f"{s}|{label}": n / totals[s] for (s, label), n in groups.items()}
    top = max(shares, key=lambda k: (shares[k], k))
    return {"label": top, "share": shares[top]}


def summarise(labels, reference, cells, build):
    counts = {cell: cell_counts(rows) for cell, rows in cells.items()}
    confused = [c for c, r in cells["C1"].items() if r["outcome"] == "wrong_label_vs_label"]
    fixed = [c for c in confused if cells[PRIMARY_CELL][c]["outcome"] == "correct_reuse"]
    need = math.ceil(len(confused) / 2)
    shares = {level: largest_share(labels, reference, build["merge_maps"][level])
              for level in TARGETS}
    l20 = build["merge_maps"][PRIMARY_LEVEL]
    disputes = {case: len({l20[x] for x in build["acceptable_sets"][case]}) == 1
                for case in build["widened_cases"]}
    remaining = {}
    for cell, rows in cells.items():
        pairs = sorted({f"{r['pick']} -> {r['reference']}" for r in rows.values()
                        if r["outcome"] == "wrong_label_vs_label"})
        remaining[cell] = pairs
    c0 = counts["C0"]
    return {
        "counts": counts,
        "labels_per_cell": {cell: (41 if level is None else sum(TARGETS[level].values()))
                            for cell, (level, _) in CELLS.items()},
        "h1": {"label_vs_label_wrong_in_C1": len(confused), "fixed_in_C3": len(fixed),
               "needed": need, "holds": len(confused) > 0 and len(fixed) >= need},
        "guardrail_largest_share": shares,
        "gates": {
            "G2_completeness": all(len(rows) == 140 for rows in cells.values()),
            "G3_reproduction": (c0["existing"], c0["correct"], c0["wrong"])
            == (BASELINE["existing"], BASELINE["correct"], BASELINE["wrong"]),
            "G5_guardrail": shares[PRIMARY_LEVEL]["share"] <= GUARDRAIL_SHARE,
        },
        "exploratory": {"dispute_pairs_merged_at_L20": disputes,
                        "remaining_confused_pairs": remaining},
        "status_note": "post-hoc exploratory; Experiment 06 answers were already inspected",
    }


def load_score_inputs():
    cases = sorted(load_reference())
    records = read_json(EXP06 / "output/eval_results.json")["records"]
    require(sorted(records) == cases, "baseline_selection")
    require(all(r["status"] == "ok" for r in records.values()), "invalid_baseline")
    labels = load_catalogue()
    require(all(r["choice"] in labels or r["choice"] in SPECIAL for r in records.values()),
            "unknown_choice")
    return cases, {c: records[c]["choice"] for c in cases}


def run_cells(build, resume):
    cases, choices = load_score_inputs()
    reference = {c: d["label"] for c, d in load_reference().items()}
    manifest = read_json(OUT / "run-manifest.json")
    cells = {}
    for cell, (level, use_sets) in CELLS.items():
        path = OUT / "cells" / f"{cell}.json"
        if resume and path.exists():
            saved = read_json(path)
            if saved["build_sha256"] == manifest["build_sha256"]:
                cells[cell] = saved["rows"]
                continue
        mapping = None if level is None else build["merge_maps"][level]
        rows = score_cell(cases, choices, reference, build["acceptable_sets"], mapping, use_sets)
        atomic_json(path, {"cell": cell, "build_sha256": manifest["build_sha256"], "rows": rows})
        cells[cell] = rows
    return cells


def execute(phase, resume=False):
    labels = load_catalogue()
    if phase == "build":
        build = build_outputs()
        atomic_json(OUT / "build.json", build)
        atomic_json(OUT / "run-manifest.json", {"build_sha256": file_hash(OUT / "build.json"),
                                                "runner_sha256": file_hash(Path(__file__)),
                                                "pins": PINS})
        check_pins()
        print(f"Built merge maps {sorted(build['merge_maps'])}; "
              f"{len(build['widened_cases'])} widened case(s)", flush=True)
        return
    check_pins()
    manifest = read_json(OUT / "run-manifest.json")
    require(file_hash(OUT / "build.json") == manifest["build_sha256"], "build_drift")
    build = read_json(OUT / "build.json")
    if phase == "verify":
        expected = build_outputs()
        expected["runner_sha256"] = build["runner_sha256"]
        require(json.loads(json.dumps(expected, sort_keys=True)) == build, "build_mismatch")
        cases, choices = load_score_inputs()
        reference = {c: d["label"] for c, d in load_reference().items()}
        cells = {}
        for cell, (level, use_sets) in CELLS.items():
            mapping = None if level is None else build["merge_maps"][level]
            cells[cell] = score_cell(cases, choices, reference, build["acceptable_sets"],
                                     mapping, use_sets)
            require(read_json(OUT / "cells" / f"{cell}.json")["rows"] == cells[cell],
                    "cell_mismatch")
        summary = summarise(labels, load_reference(), cells, build)
        summary["build_sha256"] = manifest["build_sha256"]
        require(read_json(OUT / "summary.json") == json.loads(json.dumps(summary, sort_keys=True)),
                "summary_mismatch")
        check_pins()
        print("Verified build, cells and summary; zero writes", flush=True)
        return
    cells = run_cells(build, resume)
    summary = summarise(labels, load_reference(), cells, build)
    summary["build_sha256"] = manifest["build_sha256"]
    atomic_json(OUT / "summary.json", summary)
    check_pins()
    for cell, c in summary["counts"].items():
        rate = "n/a" if c["wrong_reuse"] is None else f"{c['wrong_reuse']:.4f}"
        print(f"{cell}: E={c['existing']} C={c['correct']} W={c['wrong']} W/E={rate}", flush=True)
    print(f"H1: {summary['h1']}; gates: {summary['gates']}", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--phase", choices=("build", "score", "verify"), required=True)
    parser.add_argument("--resume", action="store_true")
    args = parser.parse_args()
    execute(args.phase, args.resume)
