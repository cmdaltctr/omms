"""Experiment 14: rerun the Experiment 12 neighbour gate with 1 or 2 agreeing neighbours."""

import argparse
import hashlib
import importlib.util
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "output"
EXP12 = HERE.parent / "12-retrieval-neighbour-reuse-gate-2026-10-11"
EXP12_RUNNER_SHA256 = "10a458e9020e07b9b7fca10a41ebb348b8f5f21ce9586faa434291053d98444b"
CELLS = {"k1": 1, "k2": 2}


def load_experiment12():
    """Import the frozen runner read-only; refuse a changed file."""
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
    module.OUT = OUT / "unused-experiment12-out"  # compute(write=False) never writes; belt and braces
    return module


def run_cells(e12):
    results = {}
    for cell, k in CELLS.items():
        e12.K = k
        summary, folds_file, _ = e12.compute(write=False)
        results[cell] = {"k": k, "counts": summary["counts"], "rules": summary["rules"],
                         "inner_best": summary["inner_best"],
                         "learning_curve": summary["learning_curve"],
                         "holding_pen": summary["holding_pen"],
                         "paired_experiment06": summary["paired_experiment06"],
                         "fold_of_case_digest": e12.hashlib.sha256(
                             repr(sorted(folds_file["fold_of_case"].items())).encode()).hexdigest()}
    return e12.normalised({"cells": results, "experiment12_runner_sha256": EXP12_RUNNER_SHA256,
                           "pins": e12.PINS,
                           "h1_holds": any(r["counts"]["tier1_pass"] for r in results.values())})


def execute(verify=False):
    e12 = load_experiment12()
    payload = run_cells(e12)
    path = OUT / "summary.json"
    if verify:
        e12.require(e12.read_json(path) == payload, "summary_mismatch")
        print("Verified summary; zero writes", flush=True)
        return
    e12.atomic_json(path, payload)
    e12.check_pins()
    for cell, r in payload["cells"].items():
        c = r["counts"]
        print(f"{cell}: E={c['existing']} C={c['correct']} W={c['wrong']} parked={c['parked']} "
              f"tier1={c['tier1_pass']} rules={r['rules']} "
              f"curve={r['learning_curve']['mean_correct']}", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--verify", action="store_true")
    execute(parser.parse_args().verify)
