"""Experiment 20: Clef on 200 new observations with catalogue version 2; score H1 to H3."""

import argparse
import hashlib
import importlib.util
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
EXPERIMENTS = HERE.parent
CORPUS = HERE / "corpus"
OUT = HERE / "output"
E18 = EXPERIMENTS / "18-retrieval-fresh-confirmation-all-methods-2026-10-12"
E19 = EXPERIMENTS / "19-review-catalogue-v2-candidates-2026-10-12"
E18_RUNNER_SHA256 = "acbe4aa0362757eb4f2963ca31dd1c892d77f7a497dab7ca1595d49309ed8ee6"
PINS = {
    E18 / "output/fresh-vectors.json": "17109071e0659155062cb77c179aa4486f04cf96401fcbb92c46fb0cdfb5e544",
    E18 / "corpus/fresh-reference.json": "906eb69719c245d7727e58ac7fa858f9bf3f083979e9c0c3a06c57d5d3749925",
    E18 / "corpus/fresh-cases.json": "7d89a84610b5cd9b6ccc24b149c81a2a4e7cc6d9bc8c1b6b6b8d03def391e940",
    E19 / "output/catalogue-v2.json": "7f393d3c4e989d1dbc40e14200db4119295e913faa38f31b99a539a9920dc45b",
    E19 / "corpus/v2-members.json": "8444c343eb89e0f41b7497a9b5893733264ba11f63f898af25583aa759a935c0",
}
H1_MAX_NONE_SHARE = 0.35
H2_MIN_TOP3 = 0.90


def load_e18():
    path = E18 / "run_eval.py"
    with open(path, "rb") as handle:
        if hashlib.file_digest(handle, "sha256").hexdigest() != E18_RUNNER_SHA256:
            raise ValueError("input_hash_drift")
    spec = importlib.util.spec_from_file_location("experiment20_e18", path)
    module = importlib.util.module_from_spec(spec)
    previous = sys.dont_write_bytecode
    sys.dont_write_bytecode = True
    try:
        spec.loader.exec_module(module)
    finally:
        sys.dont_write_bytecode = previous
    return module


e18 = load_e18()
e12, e15, e16 = e18.e12, e18.e15, e18.e16
require, read_json, file_hash = e12.require, e12.read_json, e12.file_hash


def check_pins():
    e12.check_pins()
    for path, expected in PINS.items():
        require(file_hash(path) == expected, "input_hash_drift")


def build_gallery(old_cases, old_texts, e18_cases, e18_reference, members):
    """Old 200 keep their labels; Experiment 18 cases map to version 2; disputed cases are left out."""
    gallery = {k: {"label": c["label"], "section": c["section"]} for k, c in old_cases.items()}
    texts = {k: old_texts[k] for k in old_cases}
    for k, case in e18_cases.items():
        label = e18_reference[k]
        if label in ("disputed", "uncertain"):
            continue
        if label == "none_fit" and k in members:
            label = members[k]
        gallery[k] = {"label": label, "section": case["section"]}
        texts[k] = case["description"]
    return gallery, texts


def load_world():
    check_pins()
    manifest = read_json(OUT / "reference-manifest.json")
    require(file_hash(CORPUS / "reference.json") == manifest["reference_sha256"], "reference_not_frozen")
    old_cases, _ = e12.load_inputs()
    corpus = read_json(EXPERIMENTS / "01-label-decisions-2026-10-07/output/revision-01-batch8192/corpus/ground-truth.json")
    old_texts = {r["id"]: r["description"] for r in corpus}
    e18_cases = {c["id"]: c for c in read_json(E18 / "corpus/fresh-cases.json")["cases"]}
    e18_reference = {k: v["label"] for k, v in read_json(E18 / "corpus/fresh-reference.json")["decisions"].items()}
    members = read_json(E19 / "corpus/v2-members.json")["members"]
    gallery, texts = build_gallery(old_cases, old_texts, e18_cases, e18_reference, members)
    vectors = dict(read_json(e18.GALLERY_VECTORS)["vectors"])
    vectors.update(read_json(E18 / "output/fresh-vectors.json")["vectors"])
    labels = {l["id"]: l for l in read_json(E19 / "output/catalogue-v2.json")["labels"]}
    new = {c["id"]: c for c in read_json(CORPUS / "new-cases.json")["cases"]}
    require(not set(new) & set(gallery), "new_in_gallery")
    reference = {k: v["label"] for k, v in read_json(CORPUS / "reference.json")["decisions"].items()}
    require(set(reference) == set(new), "reference_coverage")
    return {"gallery": gallery, "texts": texts, "labels": labels, "new": new, "reference": reference,
            "gallery_vectors": {k: e18.unit(vectors[k]) for k in gallery}}


def clef_top(probabilities, n=3):
    return [l for l, _ in sorted(probabilities.items(), key=lambda kv: (-kv[1], kv[0])) if l != "none_fit"][:n]


def summarise(raw, world, new_labels):
    reference = world["reference"]
    scored = [c for c, r in reference.items() if r not in ("disputed", "uncertain")]
    labelled = [c for c in scored if reference[c] != "none_fit"]
    none_cases = [c for c in scored if reference[c] == "none_fit"]
    ok = {c: raw[c] for c in scored if raw[c].get("status") == "ok"}
    top3 = sum(1 for c in labelled if c in ok and reference[c] in clef_top(ok[c]["probabilities"]))
    first = sum(1 for c in labelled if c in ok and ok[c]["choice"] == reference[c])
    said_none = sum(1 for c in none_cases if c in ok and ok[c]["choice"] == "none_fit")
    new_cases = [c for c in labelled if reference[c] in new_labels]
    n, s = len(labelled), len(scored)
    return e12.normalised({
        "counts": {"scored": s, "labelled": n, "none_fit": len(none_cases), "excluded": len(reference) - s,
                   "errors": sum(1 for c in scored if raw[c].get("status") != "ok")},
        "H1": {"none_fit": len(none_cases), "scored": s, "share": len(none_cases) / s if s else None,
               "ci95": e18.interval(len(none_cases), s), "max": H1_MAX_NONE_SHARE,
               "holds": bool(s) and len(none_cases) / s <= H1_MAX_NONE_SHARE,
               "experiment18_v1_share": 195 / 392},
        "H2": {"top3_right": top3, "labelled": n, "rate": top3 / n if n else None, "ci95": e18.interval(top3, n),
               "min": H2_MIN_TOP3, "holds": bool(n) and top3 / n >= H2_MIN_TOP3},
        "H3": {"first_pick_right": first, "first_pick_rate": first / n if n else None,
               "ci95": e18.interval(first, n),
               "none_fit_recognised": said_none, "none_fit_cases": len(none_cases),
               "labelled_with_new_label": len(new_cases),
               "new_label_top3_right": sum(1 for c in new_cases if c in ok and reference[c] in clef_top(ok[c]["probabilities"]))},
        "seconds_per_item": sum(raw[c].get("duration_seconds", 0) for c in reference) / len(reference),
    })


def build_requests(world, vectors):
    requests = {}
    for c, case in world["new"].items():
        ranked, _ = e18.ranked_gallery(e18.unit(vectors[c]), case["section"], world)
        requests[c] = e18.clef_payload(case, ranked, world)
    return requests


def embed_new(world, resume):
    path = OUT / "new-vectors.json"
    texts = {c: e16.embed_text(case["description"], "instruct") for c, case in world["new"].items()}
    if resume and path.exists() and read_json(path).get("inputs_sha256") == e18.digest(texts):
        return read_json(path)["vectors"]
    e16.ensure_gguf()
    ids = sorted(texts)
    vectors = {}
    with e16.OwnedServer():
        for start in range(0, len(ids), 16):
            chunk = ids[start:start + 16]
            vectors.update(zip(chunk, e16.llama_embed([texts[x] for x in chunk])))
    e12.atomic_json(path, {"inputs_sha256": e18.digest(texts), "vectors": vectors})
    return vectors


def execute(phase, resume=False):
    world = load_world()
    new_labels = set(read_json(E19 / "output/catalogue-v2.json")["accepted"])
    raw_path = OUT / "raw.json"
    if phase == "verify":
        raw = read_json(raw_path)
        requests = build_requests(world, read_json(OUT / "new-vectors.json")["vectors"])
        for c, payload in requests.items():
            require(raw[c]["request_sha256"] == e18.digest(payload), "request_mismatch")
        require(read_json(OUT / "summary.json") == summarise(raw, world, new_labels), "summary_mismatch")
        check_pins()
        print("Verified requests and summary; zero writes; no servers", flush=True)
        return
    requests = build_requests(world, embed_new(world, resume))
    raw = read_json(raw_path) if resume and raw_path.exists() else {}
    todo = [c for c, p in requests.items()
            if not (c in raw and raw[c].get("request_sha256") == e18.digest(p) and raw[c]["status"] == "ok")]
    if todo:
        model = e15.clef_model()
        e15.verify_clef_runtime(model)
        with e15.OwnedServer(model) as server:
            server.preflight()
            for index, c in enumerate(todo, 1):
                raw[c] = {**e15.call(requests[c]), "request_sha256": e18.digest(requests[c])}
                if index % 20 == 0 or index == len(todo):
                    e12.atomic_json(raw_path, raw)
                    print(f"clef {index}/{len(todo)}", flush=True)
        e15.verify_clef_runtime(model)
    summary = summarise(raw, world, new_labels)
    e12.atomic_json(OUT / "summary.json", summary)
    e12.atomic_json(OUT / "run-manifest.json", {
        "runner_sha256": file_hash(Path(__file__)), "e18_runner_sha256": E18_RUNNER_SHA256,
        "reference_sha256": read_json(OUT / "reference-manifest.json")["reference_sha256"],
        "outputs": {n: file_hash(OUT / n) for n in ("new-vectors.json", "raw.json", "summary.json")}})
    check_pins()
    for key in ("counts", "H1", "H2", "H3"):
        print(key, json.dumps(summary[key]), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--phase", choices=("run", "verify"), required=True)
    parser.add_argument("--resume", action="store_true")
    args = parser.parse_args()
    execute(args.phase, args.resume)
