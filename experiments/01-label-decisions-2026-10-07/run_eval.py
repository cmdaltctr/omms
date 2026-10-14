"""Run matched label controls with experiment-local checkpoints and accounting."""

import argparse
import json
import time
import sys
from pathlib import Path
from urllib.error import HTTPError, URLError
from http.client import IncompleteRead

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from checkpoint import Checkpoint, atomic_json
from clef_pilot import ENDPOINT, PROPS, local_json
from manifest import digest, file_digest
from providers import DEEPSEEK_URL, http_json, probability
from safety import output_path, reject_symlinks, require_redacted
from spending import Budget
from labels import ARMS, embedding, freeze, normalise, options_for, validate
from reference_guards import run_root, verify_freeze


def parse(data, arm, options):
    """Keep Clef probabilities apart from DeepSeek's self-reported scores."""
    expected = "clef-flash" if arm == "L3-clef" else "deepseek-flash"
    if data["model"] != expected:
        raise ValueError("returned model differs")
    if arm == "L3-clef":
        item = data["answers"]["decision"]
        if item["type"] != "choice" or set(item["probabilities"]) != set(options):
            raise ValueError("invalid Choice distribution")
        distribution = {i: probability(p) for i, p in item["probabilities"].items()}
        if abs(sum(distribution.values()) - 1) > 1e-6:
            raise ValueError("invalid probability sum")
        answer = item["choice"]
        score = distribution[answer]
        result = {"probabilities": distribution, "provider_confidence": probability(item["confidence"]),
                  "score_kind": "native_choice_probability"}
    else:
        item = json.loads(data["choices"][0]["message"]["content"])
        answer, score = item["choice"], probability(item["score"])
        result = {"provider_score": score, "probabilities": None, "score_kind": "self_reported_score"}
    if answer not in options:
        raise ValueError("unexpected candidate ID")
    return {**result, "status": "ok", "answer": answer, "score": score, "returned_model": expected}


def payload(value, case, options, arm):
    """Supply the same quoted observation, section and candidate definitions."""
    state = {"description": case["description"], "section": case["section"]}
    if arm not in ("L2-deepseek", "L3-clef"):
        raise ValueError("unsupported model arm")
    if value["settings"]["deepseek"] != {"model": "deepseek-flash", "temperature": 0, "max_tokens": 1024,
                                          "response_format": {"type": "json_object"}}:
        raise ValueError("unapproved model parameters")
    if arm == "L3-clef":
        body = {"model": "clef-flash", "state": state, "questions": {"decision": {
            "type": "choice", "instructions": value["settings"]["question"], "criteria": options}}}
    else:
        body = {**value["settings"]["deepseek"], "messages": [
            {"role": "system", "content": value["settings"]["question"] + ' Return JSON only: {"choice": "candidate_id", "score": 0.0}. Score your certainty from 0 to 1.'},
            {"role": "user", "content": json.dumps({"observation": state, "options": options})}]}
    require_redacted(json.dumps(body))
    return body


def request(value, case, options, arm, budget):
    """Reserve before transfer and retain usage even when parsing fails."""
    body = payload(value, case, options, arm)
    billing = {}
    if len(json.dumps(body).encode()) > 8192:
        return {"status": "error", "code": "input-overflow", "duration_seconds": 0}
    if arm == "L2-deepseek":
        ticket = budget.reserve((8192 * 0.3 + 1024 * 1.2) / 1_000_000)
        billing["spending_ticket"] = ticket
    start = time.monotonic()
    try:
        data = local_json(ENDPOINT, body) if arm == "L3-clef" else http_json(DEEPSEEK_URL, body, "DEEPSEEK_API_KEY")
        if arm == "L2-deepseek":
            usage = data["usage"]
            if any(type(usage.get(k)) is not int or not 0 <= usage[k] <= maximum
                   for k, maximum in (("prompt_tokens", 8192), ("completion_tokens", 1024))):
                raise ValueError("invalid usage")
            cost = (usage["prompt_tokens"] * 0.3 + usage["completion_tokens"] * 1.2) / 1_000_000
            budget.settle(ticket, cost)
            billing.update(usage=usage, usage_cost_usd=cost)
        else:
            usage = data["usage"]
            if type(usage["input_tokens"]) is not int or not 0 < usage["input_tokens"] <= 8192 or type(usage["output_tokens"]) is not int or usage["output_tokens"] != 0:
                raise ValueError("invalid local usage")
            billing.update(usage=usage, usage_cost_usd=0)
        result = parse(data, arm, options)
    except HTTPError as error:
        result = {"status": "error", "code": "http-error", "http_status": error.code, "fatal": True}
    except (TimeoutError, URLError, IncompleteRead):
        result = {"status": "error", "code": "transport-error"}
    except (ValueError, KeyError, IndexError, TypeError):
        result = {"status": "error", "code": "invalid-answer"}
    return {**result, **billing, "duration_seconds": time.monotonic() - start}


def evaluate(value, root, split, saved, call, *, retry_failed=False):
    """Run test cases only after a saved development freeze."""
    catalogue, cases, candidates = validate(value, root)
    if saved.fingerprint != digest({"manifest": value, "split": split}):
        raise ValueError("checkpoint fingerprint differs")
    if split == "test" and (not value["test_frozen"] or not value.get("development_result_sha256")):
        raise ValueError("development freeze required")
    if split == "test":
        verify_freeze(value, root)
    for case in cases:
        if case["split"] != split:
            continue
        for arm in ARMS:
            for order in ((0, 1) if split == "development" and arm in ARMS[2:] else (0,)):
                key = f'{case["id"]}/{arm}/{order}'
                if not saved.should_run(key, retry_failed=retry_failed):
                    continue
                start = time.monotonic()
                if arm == ARMS[0]:
                    result = normalise(case, catalogue, candidates)
                elif arm == ARMS[1]:
                    result = embedding(case, candidates)
                else:
                    result = call(value, case, options_for(case, catalogue, candidates, reverse=bool(order)), arm)
                result.setdefault("duration_seconds", time.monotonic() - start)
                row = {**result, "case_id": case["id"], "arm": arm, "order": order, "split": split}
                saved.record(key, row, retry_failed=retry_failed)
                print(json.dumps({k: row[k] for k in ("case_id", "arm", "order", "split", "status")}), flush=True)
                if row.get("fatal"):
                    raise ValueError("provider failed; checkpoint retained")
    return saved.records


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--split", choices=("development", "test"), required=True)
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--retry-failed", action="store_true")
    args = parser.parse_args()
    root = run_root(args.manifest.absolute().parent.parent)
    value = json.loads(output_path(args.manifest.absolute(), root).read_text())
    _, cases, _ = validate(value, root)
    pin = value["models"]["clef"]
    for name in ("gguf", "server"):
        if file_digest(reject_symlinks(Path(pin[name + "_path"]))) != pin[name + "_sha256"]:
            raise ValueError("local model pin differs")
    if local_json(PROPS).get("model_path") != pin["gguf_path"]:
        raise ValueError("served weights differ")
    scope = digest({"files": value["files"], "models": value["models"], "approvals": value["approvals"]})
    budget_path = root / "output/spending.json"
    budget = Budget(budget_path, root, scope, value["approvals"]["spend_usd"], resume=budget_path.exists())
    out = root / "output" / args.split
    saved = Checkpoint(out / "eval_results_checkpoint.json", root, digest({"manifest": value, "split": args.split}), resume=args.resume)
    evaluate(value, root, args.split, saved, lambda v, c, o, a: request(v, c, o, a, budget), retry_failed=args.retry_failed)
    atomic_json(out / "eval_results.json", root, {"manifest_sha256": digest(value), "records": saved.records})
    if args.split == "development":
        frozen = freeze(value, cases, saved.records)
        atomic_json(root / "corpus/test-manifest.json", root, frozen)
    print(json.dumps({"split": args.split, "records": len(saved.records), "accounted_usd": budget.used}), flush=True)


if __name__ == "__main__":
    main()
