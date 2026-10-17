"""Experiment 26: threshold check on fresh prompts. Phases: sample, score, pool, spotcheck, ingest, summarise."""

import json
import random
import sqlite3
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
EXP24 = HERE.parent / "24-retrieval-memory-reranker-2026-10-17"
EXP25 = HERE.parent / "25-retrieval-threshold-sweep-2026-10-17"
sys.path.insert(0, str(EXP24))
sys.path.insert(0, str(EXP25))
import run_eval as r  # noqa: E402
import sweep  # noqa: E402

OUT = HERE / "output"
SEED = 26
N_PROMPTS = 60
POOL_MIN_SCORE = 0.45
PART_SIZE = 200
sweep.THRESHOLDS = [0.60, 0.55, 0.50, 0.45]


def phase_sample():
    r.require(not (OUT / "sample.json").exists(), "already_sampled")
    old = r.read_json(EXP24 / "output" / "sample.json")
    r.require(old["snapshot_sha256"] == {n: r.sha256_file(r.SNAP / n) for n in old["snapshot_sha256"]}, "G1_snapshot_drift")
    used_ids = {p["id"] for p in old["prompts"]}
    used_sessions = {p["session"] for p in old["prompts"]}
    first_memory = r.load_memories(r.SNAP / "memories.db")[0]["created_at"]
    con = sqlite3.connect(f"file:{r.SNAP / 'user-prompts.db'}?mode=ro", uri=True)
    rows = con.execute(
        "SELECT id, session_id, content, created_at FROM user_prompts "
        "WHERE project_path LIKE '%/PROJECTS/omms%' AND length(content) >= ? ORDER BY created_at",
        (r.MIN_PROMPT_CHARS,)).fetchall()
    con.close()
    seen, fresh = set(), []
    for pid, session, content, created in rows:
        text = content.strip()
        if text.startswith("/") or "<private>" in text or text in seen or created <= first_memory:
            continue
        seen.add(text)
        if pid not in used_ids and session not in used_sessions:
            fresh.append({"id": pid, "session": session, "created_at": created, "text": text})
    rng = random.Random(SEED)
    rng.shuffle(fresh)
    per_session, sample = {}, []
    for item in fresh:
        if per_session.get(item["session"], 0) >= r.MAX_PER_SESSION:
            continue
        per_session[item["session"]] = per_session.get(item["session"], 0) + 1
        sample.append(item)
        if len(sample) == N_PROMPTS:
            break
    r.require(len(sample) == N_PROMPTS, "sample_size")
    r.require(not ({p["id"] for p in sample} & used_ids) and not ({p["session"] for p in sample} & used_sessions), "G2_not_fresh")
    sample.sort(key=lambda s: s["created_at"])
    r.atomic_json(OUT / "sample.json", {"seed": SEED, "fresh_candidates": len(fresh), "prompts": sample,
                                        "G1": "ok", "G2": "ok", "snapshot_sha256": old["snapshot_sha256"]})
    print(f"sampled {len(sample)} fresh prompts from {len(fresh)} candidates; G1 ok, G2 ok", flush=True)


def phase_score():
    sample = r.read_json(OUT / "sample.json")["prompts"]
    path = OUT / "scores.json"
    scores = r.read_json(path) if path.exists() else {}
    memories = r.load_memories(r.SNAP / "memories.db")
    for index, prompt in enumerate(sample, 1):
        if prompt["id"] in scores:
            continue
        query_vec = r.embed(prompt["text"][: r.TEXT_CAP])
        _, scored = r.score_prompt(prompt, memories, query_vec)
        top = r.rank_candidates(scored, r.TOP_K)
        scores[prompt["id"]] = [{"id": s["id"], "score": round(s["score"], 4)} for s in top]
        r.atomic_json(path, scores)
        print(f"{index}/{len(sample)} prompts", flush=True)


def phase_pool():
    sample = {p["id"]: p for p in r.read_json(OUT / "sample.json")["prompts"]}
    scores = r.read_json(OUT / "scores.json")
    by_id = {m["id"]: m for m in r.load_memories(r.SNAP / "memories.db")}
    pairs = [{"prompt_id": pid, "memory_id": s["id"]} for pid, rows in scores.items() for s in rows if s["score"] >= POOL_MIN_SCORE]
    random.Random(SEED).shuffle(pairs)
    lines = []
    for number, pair in enumerate(pairs, 1):
        pair["pair_id"] = f"q{number:04d}"
        lines.append(json.dumps({
            "pair_id": pair["pair_id"],
            "prompt": r.redact(sample[pair["prompt_id"]]["text"][:2000]),
            "memory": r.redact(by_id[pair["memory_id"]]["content"][:1500])}, ensure_ascii=False))
    (OUT / "judge_input.jsonl").write_text("\n".join(lines) + "\n")
    parts = [lines[i:i + PART_SIZE] for i in range(0, len(lines), PART_SIZE)]
    for number, part in enumerate(parts, 1):
        (OUT / f"judge_part{number}.jsonl").write_text("\n".join(part) + "\n")
    r.atomic_json(OUT / "pair_key.json", pairs)
    print(f"{len(pairs)} pairs in {len(parts)} parts of up to {PART_SIZE}", flush=True)


def load_labels(use_operator=True):
    labels = {}
    for path in sorted(OUT.glob("judge_labels_part*.jsonl")):
        for line in path.read_text().splitlines():
            item = json.loads(line)
            labels[item["pair_id"]] = item["relevant"]
    override = OUT / "spot_check.json"
    if use_operator and override.exists():
        labels.update({k: int(v) for k, v in r.read_json(override)["operator"].items()})
    return labels


FRENCH_MARKERS = ("utilisateur", "Demande", "Résultat", "Résultats")
PAGE_BODY = """</style></head><body><main>
<header><h1>Experiment 26 spot check</h1>
<div class="sub">Relevant = the memory has a concrete, usable link to the prompt (same project, tool, file, bug, decision, convention or preference). A shared general topic alone is not relevant. <b id="cnt">0</b> of 40 answered.</div>
<div class="bar"><i id="bar"></i></div></header>
<div id="list"></div>
<div class="foot"><button id="dl" disabled>Download results JSON</button><span class="sub" id="hint">Answer all 40 to enable the download. Answers save in the browser.</span></div>
</main>
<script>
const ITEMS=__ITEMS__;
const KEY="exp26-spotcheck-v1";
let ans={};try{ans=JSON.parse(localStorage.getItem(KEY)||"{}")}catch(e){}
function save(){try{localStorage.setItem(KEY,JSON.stringify(ans))}catch(e){}}
function render(){
 const list=document.getElementById("list");list.innerHTML="";
 ITEMS.forEach(it=>{
  const c=document.createElement("div");c.className="card"+(ans[it.pair_id]!==undefined?" done":"");
  const h=document.createElement("b");h.textContent="Pair "+it.n+" of 40";c.appendChild(h);
  [["Prompt",it.prompt],["Memory",it.memory]].forEach(([l,v])=>{
   const a=document.createElement("div");a.className="lab";a.textContent=l;c.appendChild(a);
   const b=document.createElement("div");b.className="txt";b.textContent=v;c.appendChild(b)});
  const bt=document.createElement("div");bt.className="btns";
  [["y","Relevant",1],["n","Not relevant",0]].forEach(([cl,lb,val])=>{
   const b=document.createElement("button");b.className=cl+(ans[it.pair_id]===val?" on":"");b.textContent=lb;
   b.onclick=()=>{ans[it.pair_id]=val;save();render()};bt.appendChild(b)});
  c.appendChild(bt);list.appendChild(c)});
 const n=Object.keys(ans).length;
 document.getElementById("cnt").textContent=n;
 document.getElementById("bar").style.width=(n/40*100)+"%";
 document.getElementById("dl").disabled=n<40;
}
document.getElementById("dl").onclick=()=>{
 const out={experiment:"26-retrieval-threshold-fresh-prompts-2026-10-17",kind:"operator_spot_check",answered_at:new Date().toISOString(),
  answers:ITEMS.map(it=>({n:it.n,pair_id:it.pair_id,relevant:ans[it.pair_id]}))};
 const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([JSON.stringify(out,null,2)],{type:"application/json"}));
 a.download="exp26_spot_check_results.json";a.click();
 document.getElementById("hint").textContent="Downloaded. Tell Claude it is done.";
};
render();
</script></body></html>"""


def embed_json(value):
    """JSON for a <script> block: a literal "<" would let "</script>" in memory text end the block."""
    return json.dumps(value, ensure_ascii=False).replace("<", "\\u003c")


def phase_spotcheck():
    """40 pairs: 20 the AI marked relevant, 20 not relevant. Memories that look French are skipped (no translation step)."""
    labels = {k: v for k, v in load_labels().items()}
    inputs = {j["pair_id"]: j for j in map(json.loads, (OUT / "judge_input.jsonl").read_text().splitlines())}

    def readable(pair_id):
        memory = inputs[pair_id]["memory"]
        non_ascii = sum(ord(c) > 127 for c in memory) / max(len(memory), 1)
        return non_ascii <= 0.02 and not any(m in memory for m in FRENCH_MARKERS)

    rng = random.Random(SEED)
    chosen = []
    for value in (1, 0):
        pool = sorted(p for p in labels if labels[p] == value and readable(p))
        rng.shuffle(pool)
        chosen += pool[:20]
    rng.shuffle(chosen)
    items = [{"n": n, "pair_id": p, "prompt": inputs[p]["prompt"], "memory": inputs[p]["memory"]} for n, p in enumerate(chosen, 1)]
    css = (EXP24 / "output" / "spot_check.html").read_text().split("</style>")[0].replace(
        "Experiment 24 spot check", "Experiment 26 spot check")
    (OUT / "spot_check.html").write_text(css + PAGE_BODY.replace("__ITEMS__", embed_json(items)))
    r.atomic_json(OUT / "spot_check_key.json", {p: labels[p] for p in chosen})
    print(f"{len(items)} pairs written to spot_check.html ({sum(labels[p] for p in chosen)} AI relevant)", flush=True)


def phase_ingest():
    path = Path(sys.argv[2]) if len(sys.argv) > 2 else Path.home() / "Downloads" / "exp26_spot_check_results.json"
    key = r.read_json(OUT / "spot_check_key.json")
    operator = {a["pair_id"]: int(a["relevant"]) for a in r.read_json(path)["answers"]}
    r.require(set(operator) == set(key), "spot_check_pairs_differ")
    groups = {}
    for value in (1, 0):
        members = [p for p in key if key[p] == value]
        groups[f"ai_{'relevant' if value else 'not_relevant'}"] = {"pairs": len(members), "agree": sum(operator[p] == value for p in members)}
    total = sum(g["agree"] for g in groups.values())
    passed = total >= 30 and all(g["agree"] >= 12 for g in groups.values())
    r.atomic_json(OUT / "spot_check.json", {"operator": operator, "ai_label": key, "G5": {"agree": total, "of": len(key), "groups": groups, "pass": passed}})
    print(json.dumps({"agree": total, "of": len(key), "groups": groups, "G5_pass": passed}, indent=2))


def phase_summarise():
    scores = r.read_json(OUT / "scores.json")
    pairs = r.read_json(OUT / "pair_key.json")
    ai_only = len(sys.argv) > 2 and sys.argv[2] == "ai"
    labels = load_labels(use_operator=not ai_only)
    missing = [p["pair_id"] for p in pairs if p["pair_id"] not in labels]
    relevant = {}
    for p in pairs:
        if labels.get(p["pair_id"]):
            relevant.setdefault(p["prompt_id"], set()).add(p["memory_id"])
    result = sweep.evaluate(scores, relevant)
    with_relevant = result["arms"]["0.60"]["prompts_with_relevant"]
    spot = OUT / "spot_check.json"
    gates = {"G3_coverage": {"prompts_with_relevant": with_relevant, "pass": with_relevant >= 40},
             "G4_completeness": {"pairs": len(pairs), "missing": len(missing), "pass": not missing},
             "G5_key_check": r.read_json(spot)["G5"] if spot.exists() else "not done"}
    summary = {**result, "gates": gates, "pairs": len(pairs), "relevant_pairs": sum(labels.get(p["pair_id"], 0) for p in pairs)}
    r.atomic_json(OUT / ("summary_ai_only.json" if ai_only else "summary.json"), summary)
    print(json.dumps(summary, indent=2))


PHASES = {"sample": phase_sample, "score": phase_score, "pool": phase_pool, "spotcheck": phase_spotcheck,
          "ingest": phase_ingest, "summarise": phase_summarise}

if __name__ == "__main__":
    if len(sys.argv) < 2 or sys.argv[1] not in PHASES:
        raise SystemExit("usage: run.py {sample|score|pool|spotcheck|ingest [path]|summarise}")
    OUT.mkdir(exist_ok=True)
    PHASES[sys.argv[1]]()
