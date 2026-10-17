"""Experiment 25: similarityThreshold sweep over Experiment 24 Arm A0 lists. Reads Experiment 24 output/ only."""

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
EXP24 = HERE.parent / "24-retrieval-memory-reranker-2026-10-17"
sys.path.insert(0, str(EXP24))
import run_eval as r  # noqa: E402

OUT = HERE / "output"
THRESHOLDS = [0.60, 0.55, 0.50, 0.45, 0.40, 0.30, None]
BASELINE = 0.60
MIN_GAIN = 0.10
MAX_EXTRA_NOISE = 2.0
PICK_MARGIN = 0.03
KEYS = {"v2": "judge_labels_v2.jsonl", "strict": "judge_labels.jsonl"}


def mean(values):
    return sum(values) / len(values) if values else None


def compute_scores():
    """Recompute A0 with Experiment 24's scorer. Gate G1: ids and order equal the saved lists."""
    prompts = r.read_json(EXP24 / "output" / "sample.json")["prompts"]
    saved = {row["prompt_id"]: row["A0"] for row in map(json.loads, (EXP24 / "output" / "rows.jsonl").read_text().splitlines())}
    memories = r.load_memories(r.SNAP / "memories.db")
    scores, mismatches = {}, []
    for index, prompt in enumerate(prompts, 1):
        query_vec = r.embed(prompt["text"][: r.TEXT_CAP])
        _, scored = r.score_prompt(prompt, memories, query_vec)
        top = r.rank_candidates(scored, r.TOP_K)
        if [s["id"] for s in top] != saved[prompt["id"]]:
            mismatches.append(prompt["id"])
        scores[prompt["id"]] = [{"id": s["id"], "score": round(s["score"], 4)} for s in top]
        print(f"{index}/{len(prompts)} prompts", flush=True)
    return scores, mismatches


def load_relevant(labels_name):
    key = {p["pair_id"]: (p["prompt_id"], p["memory_id"]) for p in r.read_json(EXP24 / "output" / "pair_key.json")}
    relevant = {}
    for line in (EXP24 / "output" / labels_name).read_text().splitlines():
        item = json.loads(line)
        if item["relevant"]:
            prompt_id, memory_id = key[item["pair_id"]]
            relevant.setdefault(prompt_id, set()).add(memory_id)
    return relevant


def arm_ids(rows, threshold):
    return [s["id"] for s in rows if threshold is None or s["score"] >= threshold]


def evaluate(scores, relevant):
    per_arm = {}
    for threshold in THRESHOLDS:
        recalls, noise, empty = {}, [], 0
        for prompt_id, rows in scores.items():
            ids = arm_ids(rows, threshold)
            rel = relevant.get(prompt_id, set())
            empty += not ids
            noise.append(len(set(ids) - rel))
            if rel:
                recalls[prompt_id] = len(set(ids) & rel) / len(rel)
        per_arm[threshold] = {"recalls": recalls, "noise": noise, "empty": empty}
    base = per_arm[BASELINE]
    result = {}
    for threshold, arm in per_arm.items():
        diffs = [arm["recalls"][p] - base["recalls"][p] for p in arm["recalls"]]
        result["none" if threshold is None else f"{threshold:.2f}"] = {
            "recall_at_10": mean(list(arm["recalls"].values())),
            "recall_diff_vs_baseline": mean(diffs),
            "noise_per_prompt": mean(arm["noise"]),
            "noise_diff_vs_baseline": mean(arm["noise"]) - mean(base["noise"]),
            "empty_prompts": arm["empty"],
            "wins": sum(d > 0 for d in diffs), "losses": sum(d < 0 for d in diffs), "ties": sum(d == 0 for d in diffs),
            "prompts_with_relevant": len(arm["recalls"]),
        }
    passing = {k: v for k, v in result.items()
               if k != f"{BASELINE:.2f}" and v["recall_diff_vs_baseline"] >= MIN_GAIN and v["noise_diff_vs_baseline"] <= MAX_EXTRA_NOISE}
    pick = None
    if passing:
        best = max(v["recall_at_10"] for v in passing.values())
        near = [k for k, v in passing.items() if v["recall_at_10"] >= best - PICK_MARGIN and k != "none"]
        pick = max(near, key=float) if near else "none"
    return {"arms": result, "H1_arms": sorted(passing), "pick": pick, "pass": bool(passing)}


def main():
    OUT.mkdir(exist_ok=True)
    scores_path = OUT / "scores.json"
    if scores_path.exists():
        scores = r.read_json(scores_path)
    else:
        scores, mismatches = compute_scores()
        r.atomic_json(OUT / "g1.json", {"G1_pass": not mismatches, "mismatched_prompts": mismatches})
        if mismatches:
            print("G1 FAIL:", mismatches)
            raise SystemExit(1)
        r.atomic_json(scores_path, scores)
    summary = {name: evaluate(scores, load_relevant(file)) for name, file in KEYS.items()}
    r.atomic_json(OUT / "summary.json", summary)
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
