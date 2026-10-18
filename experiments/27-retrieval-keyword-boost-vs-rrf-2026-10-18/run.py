"""Experiment 27: keyword boost and RRF against meaning alone. Phases: arms, pool, summarise.

Run from the worktree root: `python3 experiments/27-.../run.py <phase>`. No third-party packages.
"""

import json
import random
import re
import sqlite3
import sys
import os
from pathlib import Path

HERE = Path(__file__).resolve().parent
EXP24 = HERE.parent / "24-retrieval-memory-reranker-2026-10-17"
sys.path.insert(0, str(EXP24))
import run_eval as r  # noqa: E402

SAVED = Path(os.environ.get("OMMS_EXPERIMENT_OUTPUTS", Path.home() / "Development/PROJECTS/omms-experiment-outputs"))
DATA24 = SAVED / EXP24.name / "output"
SNAP = DATA24 / "snapshot"
OUT = HERE / "output"
SEED = 27
THRESHOLD = 0.50
TOP_K = 10
BOOST = 0.10
RRF_K = 60
KW_LIMIT = 40
MAX_TERMS = 24
PART_SIZE = 150
ARMS = ("A", "B", "C")
# Same list as STOP_WORDS in src/services/turso/keyword-search.ts.
STOP_WORDS = set("the and or not of to in on at by for is it an be are was we i me my you do did does why how what with this that".split())


# --- Pure parts (tested in test_run.py) ----------------------------------------------------

def build_keyword_query(text):
    """Port of buildKeywordQuery: lower-case letters and digits, quoted, joined by OR."""
    terms = []
    for word in re.findall(r"[^\W_]+", (text or "").lower()):
        if len(word) < 2 or word in STOP_WORDS or word in terms:
            continue
        terms.append(word)
        if len(terms) == MAX_TERMS:
            break
    return " OR ".join(f'"{term}"' for term in terms) if terms else None


def apply_boost(base, score, best, boost):
    """Port of applyKeywordBoost."""
    if not boost > 0 or not score > 0 or not best > 0:
        return base
    return min(1.0, base + boost * min(1.0, score / best))


def rrf_rank(vector_ids, keyword_ids, k=RRF_K, top=TOP_K):
    """Reciprocal rank fusion of two ranked lists; ties break by id."""
    fused = {}
    for ids in (vector_ids, keyword_ids):
        for rank, item in enumerate(ids, 1):
            fused[item] = fused.get(item, 0.0) + 1.0 / (k + rank)
    return [item for item, _ in sorted(fused.items(), key=lambda kv: (-kv[1], kv[0]))[:top]]


def mean(values):
    values = list(values)
    return sum(values) / len(values) if values else None


# --- Phase 1: arms ---------------------------------------------------------------------------

def build_index(memories):
    OUT.mkdir(exist_ok=True)
    path = OUT / "keywords.db"
    if path.exists():
        path.unlink()
    con = sqlite3.connect(path)
    con.execute("CREATE VIRTUAL TABLE fts USING fts5(content, tags, tokenize='unicode61')")
    con.executemany("INSERT INTO fts(rowid, content, tags) VALUES (?, ?, ?)",
                    [(i, m["content"], m["tags"]) for i, m in enumerate(memories)])
    con.commit()
    return con


def keyword_hits(con, ids, text, eligible):
    match = build_keyword_query(text)
    if not match:
        return {}
    hits = {}
    for rowid, score in con.execute("SELECT rowid, -bm25(fts) FROM fts WHERE fts MATCH ? ORDER BY 2 DESC, rowid", (match,)):
        if ids[rowid] in eligible:
            hits[ids[rowid]] = score
            if len(hits) == KW_LIMIT:
                break
    return hits


def arms_for(prompt, memories, con, ids, query_vec):
    eligible, scores = r.score_prompt(prompt, memories, query_vec)
    base = {s["id"]: s["score"] for s in scores}
    hits = keyword_hits(con, ids, prompt["text"][: r.TEXT_CAP], set(base))
    best = max(hits.values(), default=0.0)
    a0 = [s["id"] for s in r.rank_candidates(scores, TOP_K)]
    boosted = [{"id": i, "score": apply_boost(b, hits.get(i, 0.0), best, BOOST)} for i, b in base.items()]
    vector_list = [s["id"] for s in r.rank_candidates([s for s in scores if s["score"] >= THRESHOLD], len(scores))]
    keyword_list = sorted(hits, key=lambda i: (-hits[i], i))
    return {"A0": a0, "A": [i for i in a0 if base[i] >= THRESHOLD],
            "B": [s["id"] for s in r.rank_candidates(boosted, TOP_K) if s["score"] >= THRESHOLD],
            "C": rrf_rank(vector_list, keyword_list),
            "eligible": len(eligible), "kw_hits": len(hits)}


def phase_arms():
    sample = r.read_json(DATA24 / "sample.json")
    g1 = all(r.sha256_file(SNAP / name) == sha for name, sha in sample["snapshot_sha256"].items())
    r.require(g1, "G1_snapshot_changed")
    memories = r.load_memories(SNAP / "memories.db")
    ids = [m["id"] for m in memories]
    con = build_index(memories)
    old = {json.loads(line)["prompt_id"]: json.loads(line)["A0"] for line in (DATA24 / "rows.jsonl").read_text().splitlines()}
    path = OUT / "arms.json"
    state = r.read_json(path) if path.exists() else {"meta": {"G1": True}, "prompts": {}}
    for index, prompt in enumerate(sample["prompts"], 1):
        if prompt["id"] in state["prompts"]:
            continue
        query_vec = r.embed(prompt["text"][: r.TEXT_CAP])
        state["prompts"][prompt["id"]] = arms_for(prompt, memories, con, ids, query_vec)
        r.atomic_json(path, state)
        print(f"{index}/{len(sample['prompts'])} prompts", flush=True)
    state["meta"]["G2"] = all(state["prompts"][pid]["A0"] == old[pid] for pid in old)
    r.atomic_json(path, state)
    print("G1 ok; G2", "PASS" if state["meta"]["G2"] else "FAIL", flush=True)
    r.require(state["meta"]["G2"], "G2_baseline_not_reproduced")


# --- Phase 2: pool ---------------------------------------------------------------------------

def load_old_labels():
    keys = {p["pair_id"]: (p["prompt_id"], p["memory_id"]) for p in r.read_json(DATA24 / "pair_key.json")}
    labels = {}
    for line in (DATA24 / "judge_labels_v2.jsonl").read_text().splitlines():
        item = json.loads(line)
        labels[keys[item["pair_id"]]] = int(item["relevant"])
    return labels


def phase_pool():
    sample = {p["id"]: p for p in r.read_json(DATA24 / "sample.json")["prompts"]}
    arms = r.read_json(OUT / "arms.json")["prompts"]
    by_id = {m["id"]: m for m in r.load_memories(SNAP / "memories.db")}
    old = load_old_labels()
    pool = {(pid, m) for pid, a in arms.items() for arm in ARMS for m in a[arm]}
    new = sorted(pool - set(old))
    rng = random.Random(SEED)
    check = rng.sample(sorted(k for k, v in old.items() if v == 1), 20) + rng.sample(sorted(k for k, v in old.items() if v == 0), 20)
    pairs = [{"prompt_id": p, "memory_id": m, "kind": "new"} for p, m in new] + \
            [{"prompt_id": p, "memory_id": m, "kind": "check"} for p, m in check]
    rng.shuffle(pairs)
    lines = []
    for number, pair in enumerate(pairs, 1):
        pair["pair_id"] = f"x{number:04d}"
        lines.append(json.dumps({"pair_id": pair["pair_id"],
                                 "prompt": r.redact(sample[pair["prompt_id"]]["text"][:2000]),
                                 "memory": r.redact(by_id[pair["memory_id"]]["content"][:1500])}, ensure_ascii=False))
    parts = [lines[i:i + PART_SIZE] for i in range(0, len(lines), PART_SIZE)]
    for number, part in enumerate(parts, 1):
        (OUT / f"judge_part{number}.jsonl").write_text("\n".join(part) + "\n")
    r.atomic_json(OUT / "pair_key.json", pairs)
    print(f"pool {len(pool)} pairs; {len(new)} new, 40 check; {len(parts)} parts of up to {PART_SIZE}", flush=True)


# --- Phase 3: summarise ----------------------------------------------------------------------

def summarise_arms(arms, label):
    pool = {pid: set().union(*(set(a[arm]) for arm in ARMS)) for pid, a in arms.items()}
    relevant = {pid: {m for m in ms if label(pid, m)} for pid, ms in pool.items()}
    rows = {arm: {} for arm in ARMS}
    for pid, a in arms.items():
        for arm in ARMS:
            hit = len(set(a[arm]) & relevant[pid])
            rows[arm][pid] = {"recall": hit / len(relevant[pid]) if relevant[pid] else None,
                              "relevant": hit, "noise": len(a[arm]) - hit, "empty": not a[arm]}
    with_rel = [pid for pid in arms if relevant[pid]]
    table = {arm: {"recall": mean(rows[arm][p]["recall"] for p in with_rel),
                   "relevant_per_prompt": mean(rows[arm][p]["relevant"] for p in arms),
                   "noise_per_prompt": mean(rows[arm][p]["noise"] for p in arms),
                   "empty_prompts": sum(rows[arm][p]["empty"] for p in arms)} for arm in ARMS}

    def versus(x, y):
        diffs = [rows[x][p]["recall"] - rows[y][p]["recall"] for p in with_rel]
        return {"recall_diff": table[x]["recall"] - table[y]["recall"],
                "noise_diff": table[x]["noise_per_prompt"] - table[y]["noise_per_prompt"],
                "wins": sum(d > 1e-9 for d in diffs), "losses": sum(d < -1e-9 for d in diffs),
                "ties": sum(abs(d) <= 1e-9 for d in diffs)}
    return {"prompts_with_relevant": len(with_rel), "arms": table,
            "B_vs_A": versus("B", "A"), "C_vs_B": versus("C", "B"), "C_vs_A": versus("C", "A"),
            "prompts_where_B_differs_from_A": sum(arms[p]["B"] != arms[p]["A"] for p in arms),
            "prompts_where_C_differs_from_A": sum(arms[p]["C"] != arms[p]["A"] for p in arms)}


def phase_summarise():
    state = r.read_json(OUT / "arms.json")
    arms, key = state["prompts"], r.read_json(OUT / "pair_key.json")
    old = load_old_labels()
    judged = {}
    for path in sorted(OUT.glob("judge_labels_part*.jsonl")):
        for line in path.read_text().splitlines():
            item = json.loads(line)
            judged[item["pair_id"]] = int(item["relevant"])
    new = {(k["prompt_id"], k["memory_id"]): judged.get(k["pair_id"]) for k in key if k["kind"] == "new"}
    check = [(old[(k["prompt_id"], k["memory_id"])], judged.get(k["pair_id"])) for k in key if k["kind"] == "check"]
    label_map = {**old, **{k: v for k, v in new.items() if v is not None}}
    missing = [(p, m) for p, a in arms.items() for arm in ARMS for m in a[arm] if (p, m) not in label_map]
    agree = {g: sum(o == n for o, n in check if o == g) for g in (1, 0)}
    result = summarise_arms(arms, lambda p, m: label_map[(p, m)])
    gates = {"G1": bool(state["meta"].get("G1")), "G2": bool(state["meta"].get("G2")),
             "G4": result["prompts_with_relevant"] >= 40, "G5": not missing,
             "G6": sum(agree.values()) >= 34 and all(v >= 15 for v in agree.values())}
    b, c = result["B_vs_A"], result["C_vs_B"]
    outcome = {"H1_boost_helps": b["recall_diff"] >= 0.03 and b["noise_diff"] <= 0.5,
               "keep_0.1": b["recall_diff"] >= -0.01 and b["noise_diff"] <= 0.5,
               "H2_rrf_worth_a_setting": c["recall_diff"] >= 0.05 and c["noise_diff"] <= 1.0}
    summary = {**result, "gates": gates, "gate_G3": "run test_run.py", "judge_check_agreement": agree,
               "new_pairs": len(new), "new_pairs_relevant": sum(v == 1 for v in new.values()),
               "unlabelled": len(missing), "outcome": outcome}
    r.atomic_json(OUT / "summary.json", summary)
    print(json.dumps(summary, indent=1))


def main():
    phases = {"arms": phase_arms, "pool": phase_pool, "summarise": phase_summarise}
    if len(sys.argv) != 2 or sys.argv[1] not in phases:
        raise SystemExit("usage: run.py arms|pool|summarise")
    phases[sys.argv[1]]()


if __name__ == "__main__":
    main()
