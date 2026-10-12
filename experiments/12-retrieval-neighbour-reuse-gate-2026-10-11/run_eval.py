"""Experiment 12: neighbour gate against labelled observations, with nested group folds."""

import argparse
import hashlib
import json
import math
import operator
import os
import random
from pathlib import Path

HERE = Path(__file__).resolve().parent
EXPERIMENTS = HERE.parent
OUT = HERE / "output"
R = "01-label-decisions-2026-10-07/output/revision-01-batch8192"
PINS = {
    f"{R}/output/vectors_checkpoint.json": "fa993420490c14e072b3ca789a42fa26bb76ebb0e579c1f0e6ccffb91cd881c8",
    f"{R}/corpus/ground-truth.json": "8a4771923c458c45aff494839adf932eb42cdd72cf8bd452c44074bba7484f7c",
    f"{R}/corpus/catalogue.json": "3d9af990a51225037e5bca52bcaa28ca0d9486da7166a02d27cbb2366f0d52bc",
    "10-review-reference-adjudication-2026-10-11/corpus/adjudicated-reference.json": "b920699250d46d14160bf3edab7e1d161c0bfdc284aa87aa521c9dfb1796ecbe",
    "06-retrieval-primary-intent-label-selection-2026-10-10/output/eval_results.json": "89de5774c588343003021abe4ddf1343ee37d453d67aa781946155133ec808e8",
    "11-retrieval-catalogue-consolidation-replay-2026-10-11/output/build.json": "c837a2031714516bb9b3a7f40183d451eceda53f8cb241d62a964930ba7c7643",
    "11-retrieval-catalogue-consolidation-replay-2026-10-11/plan.json": "29291bc7d10abc8485475bcafd96990b0e9eddd92afc65f82a23d234fdac968d",
}
K = 3
TAUS = [0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95]
DELTAS = [0, 0.01, 0.02, 0.03, 0.05, 0.08, 0.12]
FOLDS = 5
FRACTIONS = [0.25, 0.5, 0.75]
SEEDS = [0, 1, 2]
TIER1_MIN_CORRECT = 29
NEIGHBOURS_SAVED = 10
PEN_TAU_DEFAULT = 0.95


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


def normalised(payload):
    return json.loads(json.dumps(payload, sort_keys=True))


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


# --- Inputs --------------------------------------------------------------------------


def load_inputs():
    """Cases with section, group, gallery label and acceptable set; unit vectors by id."""
    check_pins()
    truth = read_json(EXPERIMENTS / R / "corpus/ground-truth.json")
    reference = read_json(EXPERIMENTS / "10-review-reference-adjudication-2026-10-11/corpus/adjudicated-reference.json")["decisions"]
    sets = read_json(EXPERIMENTS / "11-retrieval-catalogue-consolidation-replay-2026-10-11/output/build.json")["acceptable_sets"]
    records = read_json(EXPERIMENTS / R / "output/vectors_checkpoint.json")["records"]
    cases = {}
    for row in truth:
        if row["split"] == "development":
            require(len(row["expected"]) == 1, "dev_shape")
            label, accept = row["expected"][0], [row["expected"][0]]
        else:
            label, accept = reference[row["id"]]["label"], sets[row["id"]]
        cases[row["id"]] = {"split": row["split"], "section": row["section"],
                            "group": row["group"], "label": label, "accept": accept}
    require(sum(c["split"] == "test" for c in cases.values()) == 140, "test_shape")
    require(sum(c["split"] == "development" for c in cases.values()) == 60, "dev_shape")
    vectors = {}
    for case_id in cases:
        record = records[case_id]
        require(record["status"] == "ok" and len(record["vector"]) == 1024, "vector_shape")
        norm = math.sqrt(sum(v * v for v in record["vector"]))
        vectors[case_id] = [v / norm for v in record["vector"]]
    return cases, vectors


def similarity_matrix(cases, vectors):
    """Cosine similarity for every same-section pair."""
    ids = sorted(cases)
    sims = {i: {} for i in ids}
    for a_index, a in enumerate(ids):
        for b in ids[a_index + 1:]:
            if cases[a]["section"] != cases[b]["section"]:
                continue
            value = sum(map(operator.mul, vectors[a], vectors[b]))
            sims[a][b] = sims[b][a] = value
    return sims


def assign_folds(cases):
    """Deal test groups round-robin into folds, ordered by SHA-256 of the group name."""
    groups = sorted({c["group"] for c in cases.values() if c["split"] == "test"},
                    key=lambda g: (hashlib.sha256(g.encode()).hexdigest(), g))
    fold_of_group = {group: index % FOLDS for index, group in enumerate(groups)}
    return {case_id: fold_of_group[c["group"]] for case_id, c in cases.items()
            if c["split"] == "test"}


# --- The gate ------------------------------------------------------------------------


def neighbours(query, gallery, cases, sims):
    """Same-section gallery members, most similar first; the query's own group never appears."""
    group = cases[query]["group"]
    members = [m for m in gallery if m != query and m in sims[query]]
    require(all(cases[m]["group"] != group for m in members), "fold_leak")
    return sorted(members, key=lambda m: (-sims[query][m], m))


def features(query, ranked, cases, sims):
    """What the rule needs: the unanimous label, the top similarity and the gap."""
    if len(ranked) < K:
        return None
    top = [cases[m]["label"] for m in ranked[:K]]
    label = top[0]
    if label == "none_fit" or any(t != label for t in top):
        return None
    best = sims[query][ranked[0]]
    rival = next((sims[query][m] for m in ranked if cases[m]["label"] != label), None)
    gap = math.inf if rival is None else best - rival
    return {"label": label, "best": best, "gap": gap}


def decide(feature, rule):
    if feature is None or rule is None:
        return None
    tau, delta = rule
    return feature["label"] if feature["best"] >= tau and feature["gap"] >= delta else None


def gallery_without_groups(gallery, groups, cases):
    return [m for m in gallery if cases[m]["group"] not in groups]


def choose_rule(gallery, cases, sims):
    """Leave-one-group-out inside the gallery; zero wrong, most correct, stricter on ties."""
    inner = []
    for query in gallery:
        ranked = neighbours(query, gallery_without_groups(gallery, {cases[query]["group"]}, cases),
                            cases, sims)
        inner.append((query, features(query, ranked, cases, sims)))
    best, scores = None, {}
    for tau in TAUS:
        for delta in DELTAS:
            correct = wrong = 0
            for query, feature in inner:
                label = decide(feature, (tau, delta))
                if label is None:
                    continue
                if label in cases[query]["accept"]:
                    correct += 1
                else:
                    wrong += 1
            scores[f"{tau}|{delta}"] = {"correct": correct, "wrong": wrong}
            if wrong == 0 and correct > 0:
                key = (correct, tau, delta)
                if best is None or key > best:
                    best = key
    rule = None if best is None else [best[1], best[2]]
    return rule, scores


def run_fold(fold, fold_of, cases, sims, gallery_groups=None):
    """Choose the rule on the outer gallery, then decide each held-out case once."""
    held_out = sorted(c for c, f in fold_of.items() if f == fold)
    gallery = sorted(c for c in cases if fold_of.get(c) != fold)
    held_groups = {cases[c]["group"] for c in held_out}
    require(not any(cases[m]["group"] in held_groups for m in gallery), "fold_leak")
    if gallery_groups is not None:
        gallery = [m for m in gallery if cases[m]["group"] in gallery_groups]
    rule, scores = choose_rule(gallery, cases, sims)
    decisions = {}
    for case in held_out:
        ranked = neighbours(case, gallery, cases, sims)
        label = decide(features(case, ranked, cases, sims), rule)
        decisions[case] = {
            "fold": fold, "decision": label,
            "neighbours": [[m, cases[m]["label"], sims[case][m]] for m in ranked[:NEIGHBOURS_SAVED]],
        }
    return {"fold": fold, "rule": rule, "inner_best": None if rule is None
            else scores[f"{rule[0]}|{rule[1]}"], "gallery_size": len(gallery), "decisions": decisions}


def score(decisions, cases):
    correct = wrong = wrong_none = parked = 0
    for case, row in decisions.items():
        label = row["decision"]
        if label is None:
            parked += 1
        elif label in cases[case]["accept"]:
            correct += 1
        else:
            wrong += 1
            wrong_none += cases[case]["label"] == "none_fit"
    existing = correct + wrong
    return {"n": len(decisions), "existing": existing, "correct": correct, "wrong": wrong,
            "wrong_on_none_fit": wrong_none, "parked": parked,
            "wrong_reuse": wrong / existing if existing else None,
            "upper_bound_95": upper_bound(existing, wrong),
            "tier1_pass": wrong == 0 and correct >= TIER1_MIN_CORRECT}


# --- Reported extras -----------------------------------------------------------------


def learning_curve(fold_of, cases, sims):
    rows = {}
    for fraction in FRACTIONS:
        for seed in SEEDS:
            decisions = {}
            for fold in range(FOLDS):
                gallery = sorted(c for c in cases if fold_of.get(c) != fold)
                groups = sorted({cases[c]["group"] for c in gallery})
                rng = random.Random(f"{seed}|{fold}|{fraction}")
                keep = set(rng.sample(groups, round(fraction * len(groups))))
                decisions.update(run_fold(fold, fold_of, cases, sims, keep)["decisions"])
            counts = score(decisions, cases)
            rows[f"{fraction}|{seed}"] = {k: counts[k] for k in ("correct", "wrong", "parked")}
    return rows


def holding_pen(decisions, rules, sims):
    """Connected groups of parked cases; a pair links at the stricter fold threshold."""
    parked = sorted(c for c, row in decisions.items() if row["decision"] is None)
    tau = {c: (rules[decisions[c]["fold"]] or [PEN_TAU_DEFAULT])[0] for c in parked}
    parent = {c: c for c in parked}

    def root(c):
        while parent[c] != c:
            c = parent[c]
        return c

    for i, a in enumerate(parked):
        for b in parked[i + 1:]:
            if b in sims[a] and sims[a][b] >= max(tau[a], tau[b]):
                parent[root(a)] = root(b)
    sizes = {}
    for c in parked:
        sizes[root(c)] = sizes.get(root(c), 0) + 1
    big = [s for s in sizes.values() if s >= 3]
    return {"parked": len(parked), "groups": len(sizes), "groups_of_3_plus": len(big),
            "cases_in_groups_of_3_plus": sum(big)}


def exploratory_grid(fold_of, cases, sims):
    """Every rule applied directly to the 140 cases; exploratory because it looks at them."""
    feats = {}
    for case, fold in fold_of.items():
        gallery = sorted(c for c in cases if fold_of.get(c) != fold)
        feats[case] = features(case, neighbours(case, gallery, cases, sims), cases, sims)
    grid = {}
    for tau in TAUS:
        for delta in DELTAS:
            rows = {c: {"decision": decide(f, (tau, delta))} for c, f in feats.items()}
            counts = score(rows, cases)
            grid[f"{tau}|{delta}"] = {k: counts[k] for k in ("correct", "wrong", "parked")}
    return grid


def paired_with_experiment06(decisions, cases):
    saved = read_json(EXPERIMENTS / "06-retrieval-primary-intent-label-selection-2026-10-10/output/eval_results.json")["records"]
    wrong_none = [c for c, r in saved.items() if r["choice"] not in ("none_fit", "uncertain")
                  and cases[c]["label"] == "none_fit"]
    right = [c for c, r in saved.items() if r["choice"] not in ("none_fit", "uncertain")
             and r["choice"] in cases[c]["accept"]]
    return {"exp06_wrong_on_none_fit": len(wrong_none),
            "gate_parks_of_those": sum(decisions[c]["decision"] is None for c in wrong_none),
            "exp06_correct": len(right),
            "gate_keeps_same_label": sum(decisions[c]["decision"] == saved[c]["choice"] for c in right)}


# --- Phases --------------------------------------------------------------------------


def compute(resume=False, write=True):
    cases, vectors = load_inputs()
    sims = similarity_matrix(cases, vectors)
    fold_of = assign_folds(cases)
    runner = file_hash(Path(__file__))
    folds = []
    for fold in range(FOLDS):
        path = OUT / "folds" / f"fold-{fold}.json"
        if resume and path.exists():
            saved = read_json(path)
            if saved.get("runner_sha256") == runner:
                folds.append(saved)
                continue
        result = normalised({**run_fold(fold, fold_of, cases, sims), "runner_sha256": runner})
        if write:
            atomic_json(path, result)
        folds.append(result)
    decisions = {}
    for result in folds:
        decisions.update(result["decisions"])
    require(sorted(decisions) == sorted(fold_of), "completeness")
    rules = {r["fold"]: r["rule"] for r in folds}
    counts = score(decisions, cases)
    curve = learning_curve(fold_of, cases, sims)
    full = counts["correct"]
    mean = lambda fraction, key: sum(curve[f"{fraction}|{s}"][key] for s in SEEDS) / len(SEEDS)
    rising = (full >= mean(0.5, "correct") + 5 and counts["wrong"] == 0
              and all(curve[f"0.5|{s}"]["wrong"] == 0 for s in SEEDS))
    summary = {
        "counts": counts,
        "h1_holds": counts["tier1_pass"],
        "gates": {"G2_completeness": len(decisions) == 140, "G4_tier1": counts["tier1_pass"]},
        "rules": {str(f): r for f, r in rules.items()},
        "inner_best": {str(r["fold"]): r["inner_best"] for r in folds},
        "learning_curve": {"rows": curve, "rising": rising,
                           "mean_correct": {str(f): mean(f, "correct") for f in FRACTIONS},
                           "mean_wrong": {str(f): mean(f, "wrong") for f in FRACTIONS}},
        "holding_pen": holding_pen(decisions, rules, sims),
        "paired_experiment06": paired_with_experiment06(decisions, cases),
        "exploratory_grid": exploratory_grid(fold_of, cases, sims),
    }
    folds_file = {"fold_of_case": fold_of, "rules": {str(f): r for f, r in rules.items()},
                  "runner_sha256": file_hash(Path(__file__)), "pins": PINS}
    return normalised(summary), normalised(folds_file), normalised(decisions)


def execute(phase, resume=False):
    if phase == "verify":
        summary, folds_file, decisions = compute(write=False)
        for name, payload in (("summary.json", summary), ("folds.json", folds_file),
                              ("predictions.json", decisions)):
            require(read_json(OUT / name) == payload, f"{name}_mismatch")
        check_pins()
        print("Verified folds, predictions and summary; zero writes", flush=True)
        return
    summary, folds_file, decisions = compute(resume=resume)
    atomic_json(OUT / "folds.json", folds_file)
    atomic_json(OUT / "predictions.json", decisions)
    atomic_json(OUT / "summary.json", summary)
    atomic_json(OUT / "run-manifest.json", {
        "runner_sha256": file_hash(Path(__file__)), "pins": PINS,
        "outputs": {n: file_hash(OUT / n) for n in ("folds.json", "predictions.json", "summary.json")}})
    check_pins()
    c = summary["counts"]
    rate = "n/a" if c["wrong_reuse"] is None else f"{c['wrong_reuse']:.4f}"
    print(f"Gate: E={c['existing']} C={c['correct']} W={c['wrong']} parked={c['parked']} "
          f"W/E={rate} tier1={c['tier1_pass']}", flush=True)
    print(f"Rules per fold: {summary['rules']}", flush=True)
    print(f"Learning curve mean C: {summary['learning_curve']['mean_correct']} "
          f"(full {c['correct']}); rising={summary['learning_curve']['rising']}", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--phase", choices=("run", "verify"), required=True)
    parser.add_argument("--resume", action="store_true")
    args = parser.parse_args()
    execute(args.phase, args.resume)
