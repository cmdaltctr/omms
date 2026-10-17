"""Experiment 24: current memory scorer against a reranker over the top 50.

Phases: prepare, check, run, pool. Run from the worktree root with
`python3 experiments/24-.../run_eval.py --phase <name>`. No third-party packages.
"""

import argparse
import hashlib
import json
import math
import os
import random
import re
import shutil
import socket
import sqlite3
import subprocess
import time
import urllib.request
from array import array
from operator import mul
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "output"
SNAP = OUT / "snapshot"
HOME = Path.home()
MEMORY_DB = HOME / ".omms/data/projects/project_769e931b738f5620_shard_0.db"
PROMPT_DB = HOME / ".omms/data/user-prompts.db"
EMBED_URL = "http://127.0.0.1:9931/v1/embeddings"
EMBED_MODEL = "qwen3-embedding:0.6b"
REVISION = "a02f48bb4f057028298c21fa033da2b30d7742d5"
GGUF = (HOME / ".cache/huggingface/hub/models--ggml-org--Qwen3-Reranker-0.6B-Q8_0-GGUF/snapshots"
        / REVISION / "qwen3-reranker-0.6b-q8_0.gguf")
GGUF_SHA256 = "22c9979ce4fbcdc5acdc310c6641c32797eff1aa980b8f7a2db8a8ea23429a48"
GGUF_BYTES = 639153184
SERVER = Path("/Users/aizat/Development/PROJECTS/llamaindex-rag-mcp-v3/experiments/38-rescue-quality-signal-2026-09-30/"
              "output/.models/llamacpp/b11510/llama-b11510/llama-server")
SERVER_SHA256 = "1bf5602a2be50097c44282a6ecc63234d94ee8f96d39fd45fed6eff4e74b6b41"
PORT = 3008
SERVER_ARGS = ["--reranking", "--ctx-size", "8192", "--batch-size", "8192", "--ubatch-size", "8192",
               "--parallel", "1", "--gpu-layers", "all", "--offline", "--log-disable", "--host", "127.0.0.1"]
SEED = 24
N_PROMPTS = 60
MAX_PER_SESSION = 2
MIN_PROMPT_CHARS = 40
TEXT_CAP = 4000
TOP_K = 10
POOL_K = 50
THRESHOLD = 0.6
G2_MIN_COSINE = 0.999
SECRET_RE = re.compile(r"(sk-[A-Za-z0-9_\-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|Bearer\s+[A-Za-z0-9._\-]{16,}"
                       r"|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9\-]{10,})")


def require(condition, code):
    if not condition:
        raise ValueError(code)


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def atomic_json(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, indent=2, ensure_ascii=False))
    tmp.replace(path)


def read_json(path):
    return json.loads(Path(path).read_text())


def redact(text):
    return SECRET_RE.sub("[redacted]", text)


# --- Scoring: a copy of searchInShard (src/services/turso/vector-search.ts) -------------

def cosine_similarity(a, b):
    """1 - cosine distance, clamped to [0, 1] as distanceToSimilarity does."""
    na = math.sqrt(sum(map(mul, a, a)))
    nb = math.sqrt(sum(map(mul, b, b)))
    if na == 0 or nb == 0:
        return 0.0
    value = sum(map(mul, a, b)) / (na * nb)
    return max(0.0, min(1.0, value))


def match_boost(query, tags_text):
    words = [w for w in re.split(r"[\s,]+", query.lower()) if len(w) > 1]
    tags = [t.strip().lower() for t in tags_text.split(",")]
    if not words or not tags:
        return 0.0
    hits = sum(1 for w in words if any(t in w or w in t for t in tags))
    return hits / max(len(words), 1)


def hybrid_score(content_sim, tags_sim, boost):
    return content_sim * 0.6 + max(tags_sim, boost) * 0.4


def rank_candidates(scores, k):
    """Top k by score; ties broken by id so reruns agree."""
    return sorted(scores, key=lambda s: (-s["score"], s["id"]))[:k]


def recall_at_k(returned, relevant):
    return len(set(returned) & relevant) / len(relevant) if relevant else None


def precision_at_k(returned, relevant):
    return len(set(returned) & relevant) / len(returned) if returned else None


# --- Data ---------------------------------------------------------------------------------

def load_memories(path):
    con = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    rows = con.execute(
        "SELECT id, content, tags, created_at, json_extract(metadata,'$.sessionID'), vector, tags_vector "
        "FROM memories ORDER BY created_at").fetchall()
    con.close()
    return [{"id": r[0], "content": r[1], "tags": r[2] or "", "created_at": r[3], "session": r[4],
             "vec": array("f", r[5]), "tags_vec": array("f", r[6]) if r[6] else None} for r in rows]


def embed(text):
    body = json.dumps({"model": EMBED_MODEL, "input": text}).encode()
    request = urllib.request.Request(EMBED_URL, data=body, headers={"Content-Type": "application/json"})
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    for attempt in range(3):
        try:
            with opener.open(request, timeout=300) as response:
                return array("f", json.load(response)["data"][0]["embedding"])
        except (OSError, ValueError, KeyError):
            if attempt == 2:
                raise
            time.sleep(2)


# --- Reranker server ----------------------------------------------------------------------

def rerank_http(path, value=None):
    body = json.dumps(value).encode() if value is not None else None
    request = urllib.request.Request(f"http://127.0.0.1:{PORT}{path}", data=body,
                                     headers={"Content-Type": "application/json"})
    with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(request, timeout=300) as r:
        return json.load(r)


class OwnedServer:
    """Own only this experiment's llama.cpp child on port 3008."""

    def __enter__(self):
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", PORT))
        env = {k: v for k, v in os.environ.items() if not k.startswith("LLAMA_ARG_") and k != "HF_TOKEN"}
        self.process = subprocess.Popen(
            [str(SERVER), "--model", str(GGUF), "--alias", "qwen3-reranker", "--port", str(PORT), *SERVER_ARGS],
            env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        started = time.monotonic()
        try:
            while time.monotonic() - started < 300:
                require(self.process.poll() is None, "server_start_failed")
                try:
                    if rerank_http("/health").get("status") == "ok":
                        return self
                except (OSError, ValueError):
                    pass
                time.sleep(0.5)
            raise ValueError("server_readiness_timeout")
        except BaseException:
            self.__exit__()
            raise

    def __exit__(self, *_):
        if self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(timeout=15)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait(timeout=15)


def rerank(query, documents):
    n = len(documents)
    started = time.monotonic()
    data = rerank_http("/v1/rerank", {"model": "qwen3-reranker", "query": query, "documents": documents,
                                      "top_n": n})
    results = data["results"]
    require(len(results) == n and sorted(r["index"] for r in results) == list(range(n)), "rerank_shape")
    scores = [0.0] * n
    for row in results:
        value = row["relevance_score"]
        require(isinstance(value, (int, float)) and math.isfinite(value), "invalid_score")
        scores[row["index"]] = float(value)
    return scores, time.monotonic() - started


# --- Phases -------------------------------------------------------------------------------

def phase_prepare():
    require(not (OUT / "sample.json").exists(), "already_prepared")
    SNAP.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(MEMORY_DB, SNAP / "memories.db")
    src = sqlite3.connect(f"file:{PROMPT_DB}?mode=ro", uri=True)
    dst = sqlite3.connect(SNAP / "user-prompts.db")
    src.backup(dst)
    src.close()
    dst.close()
    memories = load_memories(SNAP / "memories.db")
    require(len(memories) >= 1500, "memory_count")
    con = sqlite3.connect(f"file:{SNAP / 'user-prompts.db'}?mode=ro", uri=True)
    rows = con.execute(
        "SELECT id, session_id, content, created_at FROM user_prompts "
        "WHERE project_path LIKE '%/PROJECTS/omms%' AND length(content) >= ? ORDER BY created_at",
        (MIN_PROMPT_CHARS,)).fetchall()
    con.close()
    first_memory = memories[0]["created_at"]
    seen, candidates = set(), []
    for pid, session, content, created in rows:
        text = content.strip()
        if text.startswith("/") or "<private>" in text or text in seen or created <= first_memory:
            continue
        seen.add(text)
        candidates.append({"id": pid, "session": session, "created_at": created, "text": text})
    rng = random.Random(SEED)
    rng.shuffle(candidates)
    per_session, sample = {}, []
    for item in candidates:
        if per_session.get(item["session"], 0) >= MAX_PER_SESSION:
            continue
        per_session[item["session"]] = per_session.get(item["session"], 0) + 1
        sample.append(item)
        if len(sample) == N_PROMPTS:
            break
    require(len(sample) == N_PROMPTS, "sample_size")
    sample.sort(key=lambda s: s["created_at"])
    atomic_json(OUT / "sample.json", {
        "seed": SEED, "candidate_prompts": len(candidates), "prompts": sample,
        "snapshot_sha256": {"memories.db": sha256_file(SNAP / "memories.db"),
                            "user-prompts.db": sha256_file(SNAP / "user-prompts.db")}})
    print(f"prepared {len(sample)} prompts from {len(candidates)} candidates; {len(memories)} memories", flush=True)


def phase_check():
    sample = read_json(OUT / "sample.json")
    for name, expected in sample["snapshot_sha256"].items():
        require(sha256_file(SNAP / name) == expected, "snapshot_drift:" + name)
    require(GGUF.exists() and GGUF.stat().st_size == GGUF_BYTES and sha256_file(GGUF) == GGUF_SHA256, "gguf_drift")
    require(SERVER.exists() and sha256_file(SERVER) == SERVER_SHA256, "server_drift")
    memories = load_memories(SNAP / "memories.db")
    rng = random.Random(SEED)
    cosines = []
    for memory in rng.sample(memories, 5):
        cosines.append(cosine_similarity(embed(memory["content"][:TEXT_CAP]), memory["vec"]))
    passed = min(cosines) >= G2_MIN_COSINE
    atomic_json(OUT / "check.json", {"G1_integrity": "ok", "G2_cosines": cosines, "G2_pass": passed,
                                     "memory_count": len(memories)})
    print("G1 ok; G2 cosines", [round(c, 4) for c in cosines], "PASS" if passed else "FAIL", flush=True)
    require(passed, "G2_embedding_mismatch")


def score_prompt(prompt, memories, query_vec):
    eligible = [m for m in memories if m["created_at"] < prompt["created_at"] and m["session"] != prompt["session"]]
    scores = []
    for m in eligible:
        content_sim = cosine_similarity(query_vec, m["vec"])
        tags_sim = cosine_similarity(query_vec, m["tags_vec"]) if m["tags_vec"] else 0.0
        scores.append({"id": m["id"], "score": hybrid_score(content_sim, tags_sim, match_boost(prompt["text"], m["tags"]))})
    return eligible, scores


def phase_run(resume):
    sample = read_json(OUT / "sample.json")["prompts"]
    require(json.loads((OUT / "check.json").read_text())["G2_pass"], "G2_not_passed")
    memories = load_memories(SNAP / "memories.db")
    by_id = {m["id"]: m for m in memories}
    rows_path = OUT / "rows.jsonl"
    done = {json.loads(line)["prompt_id"] for line in rows_path.read_text().splitlines()} if resume and rows_path.exists() else set()
    if not resume and rows_path.exists():
        raise ValueError("rows_exist_use_resume")
    with OwnedServer():
        for index, prompt in enumerate(sample, 1):
            if prompt["id"] in done:
                continue
            query = prompt["text"][:TEXT_CAP]
            query_vec = embed(query)
            eligible, scores = score_prompt(prompt, memories, query_vec)
            a0 = rank_candidates(scores, TOP_K)
            arm_a = [s for s in a0 if s["score"] >= THRESHOLD]
            top50 = rank_candidates(scores, POOL_K)
            row = {"prompt_id": prompt["id"], "eligible": len(eligible),
                   "A": [s["id"] for s in arm_a], "A0": [s["id"] for s in a0],
                   "A_scores": [round(s["score"], 4) for s in arm_a], "status": "ok"}
            try:
                docs = [by_id[s["id"]]["content"][:TEXT_CAP] for s in top50]
                row["cut_docs"] = sum(1 for s in top50 if len(by_id[s["id"]]["content"]) > TEXT_CAP)
                rr, seconds = rerank(query, docs)
                order = sorted(range(len(top50)), key=lambda i: (-rr[i], top50[i]["id"]))[:TOP_K]
                row.update({"B": [top50[i]["id"] for i in order], "B_scores": [round(rr[i], 4) for i in order],
                            "rerank_seconds": seconds})
            except (OSError, ValueError, KeyError) as error:
                row.update({"status": "error", "error": type(error).__name__ + ":" + str(error)[:80], "B": []})
            with open(rows_path, "a") as handle:
                handle.write(json.dumps(row) + "\n")
            print(f"{index}/{len(sample)} prompts (A={len(row['A'])}, status={row['status']})", flush=True)
    require(sha256_file(GGUF) == GGUF_SHA256, "gguf_drift_after_run")


def phase_pool():
    sample = {p["id"]: p for p in read_json(OUT / "sample.json")["prompts"]}
    by_id = {m["id"]: m for m in load_memories(SNAP / "memories.db")}
    rows = [json.loads(line) for line in (OUT / "rows.jsonl").read_text().splitlines()]
    rng = random.Random(SEED)
    pairs = []
    for row in rows:
        for mid in sorted(set(row["A0"]) | set(row["B"])):
            pairs.append({"prompt_id": row["prompt_id"], "memory_id": mid})
    rng.shuffle(pairs)
    with open(OUT / "judge_input.jsonl", "w") as handle:
        for number, pair in enumerate(pairs, 1):
            pair["pair_id"] = f"p{number:04d}"
            handle.write(json.dumps({
                "pair_id": pair["pair_id"],
                "prompt": redact(sample[pair["prompt_id"]]["text"][:2000]),
                "memory": redact(by_id[pair["memory_id"]]["content"][:1500])}, ensure_ascii=False) + "\n")
    atomic_json(OUT / "pair_key.json", pairs)
    print(f"{len(pairs)} pairs written to judge_input.jsonl", flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--phase", required=True, choices=["prepare", "check", "run", "pool"])
    parser.add_argument("--resume", action="store_true")
    args = parser.parse_args()
    {"prepare": phase_prepare, "check": phase_check, "pool": phase_pool}.get(args.phase, lambda: phase_run(args.resume))()


if __name__ == "__main__":
    main()
