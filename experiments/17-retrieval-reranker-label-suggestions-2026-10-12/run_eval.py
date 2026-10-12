"""Experiment 17: Qwen3-Reranker-0.6B label suggestions against cosine, on the 140 test cases."""

import argparse
import hashlib
import importlib.util
import json
import math
import os
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
EXPERIMENTS = HERE.parent
OUT = HERE / "output"
EXP12 = EXPERIMENTS / "12-retrieval-neighbour-reuse-gate-2026-10-11"
EXP12_RUNNER_SHA256 = "10a458e9020e07b9b7fca10a41ebb348b8f5f21ce9586faa434291053d98444b"
VECTORS = EXPERIMENTS / "16-retrieval-neighbour-gate-qwen3-4b-2026-10-11/output/vectors-instruct.json"
VECTORS_SHA256 = "133623b9b2c3ee8db067b4dfac488cfa362cc17795edada55c5c647b7b588a97"
CLEF_MANIFEST = EXPERIMENTS / "03-pair-decisions-2026-10-10/corpus/clef-test-manifest.json"
CLEF_MANIFEST_SHA256 = "24918e90eea694464e58d6552d1cc4582dfd27f7b37ff664131f500e7fe53db6"
CORPUS = EXPERIMENTS / "01-label-decisions-2026-10-07/output/revision-01-batch8192/corpus"
REVISION = "a02f48bb4f057028298c21fa033da2b30d7742d5"
GGUF = (Path.home() / ".cache/huggingface/hub/models--ggml-org--Qwen3-Reranker-0.6B-Q8_0-GGUF/snapshots"
        / REVISION / "qwen3-reranker-0.6b-q8_0.gguf")
GGUF_SHA256 = "22c9979ce4fbcdc5acdc310c6641c32797eff1aa980b8f7a2db8a8ea23429a48"
GGUF_BYTES = 639153184
PORT = 3008
SERVER_ARGS = ["--reranking", "--ctx-size", "8192", "--batch-size", "8192", "--ubatch-size", "8192",
               "--parallel", "1", "--gpu-layers", "all", "--offline", "--log-disable", "--host", "127.0.0.1"]
SHORTLIST = 10
TARGET = 46
INTENT_PREFIX = "Find the one that expresses the same user preference or working pattern as this observation: "
VARIANTS = ("plain", "intent")
ROUTES = ("A", "B")


def load_experiment12():
    path = EXP12 / "run_eval.py"
    with open(path, "rb") as handle:
        if hashlib.file_digest(handle, "sha256").hexdigest() != EXP12_RUNNER_SHA256:
            raise ValueError("input_hash_drift")
    spec = importlib.util.spec_from_file_location("experiment12_readonly", path)
    module = importlib.util.module_from_spec(spec)
    previous = sys.dont_write_bytecode
    sys.dont_write_bytecode = True
    try:
        spec.loader.exec_module(module)
    finally:
        sys.dont_write_bytecode = previous
    return module


e12 = load_experiment12()
require = e12.require


def digest(payload):
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()


# --- World: cases, folds, shortlists -------------------------------------------------


def load_world():
    e12.check_pins()
    require(e12.file_hash(VECTORS) == VECTORS_SHA256, "input_hash_drift")
    require(e12.file_hash(CLEF_MANIFEST) == CLEF_MANIFEST_SHA256, "input_hash_drift")
    cases, _ = e12.load_inputs()
    saved = e12.read_json(VECTORS)["vectors"]
    require(set(saved) == set(cases), "vector_coverage")
    unit = {}
    for case_id, vector in saved.items():
        norm = math.sqrt(sum(v * v for v in vector))
        unit[case_id] = [v / norm for v in vector]
    sims = e12.similarity_matrix(cases, unit)
    fold_of = e12.assign_folds(cases)
    texts = {row["id"]: row["description"] for row in e12.read_json(CORPUS / "ground-truth.json")}
    labels = {l["id"]: l for l in e12.read_json(CORPUS / "catalogue.json")}
    for text in list(texts.values()) + [l["definition"] for l in labels.values()]:
        require("<private>" not in text.lower(), "private_text")
    return cases, sims, fold_of, texts, labels


def shortlist(case, cases, sims, fold_of, gallery=None):
    """The 10 nearest outer-gallery observations by cosine; refuses a member from the case's fold."""
    if gallery is None:
        gallery = sorted(c for c in cases if fold_of.get(c) != fold_of[case])
    ranked = e12.neighbours(case, gallery, cases, sims)[:SHORTLIST]
    for member in ranked:
        require(fold_of.get(member) != fold_of[case], "fold_leak")
    return ranked


def build_requests(world):
    cases, sims, fold_of, texts, labels = world
    requests = {}
    for case in sorted(fold_of):
        section = cases[case]["section"]
        members = shortlist(case, cases, sims, fold_of)
        section_labels = sorted(l for l in labels if labels[l]["section"] == section)
        for variant in VARIANTS:
            query = texts[case] if variant == "plain" else INTENT_PREFIX + texts[case]
            requests[f"A|{variant}|{case}"] = {
                "query": query, "documents": [texts[m] for m in members],
                "doc_labels": [cases[m]["label"] for m in members], "doc_ids": members}
            requests[f"B|{variant}|{case}"] = {
                "query": query, "documents": [labels[l]["definition"] for l in section_labels],
                "doc_labels": section_labels, "doc_ids": section_labels}
    return requests


# --- Suggestion rules and scoring ----------------------------------------------------


def order_by(scores):
    return sorted(range(len(scores)), key=lambda i: (-scores[i], i))


def suggestions(doc_labels, order, n=3):
    """First n distinct existing labels in the given order; none_fit members are skipped."""
    seen = []
    for i in order:
        label = doc_labels[i]
        if label != "none_fit" and label not in seen:
            seen.append(label)
        if len(seen) == n:
            break
    return seen


def score_route(rows, cases, test_ids):
    labelled = [c for c in test_ids if cases[c]["label"] != "none_fit"]
    top1 = sum(1 for c in labelled if rows[c]["top3"][:1] and rows[c]["top3"][0] in cases[c]["accept"])
    top3 = sum(1 for c in labelled if any(l in cases[c]["accept"] for l in rows[c]["top3"]))
    return {"labelled": len(labelled), "top1_correct": top1, "top3_correct": top3,
            "errors": sum(1 for c in test_ids if rows[c].get("error"))}


def safety_ceiling(rows, cases, test_ids):
    """Exploratory: most correct picks before the first wrong one, ranking by top score."""
    ranked = sorted((c for c in test_ids if rows[c]["top3"] and not rows[c].get("error")),
                    key=lambda c: (-rows[c]["top_score"], c))
    correct = 0
    for c in ranked:
        if cases[c]["label"] == "none_fit" or rows[c]["top3"][0] not in cases[c]["accept"]:
            break
        correct += 1
    return correct


def route_rows(scores, requests, route, variant, test_ids):
    rows = {}
    for c in test_ids:
        request, saved = requests[f"{route}|{variant}|{c}"], scores[f"{route}|{variant}|{c}"]
        if saved.get("status") != "ok":
            rows[c] = {"top3": [], "top_score": None, "error": True}
            continue
        order = order_by(saved["scores"])
        rows[c] = {"top3": suggestions(request["doc_labels"], order),
                   "top_score": saved["scores"][order[0]],
                   "first_is_none_fit": request["doc_labels"][order[0]] == "none_fit"}
    return rows


def summarise(scores, requests, cases, test_ids):
    cosine = {c: {"top3": suggestions(requests[f"A|plain|{c}"]["doc_labels"], list(range(SHORTLIST)))}
              for c in test_ids}
    summary = {"cosine_baseline": score_route(cosine, cases, test_ids), "routes": {}, "exploratory": {}}
    labelled = [c for c in test_ids if cases[c]["label"] != "none_fit"]
    summary["shortlist_coverage"] = sum(
        1 for c in labelled if any(l in cases[c]["accept"] for l in requests[f"A|plain|{c}"]["doc_labels"]))
    none_cases = [c for c in test_ids if cases[c]["label"] == "none_fit"]
    for variant in VARIANTS:
        for route in ROUTES:
            rows = route_rows(scores, requests, route, variant, test_ids)
            result = score_route(rows, cases, test_ids)
            result["seconds_per_item"] = sum(scores[f"{route}|{variant}|{c}"].get("duration_seconds", 0)
                                             for c in test_ids) / len(test_ids)
            result["safety_ceiling"] = safety_ceiling(rows, cases, test_ids)
            if route == "A":
                result["first_is_none_fit_on_none_fit_cases"] = sum(
                    1 for c in none_cases if rows[c].get("first_is_none_fit"))
                result["paired_vs_cosine"] = {
                    "only_reranker_right": sum(1 for c in labelled if rows[c]["top3"][:1] and rows[c]["top3"][0] in cases[c]["accept"]
                                               and not (cosine[c]["top3"][:1] and cosine[c]["top3"][0] in cases[c]["accept"])),
                    "only_cosine_right": sum(1 for c in labelled if cosine[c]["top3"][:1] and cosine[c]["top3"][0] in cases[c]["accept"]
                                             and not (rows[c]["top3"][:1] and rows[c]["top3"][0] in cases[c]["accept"]))}
            (summary["routes"] if variant == "plain" else summary["exploratory"])[f"{route}|{variant}"] = result
    best = max(summary["routes"][f"{r}|plain"]["top1_correct"] for r in ROUTES)
    summary["h1"] = {"best_top1": best, "target": TARGET, "holds": best >= TARGET}
    summary["gates"] = {"G2_completeness": all(summary["routes"][f"{r}|plain"]["errors"] == 0 for r in ROUTES)}
    return e12.normalised(summary)


# --- Model file and owned server -----------------------------------------------------


def verify_gguf(path=GGUF):
    require(path.exists() and path.stat().st_size == GGUF_BYTES and e12.file_hash(path) == GGUF_SHA256,
            "gguf_drift")


def server_binary():
    model = e12.read_json(CLEF_MANIFEST)["model"]
    path = Path(model["server_path"])
    require(not path.is_symlink() and e12.file_hash(path) == model["server_sha256"], "server_drift")
    return path


def launch_args():
    return ["--model", str(GGUF), "--alias", "qwen3-reranker", "--port", str(PORT), *SERVER_ARGS]


def http(path, value=None):
    body = json.dumps(value).encode() if value is not None else None
    request = urllib.request.Request(f"http://127.0.0.1:{PORT}{path}", data=body,
                                     headers={"Content-Type": "application/json"})
    with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(request, timeout=300) as r:
        return json.load(r)


def parse_rerank(data, n):
    results = data["results"]
    require(len(results) == n and sorted(r["index"] for r in results) == list(range(n)), "rerank_shape")
    scores = [None] * n
    for row in results:
        value = row["relevance_score"]
        require(type(value) in (int, float) and math.isfinite(value), "invalid_score")
        scores[row["index"]] = float(value)
    return scores


def call(request):
    started = time.monotonic()
    n = len(request["documents"])
    try:
        data = http("/v1/rerank", {"model": "qwen3-reranker", "query": request["query"],
                                   "documents": request["documents"], "top_n": n})
        return {"status": "ok", "scores": parse_rerank(data, n), "duration_seconds": time.monotonic() - started}
    except (ValueError, KeyError, TypeError, OSError) as error:
        return {"status": "error", "error_code": type(error).__name__ + ":" + str(error)[:60],
                "duration_seconds": time.monotonic() - started}


class OwnedServer:
    """Own only this experiment's llama.cpp child on port 3008."""

    def __enter__(self):
        with socket.socket() as check:
            check.bind(("127.0.0.1", PORT))
        env = {k: v for k, v in os.environ.items() if not k.startswith("LLAMA_ARG_") and k != "HF_TOKEN"}
        self.process = subprocess.Popen([str(server_binary()), *launch_args()], env=env,
                                        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        started = time.monotonic()
        try:
            while time.monotonic() - started < 300:
                require(self.process.poll() is None, "server_start_failed")
                try:
                    if http("/health").get("status") == "ok":
                        return self
                except (OSError, ValueError):
                    pass
                time.sleep(0.5)
            raise ValueError("server_readiness_timeout")
        except BaseException:
            self.__exit__()
            raise

    def __exit__(self, *args):
        if self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(timeout=15)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait(timeout=15)


def template_note():
    props = json.dumps(http("/props"))
    return {"props_sha256": hashlib.sha256(props.encode()).hexdigest(),
            "mentions_web_search": "web search" in props.lower()}


# --- Phases --------------------------------------------------------------------------


def execute(phase, resume=False):
    world = load_world()
    cases, fold_of = world[0], world[2]
    test_ids = sorted(fold_of)
    requests = build_requests(world)
    path = OUT / "scores.json"
    if phase == "verify":
        scores = e12.read_json(path)
        for key, request in requests.items():
            require(scores[key]["request_sha256"] == digest(request), "request_mismatch")
        require(e12.read_json(OUT / "summary.json") == summarise(scores, requests, cases, test_ids),
                "summary_mismatch")
        e12.check_pins()
        print("Verified requests and summary; zero writes; no server", flush=True)
        return
    verify_gguf()
    scores = e12.read_json(path) if resume and path.exists() else {}
    pending = [k for k, r in requests.items()
               if not (k in scores and scores[k].get("request_sha256") == digest(r) and scores[k]["status"] == "ok")]
    note = None
    with OwnedServer():
        note = template_note()
        for index, key in enumerate(pending, 1):
            scores[key] = {**call(requests[key]), "request_sha256": digest(requests[key])}
            if index % 50 == 0 or index == len(pending):
                e12.atomic_json(path, scores)
                print(f"{index}/{len(pending)} reranks", flush=True)
    verify_gguf()
    summary = summarise(scores, requests, cases, test_ids)
    e12.atomic_json(OUT / "summary.json", summary)
    e12.atomic_json(OUT / "run-manifest.json", {
        "runner_sha256": e12.file_hash(Path(__file__)), "gguf_sha256": GGUF_SHA256, "revision": REVISION,
        "server_args": SERVER_ARGS, "template": note,
        "outputs": {n: e12.file_hash(OUT / n) for n in ("scores.json", "summary.json")}})
    e12.check_pins()
    print(f"cosine baseline: {summary['cosine_baseline']}", flush=True)
    for key, r in {**summary["routes"], **summary["exploratory"]}.items():
        print(f"{key}: top1={r['top1_correct']}/{r['labelled']} top3={r['top3_correct']} "
              f"errors={r['errors']} sec/item={r['seconds_per_item']:.3f} ceiling={r['safety_ceiling']}", flush=True)
    print(f"H1: {summary['h1']}; coverage={summary['shortlist_coverage']}; template={note}", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--phase", choices=("run", "verify"), required=True)
    parser.add_argument("--resume", action="store_true")
    args = parser.parse_args()
    execute(args.phase, args.resume)
