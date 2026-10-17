"""Experiment 24 summary: gates, recall@10, precision, sign test. Reads output/ only."""

import json
import statistics
import sys
from math import comb
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import run_eval as r  # noqa: E402

OUT = HERE / "output"
# Optional first argument picks a label set: "v2" reads judge_labels_v2.jsonl and writes summary_v2.json.
SUFFIX = f"_{sys.argv[1]}" if len(sys.argv) > 1 else ""
MIN_GAIN = 0.05
ALPHA = 0.05


def sign_test(wins, losses):
    """Same formula as Experiment 18 run_eval.py sign_test."""
    n = wins + losses
    if n == 0:
        return 1.0
    return min(1.0, 2 * sum(comb(n, i) for i in range(min(wins, losses) + 1)) / 2**n)


def mean(values):
    return sum(values) / len(values) if values else None


def percentile(values, q):
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, int(round(q * (len(ordered) - 1))))] if ordered else None


def load_labels():
    key = {p["pair_id"]: (p["prompt_id"], p["memory_id"]) for p in r.read_json(OUT / "pair_key.json")}
    relevant, judged = {}, set()
    for line in (OUT / f"judge_labels{SUFFIX}.jsonl").read_text().splitlines():
        item = json.loads(line)
        pair = key[item["pair_id"]]
        judged.add(item["pair_id"])
        if item["relevant"]:
            relevant.setdefault(pair[0], set()).add(pair[1])
    return key, relevant, judged


def main():
    rows = [json.loads(line) for line in (OUT / "rows.jsonl").read_text().splitlines()]
    key, relevant, judged = load_labels()
    arms = ("A", "A0", "B")
    per = {a: [] for a in arms}
    precision = {a: [] for a in arms}
    scored = []
    for row in rows:
        rel = relevant.get(row["prompt_id"], set())
        if not rel:
            continue
        scored.append(row["prompt_id"])
        for a in arms:
            per[a].append(r.recall_at_k(row[a], rel))
            p = r.precision_at_k(row[a], rel)
            precision[a].append(0.0 if p is None else p)  # empty return counts as 0 precision
    wins = sum(1 for x, y in zip(per["B"], per["A"]) if x > y)
    losses = sum(1 for x, y in zip(per["B"], per["A"]) if x < y)
    ties = len(scored) - wins - losses
    gain = mean(per["B"]) - mean(per["A"]) if scored else None
    p_value = sign_test(wins, losses)
    seconds = [row["rerank_seconds"] for row in rows if row["status"] == "ok"]
    p95_ms = percentile(seconds, 0.95) * 1000 if seconds else None
    errors = sum(1 for row in rows if row["status"] != "ok")
    gates = {
        "G3_prompts_with_relevant": {"value": len(scored), "pass": len(scored) >= 40},
        "G4_completeness": {"prompts": len(rows), "errors": errors,
                            "all_pairs_judged": len(judged) == len(key), "pass": len(rows) == 60 and not errors and len(judged) == len(key)},
        "guardrail_P": {"A": mean(precision["A"]), "B": mean(precision["B"]),
                        "pass": mean(precision["B"]) >= mean(precision["A"]) - 0.10 if scored else False},
        "guardrail_L": {"p95_ms": p95_ms, "median_ms": statistics.median(seconds) * 1000 if seconds else None,
                        "pass": p95_ms is not None and p95_ms <= 500},
    }
    h1 = gain is not None and gain >= MIN_GAIN and p_value < ALPHA
    summary = {
        "prompts_scored": len(scored), "prompts_total": len(rows),
        "mean_recall_at_10": {a: mean(per[a]) for a in arms},
        "mean_precision": {a: mean(precision[a]) for a in arms},
        "A_returned_per_prompt": mean([len(row["A"]) for row in rows]),
        "B_minus_A": {"gain": gain, "wins": wins, "losses": losses, "ties": ties, "sign_test_p": p_value},
        "H1": h1, "gates": gates,
        "exploratory": {"B_minus_A0": mean(per["B"]) - mean(per["A0"]) if scored else None,
                        "A0_minus_A": mean(per["A0"]) - mean(per["A"]) if scored else None,
                        "relevant_in_pool_per_prompt": mean([len(relevant[p]) for p in scored])},
        "G5_note": "operator spot check recorded separately in output/spot_check.json",
    }
    r.atomic_json(OUT / f"summary{SUFFIX}.json", summary)
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
