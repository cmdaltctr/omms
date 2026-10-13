"""Experiment 16: rerun the Experiment 12 neighbour gate with Qwen3-Embedding-4B vectors from llama.cpp."""

import argparse
import hashlib
import importlib.util
import json
import math
import os
import re
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "output"
EXP12 = HERE.parent / "12-retrieval-neighbour-reuse-gate-2026-10-11"
EXP12_RUNNER_SHA256 = "10a458e9020e07b9b7fca10a41ebb348b8f5f21ce9586faa434291053d98444b"
CORPUS = HERE.parent / "01-label-decisions-2026-10-07/output/revision-01-batch8192/corpus"
CLEF_MANIFEST = HERE.parent / "03-pair-decisions-2026-10-10/corpus/clef-test-manifest.json"
REVISION = "f4602530db1d980e16da9d7d3a70294cf5c190be"
GGUF_NAME = "Qwen3-Embedding-4B-Q8_0.gguf"
GGUF_URL = f"https://huggingface.co/Qwen/Qwen3-Embedding-4B-GGUF/resolve/{REVISION}/{GGUF_NAME}"
GGUF_SHA256 = "b60ae5ce2dd6a0b77f82cadf21def1f310a3e10cde380ad0081b07a9d416949d"
GGUF_BYTES = 4279660224
GGUF_PATH = OUT / ".models" / GGUF_NAME
PORT = 3007
SERVER_ARGS = ["--embedding", "--pooling", "last", "--ctx-size", "8192", "--batch-size", "8192",
               "--ubatch-size", "8192", "--parallel", "1", "--gpu-layers", "all", "--offline",
               "--log-disable", "--host", "127.0.0.1"]
INSTRUCTION = ("Identify the user's underlying preference or working pattern that this observation "
               "expresses, ignoring the specific tool or topic")
CELLS = ("plain", "instruct")
BATCH = 16


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


# --- Text ----------------------------------------------------------------------------


def normalise_text(text):
    """Experiment 01's embedding normalisation: punctuation to spaces, whitespace collapsed."""
    return re.sub(r"\s+", " ", re.sub(r"[，,。！？；;：:、\n\r.]", " ", text.strip())).strip()


def embed_text(text, cell):
    body = normalise_text(text)
    return body if cell == "plain" else f"Instruct: {INSTRUCTION}\nQuery:{body}"


# --- Model file and owned llama.cpp server -------------------------------------------


def ensure_gguf(fetch=urllib.request.urlopen):
    """Download the pinned GGUF once; refuse any file whose size or SHA-256 differs."""
    if GGUF_PATH.exists():
        e12.require(GGUF_PATH.stat().st_size == GGUF_BYTES and e12.file_hash(GGUF_PATH) == GGUF_SHA256,
                    "gguf_drift")
        return
    GGUF_PATH.parent.mkdir(parents=True, exist_ok=True)
    part = GGUF_PATH.with_suffix(".part")
    digest = hashlib.sha256()
    with fetch(GGUF_URL, timeout=120) as response, open(part, "wb") as handle:
        while chunk := response.read(1 << 22):
            digest.update(chunk)
            handle.write(chunk)
    if part.stat().st_size != GGUF_BYTES or digest.hexdigest() != GGUF_SHA256:
        part.unlink()
        raise ValueError("gguf_drift")
    os.replace(part, GGUF_PATH)


def server_binary():
    """The pinned llama.cpp b11510 server from the Experiment 03 manifest."""
    model = e12.read_json(CLEF_MANIFEST)["model"]
    path = Path(model["server_path"])
    e12.require(not path.is_symlink() and e12.file_hash(path) == model["server_sha256"], "server_drift")
    return path


def launch_args():
    return ["--model", str(GGUF_PATH), "--alias", "qwen3-embedding:4b", "--port", str(PORT), *SERVER_ARGS]


def http(path, value=None):
    body = json.dumps(value).encode() if value is not None else None
    request = urllib.request.Request(f"http://127.0.0.1:{PORT}{path}", data=body,
                                     headers={"Content-Type": "application/json"})
    with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(request, timeout=600) as r:
        return json.load(r)


class OwnedServer:
    """Own only this experiment's llama.cpp child on port 3007."""

    def __enter__(self):
        with socket.socket() as check:
            check.bind(("127.0.0.1", PORT))
        env = {k: v for k, v in os.environ.items() if not k.startswith("LLAMA_ARG_") and k != "HF_TOKEN"}
        self.process = subprocess.Popen([str(server_binary()), *launch_args()], env=env,
                                        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        started = time.monotonic()
        try:
            while time.monotonic() - started < 300:
                e12.require(self.process.poll() is None, "server_start_failed")
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


def llama_embed(texts):
    data = http("/v1/embeddings", {"model": "qwen3-embedding:4b", "input": texts})["data"]
    e12.require(len(data) == len(texts), "embedding_count")
    return [row["embedding"] for row in sorted(data, key=lambda row: row["index"])]


# --- Vectors and gate ----------------------------------------------------------------


def build_vectors(cell, embed):
    rows = e12.read_json(CORPUS / "ground-truth.json")
    for row in rows:
        e12.require("<private>" not in row["description"].lower(), "private_text")
    ids = sorted(row["id"] for row in rows)
    text = {row["id"]: embed_text(row["description"], cell) for row in rows}
    vectors = {}
    for start in range(0, len(ids), BATCH):
        chunk = ids[start:start + BATCH]
        for case_id, vector in zip(chunk, embed([text[c] for c in chunk])):
            e12.require(all(math.isfinite(v) for v in vector), "bad_vector")
            vectors[case_id] = vector
    dims = {len(v) for v in vectors.values()}
    e12.require(len(dims) == 1, "dimension_mismatch")
    return {"model": GGUF_NAME, "gguf_sha256": GGUF_SHA256, "cell": cell, "dimensions": dims.pop(),
            "inputs_sha256": hashlib.sha256(json.dumps(text, sort_keys=True).encode()).hexdigest(),
            "vectors": vectors}


def with_vectors(saved):
    """Experiment 12's cases with this cell's unit vectors in place of the cached 0.6B ones."""
    cases, _ = e12.load_inputs()
    e12.require(set(saved["vectors"]) == set(cases), "vector_coverage")
    unit = {}
    for case_id, vector in saved["vectors"].items():
        norm = math.sqrt(sum(v * v for v in vector))
        unit[case_id] = [v / norm for v in vector]
    return cases, unit


def nearest_diagnostic(decisions, cases):
    labelled = [c for c in decisions if cases[c]["label"] != "none_fit"]
    none = [c for c in decisions if cases[c]["label"] == "none_fit"]
    first = lambda c: decisions[c]["neighbours"][0][1]
    return {"labelled": len(labelled),
            "nearest_acceptable": sum(first(c) in cases[c]["accept"] for c in labelled),
            "none_fit_cases": len(none),
            "nearest_label_on_none_fit": sum(first(c) != "none_fit" for c in none)}


def run_cell(saved):
    cases, unit = with_vectors(saved)
    original = e12.load_inputs
    e12.load_inputs = lambda: (cases, unit)
    try:
        summary, _, decisions = e12.compute(write=False)
    finally:
        e12.load_inputs = original
    grid = summary["exploratory_grid"]
    best = max((v["correct"] for v in grid.values() if v["wrong"] == 0), default=0)
    return {"counts": summary["counts"], "rules": summary["rules"], "inner_best": summary["inner_best"],
            "learning_curve": summary["learning_curve"], "paired_experiment06": summary["paired_experiment06"],
            "nearest": nearest_diagnostic(decisions, cases), "exploratory_best_zero_wrong": best}


def interpret(nearest_acceptable):
    if nearest_acceptable >= 50:
        return "embedder was the main gap"
    if nearest_acceptable <= 40:
        return "data (about 3 examples per label) is the main gap"
    return "both matter"


def execute(verify=False):
    e12.check_pins()
    if not verify:
        ensure_gguf()
        with OwnedServer():
            for cell in CELLS:
                e12.atomic_json(OUT / f"vectors-{cell}.json", build_vectors(cell, llama_embed))
    results = {}
    for cell in CELLS:
        path = OUT / f"vectors-{cell}.json"
        saved = e12.read_json(path)
        result = run_cell(saved)
        result.update({"vectors_sha256": e12.file_hash(path), "dimensions": saved["dimensions"],
                       "interpretation": interpret(result["nearest"]["nearest_acceptable"])})
        results[cell] = result
    payload = e12.normalised({"cells": results, "gguf": GGUF_NAME, "gguf_sha256": GGUF_SHA256,
                              "revision": REVISION, "server_args": SERVER_ARGS,
                              "experiment12_runner_sha256": EXP12_RUNNER_SHA256, "pins": e12.PINS,
                              "h1_holds": any(r["counts"]["tier1_pass"] for r in results.values())})
    if verify:
        e12.require(e12.read_json(OUT / "summary.json") == payload, "summary_mismatch")
        print("Verified summary from saved vectors; zero writes; no model calls", flush=True)
        return
    e12.atomic_json(OUT / "summary.json", payload)
    e12.check_pins()
    for cell, r in results.items():
        c, n = r["counts"], r["nearest"]
        print(f"{cell}: E={c['existing']} C={c['correct']} W={c['wrong']} tier1={c['tier1_pass']} "
              f"nearest={n['nearest_acceptable']}/{n['labelled']} "
              f"label_on_none_fit={n['nearest_label_on_none_fit']}/{n['none_fit_cases']} "
              f"best_zero_wrong={r['exploratory_best_zero_wrong']} ({r['interpretation']})", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--verify", action="store_true")
    execute(parser.parse_args().verify)
