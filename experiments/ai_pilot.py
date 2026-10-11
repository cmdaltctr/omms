"""Explicitly approved AI-reference diagnostics, separate from human ground truth.

This pilot cannot pass the human-reviewed merge-safety benchmark. It reuses
the pair arms while preserving their original human-review approval gate.
"""

import importlib.util
import json
import math
import os
import re
import statistics
import time
from datetime import datetime
from functools import lru_cache
from pathlib import Path
from urllib.error import HTTPError, URLError

from manifest import digest, file_digest, _validate_pairs
from pair_metrics import metrics
from providers import (
    DEEPSEEK_MODEL, DEEPSEEK_URL, JEV_MODEL, JEV_URL,
    deepseek_payload, http_json, jev_payload, parse_deepseek, parse_jev, probability,
)
from safety import output_path, require_redacted


class PilotStopped(RuntimeError):
    """Stop before excess spending or after a non-retryable provider failure."""


def model_pins():
    """Pin the approved endpoints and conservative published price ceilings."""
    return {
        "P1": {"provider": "deepseek", "model": DEEPSEEK_MODEL, "endpoint": DEEPSEEK_URL,
               "credential_env": "DEEPSEEK_API_KEY", "parameters": {"temperature": 0, "response_format": {"type": "json_object"}},
               "timeout_seconds": 30, "repeats": 2,
               "pricing_usd_per_million": {"input": 0.30, "output": 1.20},
               "reservation_tokens": {"input": 1048576, "output": 393216},
               "documented_version": "DeepSeek-V4.1-Flash", "thinking": "provider default (enabled)"},
        "P2": {"provider": "typesafe", "model": JEV_MODEL, "endpoint": JEV_URL,
               "credential_env": "TYPESAFE_API_KEY", "parameters": {"type": "noul"},
               "timeout_seconds": 30, "pricing_usd_per_million": {"input": 0.042, "output": 0},
               "reservation_tokens": {"input": 65536, "output": 0}},
    }


def code_pins():
    """Freeze all code used by the inference path before a run."""
    root = Path(__file__).resolve().parent
    names = ["ai_pilot.py", "providers.py", "manifest.py", "checkpoint.py", "spending.py", "safety.py", "pair_metrics.py", "03-pair-decisions-2026-10-10/run_eval.py", "03-pair-decisions-2026-10-10/run_ai_pilot.py"]
    return {name: file_digest(root / name) for name in names}


def _read_reference(value, root):
    document = json.loads(output_path(root / value["files"]["reference"]["path"], root).read_text())
    if (document.get("human_reviewed") is not False or
            document.get("eligible_as_blind_user_ground_truth") is not False or
            document.get("label_source") != "AI-generated draft"):
        raise ValueError("AI reference must not claim human review")
    rows = document["labels"]
    by_id = {row["id"]: row for row in rows}
    if len(by_id) != len(rows) or set(by_id) != {pair["id"] for pair in value["pairs"]}:
        raise ValueError("reference pair IDs differ")
    for pair in value["pairs"]:
        row = by_id[pair["id"]]
        if any(row[key] != pair[key] for key in ("decision", "A", "B")):
            raise ValueError("reference descriptions differ from approved pairs")
        allowed = {"same", "different", "uncertain"} if pair["decision"] == "duplicate" else {"contradict", "compatible", "uncertain"}
        if row["outcome"] not in allowed or not row.get("reason"):
            raise ValueError("incomplete AI reference")
        require_redacted(row["reason"])
    return by_id


def validate(value, root):
    """Refuse inference without AI-reference, transfer, budget and hash approval."""
    try:
        if value["version"] != 1 or value["reference_kind"] != "ai-draft":
            raise ValueError("explicit AI-reference mode required")
        if not re.fullmatch(r"[0-9a-f]{40}", value["source_commit"]) or datetime.fromisoformat(value["reference_time"]).tzinfo is None or type(value["split_seed"]) is not int:
            raise ValueError("source and reference-time pins required")
        approvals = value["approvals"]
        if approvals.get("review") is not False:
            raise ValueError("AI pilot must not claim human review")
        if any(approvals.get(key) is not True for key in ("ai_reference", "gates", "calls")):
            raise ValueError("AI-reference inference approval required")
        limit, estimate = approvals["spend_usd"], value["estimated_cost_usd"]
        if any(type(n) not in (int, float) or not math.isfinite(n) for n in (limit, estimate)) or not 0 <= estimate <= limit or limit <= 0:
            raise ValueError("spending approval required")
        files = value["files"]
        if not {"source", "corpus", "reference"}.issubset(files):
            raise ValueError("file pins required")
        for record in files.values():
            if file_digest(output_path(root / record["path"], root)) != record["sha256"]:
                raise ValueError("file hash changed")
        if any(approvals["transfer"][arm] != files["corpus"]["sha256"] for arm in ("P1", "P2")):
            raise ValueError("transfer scope approval required")
        if value["models"] != model_pins():
            raise ValueError("approved model pins changed")
        pairs = value["pairs"]
        _validate_pairs(pairs)
        if pairs != json.loads(output_path(root / files["corpus"]["path"], root).read_text()):
            raise ValueError("corpus pair records changed")
        if digest([pair for pair in pairs if pair["split"] == "test"]) != value["test_split_sha256"]:
            raise ValueError("test split hash changed")
        settings = value["settings"]
        if digest(settings) != value["settings_sha256"]:
            raise ValueError("settings hash changed")
        if settings["code_sha256"] != code_pins():
            raise ValueError("code pins changed")
        if settings["concurrency"] != 1:
            raise ValueError("sequential execution required")
        low, high = settings["hybrid_band"]
        if probability(low) > probability(high):
            raise ValueError("hybrid band reversed")
        for decision in ("duplicate", "conflict"):
            probability(settings["embedding_thresholds"][decision])
            probability(settings["jev_thresholds"][decision])
            require_redacted(settings["questions"][decision])
            if not settings["questions"][decision]:
                raise ValueError("question pin required")
        for pair in pairs:
            if pair["decision"] not in ("duplicate", "conflict"):
                raise ValueError("invalid decision")
            require_redacted(pair["A"])
            require_redacted(pair["B"])
            probability(pair["cosine"])
        _read_reference(value, root)
    except (KeyError, TypeError, AttributeError, OSError) as error:
        raise ValueError("invalid AI pilot manifest") from error
    return digest(value)


def spending_scope(value):
    """Keep the authorised spending ledger shared across splits and tuning."""
    return digest({key: value[key] for key in ("reference_kind", "source_commit", "files", "test_split_sha256", "models", "approvals")})


def run_scope(value, split):
    """Bind resume to the full frozen manifest and one data split."""
    if split not in ("development", "test"):
        raise ValueError("invalid split")
    return digest({"manifest": digest(value), "split": split})


def _usage(data, arm, pin):
    usage = data["usage"]
    keys = ("prompt_tokens", "completion_tokens") if arm == "P1" else ("input_tokens", "output_tokens")
    if any(type(usage.get(key)) is not int or usage[key] < 0 for key in keys):
        raise ValueError("invalid provider usage")
    input_tokens, output_tokens = (usage[key] for key in keys)
    limits = pin["reservation_tokens"]
    if input_tokens > limits["input"] or (arm == "P1" and output_tokens > limits["output"]):
        raise ValueError("usage exceeds documented limits")
    rates = pin["pricing_usd_per_million"]
    cost = (input_tokens * rates["input"] + output_tokens * rates["output"]) / 1_000_000
    return {keys[0]: input_tokens, keys[1]: output_tokens}, cost


def request(value, root, arm, pair, budget):
    """Reserve both providers' maximum costs, retaining unknown billed usage."""
    validate(value, root)
    if budget.state["fingerprint"] != spending_scope(value) or budget.state["limit"] != value["approvals"]["spend_usd"]:
        raise ValueError("budget differs from approved scope")
    original = next((item for item in value["pairs"] if item["id"] == pair["id"]), None)
    if original is None or any(pair[key] != original[key] for key in ("id", "decision", "split")):
        raise ValueError("unapproved pair")
    texts = (pair["A"], pair["B"])
    if texts != (original["A"], original["B"]) and not (pair["split"] == "development" and texts == (original["B"], original["A"])):
        raise ValueError("unapproved pair text or order")
    pin = value["models"][arm]
    payload = deepseek_payload(pair["decision"], pair["A"], pair["B"]) if arm == "P1" else jev_payload({"A": pair["A"], "B": pair["B"]}, value["settings"]["questions"][pair["decision"]], kind="noul")
    require_redacted(json.dumps(payload), secrets=tuple(os.environ.get(model["credential_env"], "") for model in value["models"].values()))
    rates, limits = pin["pricing_usd_per_million"], pin["reservation_tokens"]
    ceiling = (limits["input"] * rates["input"] + limits["output"] * rates["output"]) / 1_000_000
    try:
        ticket = budget.reserve(ceiling)
    except ValueError as error:
        raise PilotStopped("spending limit reached") from error
    start = time.monotonic()
    billing = {"spending_ticket": ticket, "reserved_cost_usd": ceiling}
    try:
        data = http_json(pin["endpoint"], payload, pin["credential_env"])
        usage, cost = _usage(data, arm, pin)
        budget.settle(ticket, cost)
        billing.update(usage=usage, usage_cost_usd=cost)
        if data.get("model") != pin["model"]:
            result = {"status": "error", "code": "model-mismatch", "fatal": True}
        else:
            parsed = parse_deepseek(data, pair["decision"], pin["model"]) if arm == "P1" else parse_jev(data, payload)
            result = {"status": "ok", **parsed}
    except HTTPError as error:
        result = {"status": "error", "code": "rate-limit" if error.code in (429, 529) else "http-error", "http_status": error.code, "fatal": True}
    except TimeoutError:
        result = {"status": "error", "code": "timeout"}
    except URLError as error:
        result = {"status": "error", "code": "timeout" if isinstance(error.reason, TimeoutError) else "transport-error"}
    except (ValueError, KeyError, IndexError, TypeError, AttributeError):
        result = {"status": "error", "code": "invalid-answer"}
    return {**result, **billing, "duration_seconds": time.monotonic() - start}


@lru_cache(maxsize=1)
def _pair_runner():
    path = Path(__file__).resolve().parent / "03-pair-decisions-2026-10-10/run_eval.py"
    spec = importlib.util.spec_from_file_location("pair_arms", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def evaluate(value, root, split, saved, budget):
    """Checkpoint all diagnostic arms without claiming human-reviewed safety."""
    validate(value, root)
    if split == "test" and (value.get("test_settings_frozen") is not True or not value.get("development_result_sha256")):
        raise ValueError("saved development freeze required before test inference")
    if saved.fingerprint != run_scope(value, split):
        raise ValueError("split or frozen manifest differs from checkpoint")
    called = set()
    def invoke(arm, pair):
        cold = arm not in called
        called.add(arm)
        return {**request(value, root, arm, pair, budget), "cold": cold}
    for pair in value["pairs"]:
        if pair["split"] != split:
            continue
        for arm, repeat in (("P0", 1), ("P1", 1), ("P1", 2), ("P2", 1), ("P3", 1)):
            for swapped in ((False, True) if split == "development" and arm != "P0" else (False,)):
                key = f'{pair["id"]}/{arm}/{repeat}/{int(swapped)}'
                if not saved.should_run(key):
                    continue
                ordered = {**pair, "A": pair["B"], "B": pair["A"]} if swapped else pair
                result = _pair_runner()._arm(arm, ordered, value["settings"], lambda item: invoke("P1", item), lambda item: invoke("P2", item))
                record = {**result, "pair_id": pair["id"], "decision": pair["decision"], "arm": arm, "repeat": repeat, "swapped": swapped, "split": split, "reference_kind": "ai-draft"}
                saved.record(key, record)
                print(json.dumps({key: record[key] for key in ("pair_id", "arm", "repeat", "swapped", "status")}), flush=True)
                if result.get("fatal"):
                    raise PilotStopped("provider failure; automatic retries disabled")
    return saved.records


def summarise(value, root, records, budget):
    """Report timing and AI-reference agreement, always leaving safety inconclusive."""
    reference = _read_reference(value, root)
    rows = list(records.values())
    primary = {(row["pair_id"], row["arm"], row["repeat"], row["swapped"]): row for row in rows}
    diagnostics = {"deepseek_repeat_flips": 0, "deepseek_valid_repeat_pairs": 0,
                   "development_swap_flips": {}, "development_valid_swap_pairs": {}}
    for pair in value["pairs"]:
        if pair["split"] == "test":
            repeats = [primary.get((pair["id"], "P1", repeat, False), {}) for repeat in (1, 2)]
            if all(row.get("status") == "ok" for row in repeats):
                diagnostics["deepseek_valid_repeat_pairs"] += 1
                diagnostics["deepseek_repeat_flips"] += int(repeats[0]["answer"] != repeats[1]["answer"])
    for arm in ("P1", "P2", "P3"):
        flips = comparable = 0
        for pair in value["pairs"]:
            if pair["split"] != "development":
                continue
            orders = [primary.get((pair["id"], arm, 1, swapped), {}) for swapped in (False, True)]
            if all(row.get("status") == "ok" for row in orders):
                comparable += 1
                flips += int(orders[0]["answer"] != orders[1]["answer"])
        diagnostics["development_swap_flips"][arm] = flips
        diagnostics["development_valid_swap_pairs"][arm] = comparable
    summary = {"reference_kind": "ai-draft", "human_reviewed": False, "merge_safety_verdict": "INCONCLUSIVE",
               "record_count": len(rows), "spending_accounted_usd": budget.used,
               "spend_cap_usd": budget.state["limit"], "diagnostics": diagnostics, "decisions": {}}
    for decision in ("duplicate", "conflict"):
        pairs = [pair for pair in value["pairs"] if pair["split"] == "test" and pair["decision"] == decision]
        selected = [row for row in rows if row["split"] == "test" and row["decision"] == decision and not row["swapped"]]
        arms = {arm: metrics(pairs, reference, selected, arm) for arm in ("P0", "P1", "P2", "P3")}
        control = arms["P1"]
        for arm, item in arms.items():
            item.pop("correctness")
            item["speedup_vs_deepseek"] = control["mean_seconds"] / item["mean_seconds"] if control["mean_seconds"] and item["mean_seconds"] else None
            comparable = [row for row in selected if row["arm"] == arm and row["status"] == "ok"]
            baseline = {(row["pair_id"], row["repeat"]): row for row in selected if row["arm"] == "P1" and row["status"] == "ok"}
            agreement = [row["answer"] == baseline[(row["pair_id"], 1)]["answer"] for row in comparable if (row["pair_id"], 1) in baseline]
            item["agreement_with_deepseek_first_repeat"] = statistics.fmean(agreement) if agreement else None
            item["paired_valid_answers"] = len(agreement)
            for cold in (True, False):
                times = [row["duration_seconds"] for row in selected if row["arm"] == arm and row.get("cold") is cold]
                item["cold_mean_seconds" if cold else "warmed_mean_seconds"] = statistics.fmean(times) if times else None
        summary["decisions"][decision] = arms
    return summary


def tune(value, root, records):
    """Select thresholds and fallback bands from primary development cells only."""
    reference = _read_reference(value, root)
    settings = json.loads(json.dumps(value["settings"]))
    primary = {(row["pair_id"], row["arm"]): row for row in records.values()
               if row["split"] == "development" and not row["swapped"] and row["repeat"] == 1}
    grid = (0.5, 0.65, 0.8, 0.9, 0.95, 0.99, 1.0)
    for decision in ("duplicate", "conflict"):
        pairs = [pair for pair in value["pairs"] if pair["split"] == "development" and pair["decision"] == decision]
        positive = "same" if decision == "duplicate" else "contradict"
        def rank(predict):
            wrong_yes = uncertain_yes = correct = 0
            for pair in pairs:
                answer = predict(pair)
                outcome = reference[pair["id"]]["outcome"]
                wrong_yes += int(answer is True and outcome not in (positive, "uncertain"))
                uncertain_yes += int(answer is True and outcome == "uncertain")
                correct += int(type(answer) is bool and outcome != "uncertain" and answer == (outcome == positive))
            return wrong_yes, uncertain_yes, -correct
        for name, arm in (("embedding_thresholds", "P0"), ("jev_thresholds", "P2")):
            def score(pair):
                row = primary.get((pair["id"], arm), {})
                return pair["cosine"] if arm == "P0" else row.get("probability") if row.get("status") == "ok" else None
            if not pairs or (arm == "P2" and not any(score(pair) is not None for pair in pairs)):
                continue
            def prediction(pair, threshold):
                number = score(pair)
                return number >= threshold if number is not None else None
            settings[name][decision] = min(grid, key=lambda threshold: (*rank(lambda pair: prediction(pair, threshold)), threshold))
    # One shared band is selected on both development decisions, without test cells.
    candidates = ([0.3, 0.7], [0.1, 0.9], [0.05, 0.95], [0.01, 0.99], [0.5, 0.5])
    eligible = []
    for band in candidates:
        wrong = correct = fallback = total = 0
        for pair in value["pairs"]:
            if pair["split"] != "development":
                continue
            total += 1
            row = primary.get((pair["id"], "P2"), {})
            if row.get("status") != "ok":
                continue
            number = row["probability"]
            use_control = band[0] <= number <= band[1]
            fallback += int(use_control)
            control = primary.get((pair["id"], "P1"), {})
            answer = control.get("answer") if use_control and control.get("status") == "ok" else None if use_control else number >= settings["jev_thresholds"][pair["decision"]]
            outcome = reference[pair["id"]]["outcome"]
            positive = "same" if pair["decision"] == "duplicate" else "contradict"
            wrong += int(answer is True and outcome != positive)
            correct += int(type(answer) is bool and outcome != "uncertain" and answer == (outcome == positive))
        if total and fallback / total <= 0.3:
            eligible.append(((wrong, -correct, fallback), band))
    if eligible:
        settings["hybrid_band"] = min(eligible, key=lambda item: item[0])[1]
    settings["tuning"] = {"split": "development", "threshold_grid": list(grid), "band_grid": list(candidates), "question_changed": False,
                          "ranking": "minimise false positive and uncertain acceptance, then maximise AI-reference agreement"}
    return settings


def render_report(summary):
    """Describe diagnostic results without declaring independently verified safety."""
    lines = ["# Experiment 03: AI-labelled pilot", "", "**Merge safety: INCONCLUSIVE.**", "",
             "The reference labels are AI-generated. They have no independent human review. Agreement measures similarity to those labels, not verified merge correctness. The annotator also developed the tooling and saw the frozen pair descriptions.", "",
             "No production memories were merged or edited. The original human-review benchmark remains incomplete.", "",
             "| Decision | Arm | AI-reference agreement | Mean seconds | Speed-up vs DeepSeek | Errors | Complete |",
             "| --- | --- | --- | --- | --- | --- | --- |"]
    for decision, arms in summary["decisions"].items():
        for arm, item in arms.items():
            lines.append(f'| {decision} | {arm} | {item["agreement"]} | {item["mean_seconds"]} | {item["speedup_vs_deepseek"]} | {item["errors"]} | {item["complete"]} |')
    if not any(item["complete"] for arms in summary["decisions"].values() for item in arms.values()):
        lines.extend(["", "There are no test cells with complete evidence. Partial cells remain in the raw results."])
    lines.extend(["", "## Cost", "", f'Accounted usage plus unresolved worst-case reservations: US${summary["spending_accounted_usd"]:.6f}. Authorised cap: US${summary["spend_cap_usd"]:.2f}.', "",
                  "Usage costs use published peak cache-miss rates. They are conservative usage estimates, not an invoice. Missing usage retains the full reservation, including interrupted requests.", "",
                  "## Limitations", "", "Only six pairs have an AI 'same' label. All 48 conflict pairs have an AI 'compatible' label. These sets cannot establish reliable positive-merge decisions.", "",
                  "DeepSeek uses the pinned production prompts and request parameters. Its provider-default thinking mode is retained. Thresholds and the hybrid band use development cells only; test order and questions remain frozen.", "",
                  "Julia-1, Needle and OpenJev remain BLOCKED because their local backends and weights were not approved. The security scanner was not run because permission was withheld.", "",
                  "## Separate follow-up", "", "The production duplicate cache key truncates joined descriptions to 100 characters. Investigate that separately; this pilot does not change it.", ""])
    return "\n".join(lines)
