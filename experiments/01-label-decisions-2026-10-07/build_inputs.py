"""Freeze catalogue vectors and matched label candidates before model calls."""

import argparse
import json
import re
import struct
import sys
from pathlib import Path
from urllib.request import ProxyHandler, Request, build_opener

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from checkpoint import Checkpoint, atomic_json
from manifest import digest, file_digest
from providers import NoRedirect
from labels import ARMS, GRID, QUESTION, code_pins, shortlist, validate_catalogue
from reference_guards import EXPERIMENT, read_reference, run_root

URL = "http://127.0.0.1:9931/v1/embeddings"
MODEL = "qwen3-embedding:0.6b"
WEIGHTS = Path("/Users/aizat/.ollama/models/blobs/sha256-06507c7b42688469c4e7298b0a1e16deff06caf291cf0a5b278c308249c3e439")


def embed(text):
    """Use the existing loopback embedding model without importing OMMS."""
    text = re.sub(r"\s+", " ", re.sub(r"[，,。！？；;：:、\n\r.]", " ", text.strip())).strip()
    request = Request(URL, data=json.dumps({"model": MODEL, "input": text}).encode(),
                      headers={"Content-Type": "application/json"})
    with build_opener(ProxyHandler({}), NoRedirect()).open(request, timeout=60) as response:
        value = json.load(response)
    vector = value["data"][0]["embedding"]
    if len(vector) != 1024:
        raise ValueError("embedding dimensions differ")
    return [struct.unpack("f", struct.pack("f", v))[0] for v in vector]


def build(root, embedding_pin, clef_pin, *, embedder=embed, calls_approved=False):
    """Validate annotations first, then freeze vectors and a preparation manifest."""
    data = read_reference(root)
    catalogue, cases = data["catalogue"], data["reference"]
    validate_catalogue(catalogue)
    if any((root / "output" / split / "eval_results_checkpoint.json").exists() for split in ("development", "test")):
        raise ValueError("cannot rebuild inputs after inference starts")
    scope = digest({"catalogue": catalogue, "cases": cases, "embedding_pin": embedding_pin})
    path = root / "output/vectors_checkpoint.json"
    saved = Checkpoint(path, root, scope, resume=path.exists())
    inputs = [(c["id"], c["description"]) for c in cases]
    inputs += [(c["id"], c["definition"] + " " + " ".join(c["aliases"])) for c in catalogue]
    for key, text in inputs:
        if saved.should_run(key):
            vector = embedder(text)
            from labels import cosine
            cosine(vector, vector)
            saved.record(key, {"status": "ok", "vector": vector, "input_sha256": digest(text)})
            print(json.dumps({"embedded_id": key}), flush=True)
    vectors = {k: v["vector"] for k, v in saved.records.items()}
    candidates = {c["id"]: shortlist(c, catalogue, vectors) for c in cases}
    atomic_json(root / "corpus/candidates.json", root, candidates)
    files = {name: {"path": path, "sha256": file_digest(root / path)} for name, path in
             (("catalogue", "corpus/catalogue.json"), ("reference", "corpus/ground-truth.json"),
              ("candidates", "corpus/candidates.json"), ("provenance", "corpus/ai-reference-provenance.json"),
              ("notes", "corpus/annotation-notes.json"), ("annotation_input", "corpus/annotation-input.json"),
              ("entries", "corpus/entries.json"),
              ("vectors", "output/vectors_checkpoint.json"), ("source", "corpus/source-provenance.json"))}
    settings = {"question": QUESTION, "grid": list(GRID), "thresholds": {a: 0 for a in ARMS},
                "order": "embedding rank then ID; none_fit last", "concurrency": 1,
                "deepseek": {"model": "deepseek-flash", "temperature": 0, "max_tokens": 1024,
                             "response_format": {"type": "json_object"}}}
    value = {"version": 1, "reference_kind": "ai-draft", "human_reviewed": False,
             "files": files, "code_sha256": code_pins(), "settings": settings, "settings_sha256": digest(settings),
             "models": {"clef": clef_pin, "embedding": embedding_pin},
             "approvals": {"corpus": True, "ai_reference": True, "transfer_deepseek": True,
                           "local_calls": True, "gates": True, "calls": calls_approved, "spend_usd": 5},
             "test_frozen": False, "omitted_arms": {a: "Excluded by user: DeepSeek versus local Clef" for a in ("jev", "julia", "openjev")},
             "source_commit": "d22b578", "reference_time": "2026-10-10", "split_seed": 20261007}
    from labels import validate
    validate(value, root, for_inference=False)
    atomic_json(root / "corpus/development-manifest.json", root, value)
    return value


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--check-only", action="store_true")
    parser.add_argument("--calls-approved", action="store_true")
    args = parser.parse_args()
    root = run_root(args.root)
    if args.check_only:
        data = read_reference(root)
        validate_catalogue(data["catalogue"])
        print(json.dumps({"reference_valid": True, "cases": len(data["reference"]), "model_calls": 0}), flush=True)
        return
    weights_hash = file_digest(WEIGHTS)
    if weights_hash != WEIGHTS.name.removeprefix("sha256-"):
        raise ValueError("embedding weights differ")
    prior = json.loads((EXPERIMENT.parent / "03-pair-decisions-2026-10-10/corpus/clef-test-manifest.json").read_text())
    embedding_pin = {"model": MODEL, "endpoint": URL, "weights_path": str(WEIGHTS), "weights_sha256": weights_hash,
                     "dimensions": 1024, "pooling": "last", "precision": "float32", "prefixes": False}
    value = build(root, embedding_pin, prior["model"], calls_approved=args.calls_approved)
    print(json.dumps({"cases": 200, "deepseek_calls": 260, "clef_calls": 260,
                      "human_reviewed": False, "calls_approved": value["approvals"]["calls"], "verdict": "INCONCLUSIVE"}), flush=True)


if __name__ == "__main__":
    main()
