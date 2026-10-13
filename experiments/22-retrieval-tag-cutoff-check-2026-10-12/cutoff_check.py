"""Experiment 22: does a confidence cut-off on Clef's top three labels drop wrong tags without losing hits?

Reads saved Clef probabilities and answer keys from Experiments 18 and 20. No model calls.
Writes output/summary.json. See report.md for the plan and Amendment 1.
"""

import json
import math
import os
from pathlib import Path

HERE = Path(__file__).resolve().parent
EXP18 = HERE.parent / "18-retrieval-fresh-confirmation-all-methods-2026-10-12"
EXP20 = HERE.parent / "20-retrieval-catalogue-v2-fresh-test-2026-10-12"

TOP = 3
RULES = [("baseline", None)]
RULES += [("label_cutoff", t) for t in (0.03, 0.05, 0.08, 0.10, 0.15, 0.20)]
RULES += [("nofit_block", n) for n in (0.10, 0.20, 0.30)]
MIN_WRONG_CUT = 0.30
MAX_HIT_LOSS = 0.03


def tags(probs, rule, value):
    """Tags for one observation: up to three labels, never none_fit."""
    if rule == "nofit_block" and probs.get("none_fit", 0.0) >= value:
        return []
    ranked = sorted((l for l in probs if l != "none_fit"), key=lambda l: (-probs[l], l))[:TOP]
    if rule == "label_cutoff":
        ranked = [l for l in ranked if probs[l] >= value]
    return ranked


def wilson(k, n, z=1.96):
    if n == 0:
        return None
    p = k / n
    centre = (p + z * z / (2 * n)) / (1 + z * z / n)
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / (1 + z * z / n)
    return [max(0.0, centre - half), min(1.0, centre + half)]


def score_multi(raw, key, rule, value):
    """Primary measures against the multi-label key (Amendment 1)."""
    hits = fits = total_tags = wrong = 0
    untagged = 0
    for c, valid in key.items():
        t = tags(raw[c]["probabilities"], rule, value)
        total_tags += len(t)
        wrong += sum(1 for l in t if l not in valid)
        untagged += not t
        if valid:
            fits += 1
            hits += any(l in valid for l in t)
    n = len(key)
    return {
        "items": n,
        "items_with_valid_label": fits,
        "hits": hits,
        "hit_rate": hits / fits if fits else None,
        "hit_ci95": wilson(hits, fits),
        "tags": total_tags,
        "wrong_tags": wrong,
        "tag_precision": (total_tags - wrong) / total_tags if total_tags else None,
        "untagged": untagged,
        "tags_per_item": total_tags / n,
    }


def score_old(raw, key, rule, value):
    """Original measures against the single-label key (secondary)."""
    labelled = {c: l for c, l in key.items() if l not in ("none_fit", "uncertain", "disputed")}
    nofit = [c for c, l in key.items() if l == "none_fit"]
    hits = sum(1 for c, l in labelled.items() if l in tags(raw[c]["probabilities"], rule, value))
    junk = [len(tags(raw[c]["probabilities"], rule, value)) for c in nofit]
    return {
        "labelled": len(labelled),
        "hits": hits,
        "hit_rate": hits / len(labelled),
        "hit_ci95": wilson(hits, len(labelled)),
        "none_fit_items": len(nofit),
        "junk_tags": sum(junk),
        "none_fit_items_tagged": sum(1 for j in junk if j),
    }


def passes(base, cand):
    """H1 conditions for one rule against the baseline on one set."""
    if base["wrong_tags"] == 0:
        return False
    cut = 1 - cand["wrong_tags"] / base["wrong_tags"]
    # The tolerance stops float rounding from failing a loss of exactly 3 points.
    return cut >= MIN_WRONG_CUT and base["hit_rate"] - cand["hit_rate"] <= MAX_HIT_LOSS + 1e-9


def choose(results):
    """Passing rule with the fewest total tags; ties go to the higher hit rate."""
    base = results["baseline"]
    ok = [name for name, r in results.items() if name != "baseline" and passes(base, r)]
    return min(ok, key=lambda name: (results[name]["tags"], -results[name]["hit_rate"])) if ok else None


def rule_name(rule, value):
    return rule if value is None else f"{rule}@{value:.2f}"


def evaluate(raw, multi, old):
    out = {}
    for rule, value in RULES:
        name = rule_name(rule, value)
        out[name] = {"multi": score_multi(raw, multi, rule, value), "old": score_old(raw, old, rule, value)}
    return out


def cross_section(raw, multi):
    """Valid labels Clef could not score because they sit outside the observation's section."""
    return sum(1 for c, valid in multi.items() for l in valid if l not in raw[c]["probabilities"])


def read(path):
    return json.loads(Path(path).read_text())


def load(exp, raw_path, ref_name, multi_name):
    raw = read(raw_path)
    raw = raw.get("clef", raw)
    multi = {c: v["labels"] for c, v in read(HERE / "corpus" / multi_name)["decisions"].items()}
    old = {c: v["label"] for c, v in read(exp / "corpus" / ref_name)["decisions"].items()}
    if not multi or set(multi) - set(raw) or set(old) - set(raw):
        raise SystemExit(f"key and raw output do not match for {exp.name}")
    return raw, multi, old


def main():
    sets = {
        "exp18": load(EXP18, EXP18 / "output/raw.json", "fresh-reference.json", "multilabel-18.json"),
        "exp20": load(EXP20, EXP20 / "output/raw.json", "reference.json", "multilabel-20.json"),
    }
    results = {name: evaluate(*data) for name, data in sets.items()}
    multi_view = {name: {r: v["multi"] for r, v in res.items()} for name, res in results.items()}
    chosen = choose(multi_view["exp18"])
    confirmed = chosen is not None and passes(multi_view["exp20"]["baseline"], multi_view["exp20"][chosen])
    top_k = {
        name: {
            k: sum(1 for c, valid in multi.items() if valid and any(l in valid for l in tags(raw[c]["probabilities"], None, None)[:k]))
            for k in (1, 2, 3)
        }
        for name, (raw, multi, _) in sets.items()
    }
    summary = {
        "plan": "report.md, Amendment 1",
        "rules": [rule_name(r, v) for r, v in RULES],
        "H1": {
            "chosen_on_exp18": chosen,
            "holds_on_exp20": confirmed,
            "verdict": "PASS" if confirmed else "FAIL",
        },
        "results": results,
        "descriptive": {
            "best_rule_chosen_on_exp20_itself": choose(multi_view["exp20"]),
            "baseline_top_k_hits_multi": top_k,
            "cross_section_valid_labels": {name: cross_section(raw, multi) for name, (raw, multi, _) in sets.items()},
        },
    }
    out = HERE / "output"
    out.mkdir(exist_ok=True)
    tmp = out / "summary.json.tmp"
    tmp.write_text(json.dumps(summary, indent=1, sort_keys=True))
    os.replace(tmp, out / "summary.json")
    print(json.dumps(summary["H1"]))


if __name__ == "__main__":
    main()
