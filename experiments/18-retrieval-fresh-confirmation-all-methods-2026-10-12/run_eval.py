"""Experiment 18: run cosine, reranker and Clef together on 400 fresh observations, then score H1 to H4."""

import argparse
import hashlib
import importlib.util
import json
import math
import sys
from math import comb
from pathlib import Path

HERE = Path(__file__).resolve().parent
EXPERIMENTS = HERE.parent
CORPUS = HERE / "corpus"
OUT = HERE / "output"
RUNNERS = {
    "e15": ("15-retrieval-clef-intent-select-2026-10-11/run_eval.py",
            "bd370edb5cb13123628bb20e23ed99474b95e2304610911e67b0f24ea791ba10"),
    "e16": ("16-retrieval-neighbour-gate-qwen3-4b-2026-10-11/run_eval.py",
            "1ae069a177cf47e2231570103b8287eee5219fbae40c081ad9695788d8b3824c"),
    "e17": ("17-retrieval-reranker-label-suggestions-2026-10-12/run_eval.py",
            "3fc38f0fc78227633b2bdaa3133d2c3e5de7741f4f736159626b8032bb34ab38"),
}
GALLERY_VECTORS = EXPERIMENTS / "16-retrieval-neighbour-gate-qwen3-4b-2026-10-11/output/vectors-instruct.json"
GALLERY_VECTORS_SHA256 = "133623b9b2c3ee8db067b4dfac488cfa362cc17795edada55c5c647b7b588a97"
SHORTLIST = 10
LABEL_EXAMPLES, NONE_EXAMPLES = 2, 3
H1_MIN, H2_MIN, H4_MAX_UPPER = 0.85, 0.90, 0.05
METHODS = ("cosine", "reranker", "clef")


def load_runner(key):
    relative, expected = RUNNERS[key]
    path = EXPERIMENTS / relative
    with open(path, "rb") as handle:
        if hashlib.file_digest(handle, "sha256").hexdigest() != expected:
            raise ValueError("input_hash_drift")
    spec = importlib.util.spec_from_file_location(f"experiment18_{key}", path)
    module = importlib.util.module_from_spec(spec)
    previous = sys.dont_write_bytecode
    sys.dont_write_bytecode = True
    try:
        spec.loader.exec_module(module)
    finally:
        sys.dont_write_bytecode = previous
    return module


e15, e16, e17 = load_runner("e15"), load_runner("e16"), load_runner("e17")
e12 = e15.e12
require, read_json, file_hash = e12.require, e12.read_json, e12.file_hash


def digest(payload):
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()


# --- Inputs --------------------------------------------------------------------------


def load_world():
    """Gallery (old 200 labelled cases), fresh cases and the frozen reference."""
    e12.check_pins()
    manifest = read_json(OUT / "reference-manifest.json")
    require(file_hash(CORPUS / "fresh-reference.json") == manifest["reference_sha256"], "reference_not_frozen")
    require(file_hash(GALLERY_VECTORS) == GALLERY_VECTORS_SHA256, "input_hash_drift")
    gallery, _ = e12.load_inputs()
    vectors = read_json(GALLERY_VECTORS)["vectors"]
    require(set(vectors) == set(gallery), "vector_coverage")
    corpus = e12.read_json(EXPERIMENTS / "01-label-decisions-2026-10-07/output/revision-01-batch8192/corpus/ground-truth.json")
    texts = {row["id"]: row["description"] for row in corpus}
    fresh = {c["id"]: c for c in read_json(CORPUS / "fresh-cases.json")["cases"]}
    require(len(fresh) == 400 and not set(fresh) & set(gallery), "fresh_overlap")
    reference = {k: v["label"] for k, v in read_json(CORPUS / "fresh-reference.json")["decisions"].items()}
    require(set(reference) == set(fresh), "reference_coverage")
    labels = {l["id"]: l for l in read_json(CORPUS / "label-input.json")["catalogue"]}
    return {"gallery": gallery, "gallery_vectors": {k: unit(v) for k, v in vectors.items()},
            "texts": texts, "fresh": fresh, "reference": reference, "labels": labels}


def unit(vector):
    norm = math.sqrt(sum(v * v for v in vector))
    return [v / norm for v in vector]


def ranked_gallery(fresh_vector, section, world):
    """Same-section gallery cases, most similar first; ties by id."""
    members = [g for g, c in world["gallery"].items() if c["section"] == section]
    sims = {g: sum(a * b for a, b in zip(fresh_vector, world["gallery_vectors"][g])) for g in members}
    return sorted(members, key=lambda g: (-sims[g], g)), sims


def first_labels(ranked, gallery, n=3):
    seen = []
    for member in ranked:
        label = gallery[member]["label"]
        if label != "none_fit" and label not in seen:
            seen.append(label)
        if len(seen) == n:
            break
    return seen


def clef_payload(case, ranked, world):
    """Experiment 15's request shape, with examples from the old gallery only."""
    gallery, labels = world["gallery"], world["labels"]
    chosen = {}
    for member in ranked:
        require(member in gallery, "fresh_in_gallery")
        label = gallery[member]["label"]
        limit = NONE_EXAMPLES if label == "none_fit" else LABEL_EXAMPLES
        if len(chosen.setdefault(label, [])) < limit:
            chosen[label].append(member)
    ids = sorted(l for l in labels if labels[l]["section"] == case["section"]) + ["none_fit"]
    criteria = {}
    for option in ids:
        if option == "none_fit":
            criteria[option] = e15.option_text(e15.NONE_TEXT, chosen.get("none_fit", []), world["texts"],
                                               "Past observations that matched no label")
        else:
            criteria[option] = e15.option_text(labels[option]["definition"], chosen.get(option, []),
                                               world["texts"], "Past observations filed under this label")
    return {"model": "clef-flash", "state": {"description": case["description"], "section": case["section"]},
            "questions": {"decision": {"type": "choice", "instructions": e15.QUESTION, "criteria": criteria}}}


def reranker_request(case, labels):
    ids = sorted(l for l in labels if labels[l]["section"] == case["section"])
    return {"query": case["description"], "documents": [labels[l]["definition"] for l in ids], "doc_labels": ids}


# --- Statistics ----------------------------------------------------------------------


def binomial_tail_le(n, k, p):
    return sum(comb(n, i) * p**i * (1 - p) ** (n - i) for i in range(k + 1))


def interval(k, n, alpha=0.05):
    """Exact two-sided Clopper-Pearson interval."""
    if n == 0:
        return [None, None]
    def solve(test):
        lo, hi = 0.0, 1.0
        for _ in range(80):
            mid = (lo + hi) / 2
            lo, hi = (mid, hi) if test(mid) else (lo, mid)
        return (lo + hi) / 2
    lower = 0.0 if k == 0 else solve(lambda p: 1 - binomial_tail_le(n, k - 1, p) < alpha / 2)
    upper = 1.0 if k == n else solve(lambda p: binomial_tail_le(n, k, p) > alpha / 2)
    return [lower, upper]


def sign_test(wins, losses):
    n = wins + losses
    if n == 0:
        return 1.0
    return min(1.0, 2 * sum(comb(n, i) for i in range(min(wins, losses) + 1)) / 2**n)


# --- Scoring -------------------------------------------------------------------------


def summarise(answers, world):
    reference = world["reference"]
    labelled = sorted(c for c, r in reference.items() if r not in ("none_fit", "uncertain", "disputed"))
    none_cases = sorted(c for c, r in reference.items() if r == "none_fit")
    picks = {c: {"cosine": answers[c]["cosine"]["top3"][0] if answers[c]["cosine"]["top3"] else None,
                 "reranker": answers[c]["reranker"]["top3"][0] if answers[c]["reranker"]["top3"] else None,
                 "clef": answers[c]["clef"]["pick"]} for c in reference}
    right = lambda label, c: label is not None and label == reference[c]

    union = sum(any(right(picks[c][m], c) for m in METHODS) for c in labelled)
    agree = [c for c in labelled if picks[c]["cosine"] is not None and len({picks[c][m] for m in METHODS}) == 1]
    agree_right = sum(right(picks[c]["cosine"], c) for c in agree)
    agree_none = [c for c in none_cases if picks[c]["cosine"] is not None and len({picks[c][m] for m in METHODS}) == 1]

    first = {m: sum(right(picks[c][m], c) for c in labelled) for m in METHODS}
    vote = {}
    for c in reference:
        votes = [picks[c][m] for m in METHODS if picks[c][m] is not None]
        vote[c] = max(set(votes), key=lambda l: (votes.count(l), l == picks[c]["clef"])) if votes else None
    first["vote"] = sum(right(vote[c], c) for c in labelled)

    def pick_of(name, c):
        return vote[c] if name == "vote" else picks[c][name]

    def paired(a, b):
        wins = sum(right(pick_of(a, c), c) and not right(pick_of(b, c), c) for c in labelled)
        losses = sum(right(pick_of(b, c), c) and not right(pick_of(a, c), c) for c in labelled)
        return {"wins": wins, "losses": losses, "p": sign_test(wins, losses)}

    accepted = agree + agree_none
    wrong = sum(not right(picks[c]["cosine"], c) for c in accepted)
    upper = e12.upper_bound(len(accepted), wrong)
    n = len(labelled)
    return e12.normalised({
        "reference_counts": {"labelled": n, "none_fit": len(none_cases),
                             "excluded": len(reference) - n - len(none_cases)},
        "H1": {"union_right": union, "n": n, "rate": union / n if n else None, "ci95": interval(union, n),
               "threshold": H1_MIN, "holds": bool(n) and union / n >= H1_MIN},
        "H2": {"agree": len(agree), "agree_right": agree_right,
               "rate": agree_right / len(agree) if agree else None, "ci95": interval(agree_right, len(agree)),
               "threshold": H2_MIN, "holds": bool(agree) and agree_right / len(agree) >= H2_MIN,
               "agree_on_none_fit": len(agree_none)},
        "H3": {"first_pick_right": first, "ci95": {m: interval(v, n) for m, v in first.items()},
               "paired": {"clef_vs_cosine": paired("clef", "cosine"), "clef_vs_reranker": paired("clef", "reranker"),
                          "reranker_vs_cosine": paired("reranker", "cosine"), "vote_vs_clef": paired("vote", "clef")}},
        "H4": {"accepted": len(accepted), "wrong": wrong, "upper95": upper, "max_upper": H4_MAX_UPPER,
               "holds": upper is not None and upper <= H4_MAX_UPPER},
        "clef_none_fit_recognition": {"none_fit_cases": len(none_cases),
                                      "clef_said_none_fit": sum(picks[c]["clef"] is None for c in none_cases)},
        "top3_right": {"cosine": sum(reference[c] in answers[c]["cosine"]["top3"] for c in labelled),
                       "reranker": sum(reference[c] in answers[c]["reranker"]["top3"] for c in labelled)},
        "errors": {m: sum(1 for c in reference if answers[c][m].get("error")) for m in METHODS},
        "seconds_per_item": {m: sum(answers[c][m].get("seconds", 0) for c in reference) / len(reference)
                             for m in METHODS},
    })


# --- Phases --------------------------------------------------------------------------


def embed_fresh(world, resume):
    path = OUT / "fresh-vectors.json"
    texts = {c: e16.embed_text(case["description"], "instruct") for c, case in world["fresh"].items()}
    if resume and path.exists() and read_json(path).get("inputs_sha256") == digest(texts):
        return read_json(path)["vectors"]
    e16.ensure_gguf()
    ids = sorted(texts)
    vectors = {}
    with e16.OwnedServer():
        for start in range(0, len(ids), 16):
            chunk = ids[start:start + 16]
            for c, v in zip(chunk, e16.llama_embed([texts[x] for x in chunk])):
                vectors[c] = v
    e12.atomic_json(path, {"inputs_sha256": digest(texts), "vectors": vectors})
    return vectors


def build_requests(world, fresh_vectors):
    requests = {}
    for c, case in world["fresh"].items():
        ranked, _ = ranked_gallery(unit(fresh_vectors[c]), case["section"], world)
        requests[c] = {"shortlist": ranked[:SHORTLIST], "reranker": reranker_request(case, world["labels"]),
                       "clef": clef_payload(case, ranked, world)}
    return requests


def score_answers(requests, raw, world):
    answers = {}
    for c, req in requests.items():
        rr, cl = raw["reranker"][c], raw["clef"][c]
        rer = ({"top3": [req["reranker"]["doc_labels"][i] for i in e17.order_by(rr["scores"])[:3]],
                "seconds": rr["duration_seconds"]} if rr["status"] == "ok"
               else {"top3": [], "error": True, "seconds": rr["duration_seconds"]})
        clef = ({"pick": None if cl["choice"] == "none_fit" else cl["choice"],
                 "p": cl["probabilities"][cl["choice"]], "seconds": cl["duration_seconds"]} if cl["status"] == "ok"
                else {"pick": None, "error": True, "seconds": cl["duration_seconds"]})
        answers[c] = {"cosine": {"top3": first_labels(req["shortlist"], world["gallery"]), "seconds": 0.0},
                      "reranker": rer, "clef": clef}
    return answers


def execute(phase, resume=False):
    world = load_world()
    raw_path = OUT / "raw.json"
    if phase == "verify":
        raw = read_json(raw_path)
        requests = build_requests(world, read_json(OUT / "fresh-vectors.json")["vectors"])
        for c, req in requests.items():
            require(raw["reranker"][c]["request_sha256"] == digest(req["reranker"]), "request_mismatch")
            require(raw["clef"][c]["request_sha256"] == digest(req["clef"]), "request_mismatch")
        summary = summarise(score_answers(requests, raw, world), world)
        require(read_json(OUT / "summary.json") == summary, "summary_mismatch")
        e12.check_pins()
        print("Verified requests and summary; zero writes; no servers", flush=True)
        return
    requests = build_requests(world, embed_fresh(world, resume))
    raw = read_json(raw_path) if resume and raw_path.exists() else {"reranker": {}, "clef": {}}

    def pending(kind):
        return [c for c, req in requests.items()
                if not (c in raw[kind] and raw[kind][c].get("request_sha256") == digest(req[kind])
                        and raw[kind][c]["status"] == "ok")]

    if pending("reranker"):
        e17.verify_gguf()
        with e17.OwnedServer():
            for c in pending("reranker"):
                req = requests[c]["reranker"]
                raw["reranker"][c] = {**e17.call({"query": req["query"], "documents": req["documents"]}),
                                      "request_sha256": digest(req)}
        e12.atomic_json(raw_path, raw)
    todo = pending("clef")
    if todo:
        model = e15.clef_model()
        e15.verify_clef_runtime(model)
        with e15.OwnedServer(model) as server:
            server.preflight()
            for index, c in enumerate(todo, 1):
                raw["clef"][c] = {**e15.call(requests[c]["clef"]), "request_sha256": digest(requests[c]["clef"])}
                if index % 20 == 0 or index == len(todo):
                    e12.atomic_json(raw_path, raw)
                    print(f"clef {index}/{len(todo)}", flush=True)
        e15.verify_clef_runtime(model)
    summary = summarise(score_answers(requests, raw, world), world)
    e12.atomic_json(OUT / "summary.json", summary)
    e12.atomic_json(OUT / "run-manifest.json", {
        "runner_sha256": file_hash(Path(__file__)), "reused_runners": {k: v[1] for k, v in RUNNERS.items()},
        "reference_sha256": read_json(OUT / "reference-manifest.json")["reference_sha256"],
        "outputs": {n: file_hash(OUT / n) for n in ("fresh-vectors.json", "raw.json", "summary.json")}})
    e12.check_pins()
    for key in ("reference_counts", "H1", "H2", "H3", "H4", "clef_none_fit_recognition", "errors"):
        print(key, json.dumps(summary[key]), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--phase", choices=("run", "verify"), required=True)
    parser.add_argument("--resume", action="store_true")
    args = parser.parse_args()
    execute(args.phase, args.resume)
