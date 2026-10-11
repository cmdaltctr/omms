"""Evaluate reviewed pair decisions on copies, with atomic checkpoints."""

import argparse
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from checkpoint import Checkpoint, atomic_json
from manifest import digest, file_digest, spending_fingerprint, validate
from providers import DEEPSEEK_MODEL, DEEPSEEK_URL, deepseek_payload, guarded_call, http_json, parse_deepseek, probability, run_jev, jev_payload
from safety import output_path, require_redacted
from spending import Budget


def code_pins():
    """Pin the implementation as well as its questions and model settings."""
    base = Path(__file__).resolve().parents[1]
    names = ["providers.py", "manifest.py", "checkpoint.py", "spending.py", "03-pair-decisions-2026-10-10/run_eval.py"]
    return {name: file_digest(base / name) for name in names}


def run_fingerprint(value, root, split):
    """Bind a checkpoint to one approved manifest and one named split."""
    if split not in ("development", "test"):
        raise ValueError("invalid data split")
    return digest({"manifest": validate(value, root, hosted_arms=["P1", "P2"]), "split": split})


def _inputs(value, root):
    pairs = json.loads((root / value["files"]["corpus"]["path"]).read_text())
    truth = json.loads((root / value["files"]["ground_truth"]["path"]).read_text())
    if pairs != value["pairs"] or set(truth) != {pair["id"] for pair in pairs}:
        raise ValueError("corpus and reviewed IDs differ from manifest")
    for pair in pairs:
        allowed = ("same", "different", "uncertain") if pair["decision"] == "duplicate" else ("contradict", "compatible", "uncertain")
        label = truth[pair["id"]]
        if label.get("outcome") not in allowed or not isinstance(label.get("reason"), str) or not label["reason"].strip():
            raise ValueError("blind review incomplete")
        require_redacted(pair["A"])
        require_redacted(pair["B"])
        require_redacted(label["reason"])
    settings = value["settings"]
    if settings.get("code_sha256") != code_pins():
        raise ValueError("frozen code pins changed")
    if settings.get("concurrency") != 1:
        raise ValueError("only frozen sequential execution is supported")
    low, high = settings["hybrid_band"]
    if not 0 <= probability(low) <= probability(high) <= 1:
        raise ValueError("invalid hybrid band")
    for decision in ("duplicate", "conflict"):
        probability(settings["jev_thresholds"][decision])
        probability(settings["embedding_thresholds"][decision])
        if not settings["questions"][decision]:
            raise ValueError("frozen question required")
    return pairs


def _invoke(call, pair, *, noul=False):
    start = time.monotonic()
    try:
        result = call(pair)
        if result.get("status") == "error":
            return {**result, "duration_seconds": time.monotonic() - start}
        if noul:
            probability(result["probability"])
        elif type(result.get("answer")) is not bool:
            raise ValueError("Boolean decision required")
        return {**result, "status": "ok", "duration_seconds": time.monotonic() - start}
    except TimeoutError:
        code = "timeout"
    except (ValueError, TypeError, KeyError, AttributeError):
        code = "invalid-answer"
    return {"status": "error", "code": code, "duration_seconds": time.monotonic() - start}


def _arm(arm, pair, settings, current, jev):
    decision = pair["decision"]
    if arm == "P0":
        start = time.monotonic()
        return {"status": "ok", "answer": pair["cosine"] >= settings["embedding_thresholds"][decision], "duration_seconds": time.monotonic() - start}
    if arm == "P1":
        return _invoke(current, pair)
    result = _invoke(jev, pair, noul=True)
    if result["status"] != "ok":
        return result
    score = result["probability"]
    if arm == "P2":
        return {**result, "answer": score >= settings["jev_thresholds"][decision]}
    low, high = settings["hybrid_band"]
    if low <= score <= high:
        fallback = _invoke(current, pair)
        return {**fallback, "fallback": True, "jev_probability": score, "jev": result, "duration_seconds": result["duration_seconds"] + fallback["duration_seconds"]}
    return {**result, "answer": score >= settings["jev_thresholds"][decision], "fallback": False}


def evaluate(value, root, split, saved, current, jev, *, retry_failed=False):
    """Run only the requested frozen split, saving after each pair and arm."""
    fingerprint = run_fingerprint(value, root, split)
    if saved.fingerprint != fingerprint:
        raise ValueError("split or checkpoint fingerprint differs")
    pairs = _inputs(value, root)
    for pair in pairs:
        if pair["split"] != split:
            continue
        for arm, repeat in (("P0", 1), ("P1", 1), ("P1", 2), ("P2", 1), ("P3", 1)):
            orders = (False,) if split == "test" or arm == "P0" else (False, True)
            for swapped in orders:
                key = f'{pair["id"]}/{arm}/{repeat}/{int(swapped)}'
                if not saved.should_run(key, retry_failed=retry_failed):
                    continue
                ordered = {**pair, "A": pair["B"], "B": pair["A"]} if swapped else pair
                provider = "P1" if arm == "P1" else "P2"
                cold = arm != "P0" and not any(record["arm"] == provider for record in saved.records.values())
                result = _arm(arm, ordered, value["settings"], current, jev)
                record = {**result, "pair_id": pair["id"], "decision": pair["decision"], "arm": arm, "repeat": repeat, "swapped": swapped, "split": split, "cold": cold}
                saved.record(key, record, retry_failed=retry_failed)
                print(json.dumps({"pair_id": pair["id"], "arm": arm, "repeat": repeat, "swapped": swapped, "status": result["status"]}), flush=True)
    return saved.records


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--split", choices=("development", "test"), required=True)
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--retry-failed", action="store_true")
    args = parser.parse_args()
    try:
        manifest_path = args.manifest.absolute()
        root = manifest_path.parent
        value = json.loads(manifest_path.read_text())
        fingerprint = validate(value, root, hosted_arms=["P1", "P2"])
        _inputs(value, root)
        out = output_path(root.parent / "output" / args.split, root.parent)
        state = out / "eval_results_checkpoint.json"
        saved = Checkpoint(state, root.parent, run_fingerprint(value, root, args.split), resume=args.resume and state.exists())
        spending = root.parent / "output/spending.json"
        budget = Budget(spending, root.parent, spending_fingerprint(value, root, hosted_arms=["P1", "P2"]), value["approvals"]["spend_usd"], resume=spending.exists())
        model = value["models"]["P1"]
        if model["model"] != DEEPSEEK_MODEL or model.get("endpoint") != DEEPSEEK_URL or not model.get("credential_env"):
            raise ValueError("approved DeepSeek endpoint and credential reference required")
        def current(pair):
            payload = deepseek_payload(pair["decision"], pair["A"], pair["B"])
            return guarded_call(value, root, "P1", lambda: http_json(DEEPSEEK_URL, payload, model["credential_env"]), lambda data: parse_deepseek(data, pair["decision"], model["model"]))
        def jev(pair):
            payload = jev_payload({"A": pair["A"], "B": pair["B"]}, value["settings"]["questions"][pair["decision"]], kind="noul")
            return run_jev(value, root, payload, budget)
        records = evaluate(value, root, args.split, saved, current, jev, retry_failed=args.retry_failed)
        atomic_json(out / "eval_results.json", root.parent, {"fingerprint": fingerprint, "records": records, "models": value["models"]})
    except (ValueError, KeyError, OSError, TypeError):
        parser.exit(1, "experiment prerequisites failed; no unapproved inference is permitted\n")


if __name__ == "__main__":
    main()
