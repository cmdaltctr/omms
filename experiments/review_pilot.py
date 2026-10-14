"""AI-labelled diagnostic on corpus v2 and the challenge set.

Arms: P0 embeddings, P1 DeepSeek and the standalone local Clef. Jev and the hybrid
are withheld this round and make no calls. The reference labels are AI-generated,
so every label-dependent verdict stays INCONCLUSIVE.

The earlier pilots pin their code by hash. This module imports their helpers and
never edits them, so their saved evidence still reproduces.
"""

import copy
import json
import os
import statistics
import time
from pathlib import Path
from urllib.error import HTTPError, URLError

from ai_pilot import PilotStopped, _usage, model_pins
from clef_pilot import ARM as CLEF, GRID, MODEL as CLEF_MODEL, PROPS, local_json, request as clef_request
from manifest import digest, file_digest, _validate_pairs
from pair_metrics import DEFAULT_GATES, metrics
from providers import deepseek_payload, http_json, parse_deepseek, probability
from safety import output_path, reject_symlinks, require_redacted

ARMS = ("P0", "P1", CLEF)
WITHHELD = ("P2", "P3")
SPLITS = ("development", "test", "challenge")
FILES = {"corpus": "pairs-v2.json", "reference": "ai-review-export.json", "challenge": "challenge-blind-review.json",
         "challenge_reference": "ai-challenge-export.json", "provenance": "ai-review-provenance.json"}
# Mean settled DeepSeek usage per call in the earlier AI pilot (569 calls).
USD_PER_DEEPSEEK_CALL = 0.00027


def code_pins():
    """Freeze the inference path, including the imported frozen helpers."""
    root = Path(__file__).resolve().parent
    names = ["review_pilot.py", "03-pair-decisions-2026-10-10/run_review_pilot.py", "ai_pilot.py", "clef_pilot.py",
             "checkpoint.py", "manifest.py", "pair_metrics.py", "providers.py", "safety.py", "spending.py"]
    return {name: file_digest(root / name) for name in names}


def plan(split):
    """List every (arm, repeat, swapped) cell; withheld arms never appear."""
    cells = []
    for arm in ARMS:
        if arm == "P0" and split == "challenge":
            continue  # challenge cases have no cosine score
        swaps = (False, True) if split == "development" and arm != "P0" else (False,)
        cells += [(arm, repeat, swapped) for repeat in ((1, 2) if arm == "P1" else (1,)) for swapped in swaps]
    return cells


def deepseek_calls(pairs):
    return sum(sum(arm == "P1" for arm, _, _ in plan(pair["split"])) for pair in pairs)


def prepare(root, clef_manifest, spend_usd):
    """Describe the approved diagnostic from corpus v2, the AI labels and the pinned Clef runtime."""
    files = {name: {"path": path, "sha256": file_digest(output_path(root / path, root))} for name, path in FILES.items()}
    clef = json.loads(output_path(root / clef_manifest, root).read_text())
    settings = {"questions": clef["settings"]["questions"], "embedding_thresholds": {"duplicate": 0.5, "conflict": 0.5},
                "clef_thresholds": {"duplicate": 0.5, "conflict": 0.5}, "threshold_grid": GRID, "concurrency": 1,
                "code_sha256": code_pins()}
    value = {"version": 1, "reference_kind": "ai-review", "human_reviewed": False, "arms": list(ARMS),
             "files": files, "models": {"P1": model_pins()["P1"], CLEF: clef["model"]},
             "approvals": {"review": False, "ai_reference": True, "calls": True, "local_calls": True,
                           "transfer": {"P1": {"corpus": files["corpus"]["sha256"], "challenge": files["challenge"]["sha256"]}},
                           "spend_usd": spend_usd},
             "settings": settings, "settings_sha256": digest(settings), "test_frozen": False}
    pairs, _ = _inputs(value, root)
    value["deepseek_calls"] = deepseek_calls(pairs)
    value["estimated_cost_usd"] = round(value["deepseek_calls"] * USD_PER_DEEPSEEK_CALL, 6)
    return value


def _inputs(value, root):
    """Load production and challenge pairs with the AI labels that must match them."""
    def read(name):
        return json.loads(output_path(root / value["files"][name]["path"], root).read_text())
    pairs = read("corpus")
    _validate_pairs(pairs)
    challenge = [{key: row[key] for key in ("id", "decision", "A", "B")} | {"split": "challenge"} for row in read("challenge")]
    provenance = read("provenance")
    if provenance.get("human_reviewed") is not False:
        raise ValueError("AI reference must not claim human review")
    reference = {}
    for name, rows in (("reference", read("reference")), ("challenge_reference", read("challenge_reference"))):
        if provenance["exports"][value["files"][name]["path"]]["export_sha256"] != value["files"][name]["sha256"]:
            raise ValueError("provenance does not pin the reference export")
        for row in rows:
            if row["id"] in reference:
                raise ValueError("duplicate reference ID")
            reference[row["id"]] = row
    combined = pairs + challenge
    if len({pair["id"] for pair in combined}) != len(combined) or set(reference) != {pair["id"] for pair in combined}:
        raise ValueError("reference pair IDs differ")
    for pair in combined:
        row = reference[pair["id"]]
        allowed = ("same", "different", "uncertain") if pair["decision"] == "duplicate" else ("contradict", "compatible", "uncertain")
        if any(row[key] != pair[key] for key in ("decision", "A", "B")) or row["outcome"] not in allowed or not row["reason"].strip():
            raise ValueError("incomplete or changed AI reference")
        require_redacted(pair["A"] + "\n" + pair["B"] + "\n" + row["reason"])
    return combined, {key: {"outcome": row["outcome"], "reason": row["reason"]} for key, row in reference.items()}


def validate(value, root):
    """Refuse withheld arms, human-review claims, changed files, code, weights or approvals."""
    try:
        if value["version"] != 1 or value["reference_kind"] != "ai-review" or value["human_reviewed"] is not False:
            raise ValueError("AI-review diagnostic mode required")
        # The arm guard: Jev and the hybrid are withheld by user decision.
        if value["arms"] != list(ARMS) or set(value["models"]) != {"P1", CLEF}:
            raise ValueError("only P0, P1 and local Clef are approved")
        approvals = value["approvals"]
        if approvals["review"] is not False:
            raise ValueError("AI diagnostic must not claim human review")
        if any(approvals[key] is not True for key in ("ai_reference", "calls", "local_calls")):
            raise ValueError("diagnostic call approval required")
        limit, estimate = approvals["spend_usd"], value["estimated_cost_usd"]
        if any(type(n) not in (int, float) for n in (limit, estimate)) or not 0 <= estimate <= limit or limit <= 0:
            raise ValueError("spending approval required")
        files = value["files"]
        if set(files) != set(FILES):
            raise ValueError("file pins required")
        for record in files.values():
            if file_digest(output_path(root / record["path"], root)) != record["sha256"]:
                raise ValueError("file hash changed")
        if approvals["transfer"] != {"P1": {"corpus": files["corpus"]["sha256"], "challenge": files["challenge"]["sha256"]}}:
            raise ValueError("transfer scope approval required")
        if value["models"]["P1"] != model_pins()["P1"]:
            raise ValueError("approved DeepSeek pin changed")
        pin = value["models"][CLEF]
        args = pin["launch_args"]
        if (pin["model"] != CLEF_MODEL or pin["quantisation"] != "Q8_0" or "--offline" not in args
                or "--log-disable" not in args or args[args.index("--host") + 1] != "127.0.0.1"):
            raise ValueError("approved loopback offline Clef required")
        for name in ("gguf", "server"):
            if file_digest(reject_symlinks(Path(pin[name + "_path"]))) != pin[name + "_sha256"]:
                raise ValueError("model or server hash changed")
        settings = value["settings"]
        if digest(settings) != value["settings_sha256"] or settings["code_sha256"] != code_pins():
            raise ValueError("settings or code pins changed")
        if settings["concurrency"] != 1 or settings["threshold_grid"] != GRID:
            raise ValueError("sequential settings required")
        for decision in ("duplicate", "conflict"):
            probability(settings["embedding_thresholds"][decision])
            probability(settings["clef_thresholds"][decision])
            if not settings["questions"][decision].strip():
                raise ValueError("question pin required")
        pairs, reference = _inputs(value, root)
        if value["deepseek_calls"] != deepseek_calls(pairs):
            raise ValueError("call count changed")
    except (KeyError, TypeError, AttributeError, IndexError, OSError) as error:
        raise ValueError("invalid review pilot manifest") from error
    return pairs, reference


def scope(value, split):
    """Bind each checkpoint to the complete manifest and one split."""
    if split not in SPLITS:
        raise ValueError("invalid split")
    return digest({"manifest": digest(value), "split": split})


def spending_scope(value):
    """Keep one fresh ledger across splits and the development freeze."""
    return digest({key: value[key] for key in ("reference_kind", "files", "models", "approvals")})


def deepseek_caller(value, pairs, budget):
    """Reserve the worst-case cost, call DeepSeek once and settle on validated usage."""
    if budget.state["fingerprint"] != spending_scope(value) or budget.state["limit"] != value["approvals"]["spend_usd"]:
        raise ValueError("budget differs from approved scope")
    pin = value["models"]["P1"]
    originals = {pair["id"]: pair for pair in pairs}
    rates, limits = pin["pricing_usd_per_million"], pin["reservation_tokens"]
    ceiling = (limits["input"] * rates["input"] + limits["output"] * rates["output"]) / 1_000_000

    def call(pair):
        original = originals[pair["id"]]
        texts = (pair["A"], pair["B"])
        if texts != (original["A"], original["B"]) and not (original["split"] == "development" and texts == (original["B"], original["A"])):
            raise ValueError("unapproved pair text or order")
        payload = deepseek_payload(pair["decision"], pair["A"], pair["B"])
        require_redacted(json.dumps(payload), secrets=(os.environ.get(pin["credential_env"], ""),))
        try:
            ticket = budget.reserve(ceiling)
        except ValueError as error:
            raise PilotStopped("spending limit reached") from error
        start = time.monotonic()
        billing = {"spending_ticket": ticket, "reserved_cost_usd": ceiling}
        try:
            data = http_json(pin["endpoint"], payload, pin["credential_env"])
            usage, cost = _usage(data, "P1", pin)
            budget.settle(ticket, cost)
            billing.update(usage=usage, usage_cost_usd=cost)
            if data.get("model") != pin["model"]:
                result = {"status": "error", "code": "model-mismatch", "fatal": True}
            else:
                result = {"status": "ok", **parse_deepseek(data, pair["decision"], pin["model"])}
        except HTTPError as error:
            result = {"status": "error", "code": "rate-limit" if error.code in (429, 529) else "http-error", "http_status": error.code, "fatal": True}
        except TimeoutError:
            result = {"status": "error", "code": "timeout"}
        except URLError as error:
            result = {"status": "error", "code": "timeout" if isinstance(error.reason, TimeoutError) else "transport-error"}
        except (ValueError, KeyError, IndexError, TypeError, AttributeError):
            result = {"status": "error", "code": "invalid-answer"}
        return {**result, **billing, "duration_seconds": time.monotonic() - start}
    return call


def clef_caller(value):
    """Call the loopback Clef server only when it serves the pinned weights."""
    if local_json(PROPS).get("model_path") != value["models"][CLEF]["gguf_path"]:
        raise ValueError("served model differs from pinned weights")
    return lambda pair: clef_request(pair, value["settings"])


def evaluate(value, root, split, saved, *, deepseek, clef, retry_failed=False):
    """Run one split cell by cell with atomic checkpoints; test and challenge need the freeze."""
    pairs, _ = validate(value, root)
    if split != "development" and (value["test_frozen"] is not True or not value.get("development_result_sha256")):
        raise ValueError("saved development freeze required before test or challenge inference")
    if saved.fingerprint != scope(value, split):
        raise ValueError("split or frozen manifest differs from checkpoint")
    settings, called = value["settings"], set()
    for pair in pairs:
        if pair["split"] != split:
            continue
        for arm, repeat, swapped in plan(split):
            key = f'{pair["id"]}/{arm}/{repeat}/{int(swapped)}'
            if not saved.should_run(key, retry_failed=retry_failed):
                continue
            ordered = {**pair, "A": pair["B"], "B": pair["A"]} if swapped else pair
            if arm == "P0":
                start = time.monotonic()
                result = {"status": "ok", "answer": pair["cosine"] >= settings["embedding_thresholds"][pair["decision"]],
                          "duration_seconds": time.monotonic() - start}
            else:
                result = {**(deepseek if arm == "P1" else clef)(ordered), "cold": arm not in called}
                called.add(arm)
                if arm == CLEF and result["status"] == "ok":
                    result["answer"] = result["probability"] >= settings["clef_thresholds"][pair["decision"]]
            row = {**result, "pair_id": pair["id"], "decision": pair["decision"], "arm": arm, "repeat": repeat,
                   "swapped": swapped, "split": split, "reference_kind": "ai-review"}
            saved.record(key, row, retry_failed=retry_failed)
            print(json.dumps({field: row[field] for field in ("pair_id", "arm", "repeat", "swapped", "split", "status")}), flush=True)
            if result.get("fatal"):
                raise PilotStopped("provider failure; automatic retries disabled")
    return saved.records


def freeze(value, root, records):
    """Pick embedding and Clef thresholds from original-order development cells only."""
    pairs, reference = validate(value, root)
    development = {key: row for key, row in records.items() if row["split"] == "development"}
    expected = {f'{pair["id"]}/{arm}/{repeat}/{int(swapped)}' for pair in pairs if pair["split"] == "development"
                for arm, repeat, swapped in plan("development")}
    if set(development) != expected or any(row["status"] != "ok" for row in development.values() if row["arm"] != "P1"):
        raise ValueError("complete development records required")
    frozen = copy.deepcopy(value)
    for decision in ("duplicate", "conflict"):
        positive = "same" if decision == "duplicate" else "contradict"
        subset = [pair for pair in pairs if pair["split"] == "development" and pair["decision"] == decision]
        for name, arm in (("embedding_thresholds", "P0"), ("clef_thresholds", CLEF)):
            def score(pair):
                return pair["cosine"] if arm == "P0" else development[f'{pair["id"]}/{arm}/1/0']["probability"]

            def rank(threshold):
                wrong = uncertain = correct = 0
                for pair in subset:
                    outcome, yes = reference[pair["id"]]["outcome"], score(pair) >= threshold
                    wrong += int(yes and outcome not in (positive, "uncertain"))
                    uncertain += int(yes and outcome == "uncertain")
                    correct += int(outcome != "uncertain" and yes == (outcome == positive))
                return wrong, uncertain, -correct, threshold
            frozen["settings"][name][decision] = min(GRID, key=rank)
    frozen["settings"]["tuning"] = {"split": "development", "question_changed": False,
                                    "ranking": "minimise wrong and uncertain YES, then maximise AI-reference agreement"}
    frozen["settings_sha256"] = digest(frozen["settings"])
    frozen["test_frozen"] = True
    frozen["development_result_sha256"] = digest(development)
    return frozen


def gates(item, control, decision, contradictions):
    """Apply the frozen gate rules; label-based verdicts are only indicative against AI labels."""
    limits = DEFAULT_GATES
    indicative = {"P-G1": "INCONCLUSIVE", "P-G2": "INCONCLUSIVE"}
    rate, reference_rate = item["false_merge_rate"], control["false_merge_rate"]
    if rate is not None and reference_rate is not None:
        if rate > reference_rate or rate >= limits["false_merge_upper_bound"]:
            indicative["P-G1"] = "FAIL"
        elif not item["uncertain_accepted"] and item["false_merge_upper95"] < limits["false_merge_upper_bound"]:
            indicative["P-G1"] = "PASS"
    if item["agreement"] is not None and control["agreement"] is not None:
        indicative["P-G2"] = "PASS" if item["agreement"] + limits["agreement_tolerance"] >= control["agreement"] else "FAIL"
    speed = "INCONCLUSIVE"
    if item["mean_seconds"] and control["mean_seconds"]:
        speed = "PASS" if control["mean_seconds"] / item["mean_seconds"] >= limits["speedup_factor"] - 1e-12 else "FAIL"
    official = {"P-G1": "INCONCLUSIVE", "P-G2": "INCONCLUSIVE", "P-G3": speed, "P-G4": "N/A",
                "P-G5": "PASS" if item["complete"] else "INCONCLUSIVE", "P-G6": "PASS"}
    if decision == "conflict" and contradictions < 30:
        indicative = {key: "INCONCLUSIVE" for key in indicative}
    return official, indicative


def summarise(value, root, records, *, spent_usd):
    """Report test and challenge cells per decision; merge safety always stays INCONCLUSIVE."""
    pairs, reference = validate(value, root)
    expected = {f'{pair["id"]}/{arm}/{repeat}/{int(swapped)}' for pair in pairs for arm, repeat, swapped in plan(pair["split"])}
    rows = list(records.values())
    summary = {"reference_kind": "ai-review", "human_reviewed": False, "merge_safety_verdict": "INCONCLUSIVE",
               "arms": list(ARMS), "withheld_arms": list(WITHHELD), "record_count": len(records),
               "expected_records": len(expected), "complete": set(records) == expected,
               "calls": {arm: sum(row["arm"] == arm for row in rows) for arm in ARMS if arm != "P0"},
               "deepseek_accounted_usd": spent_usd, "spend_cap_usd": value["approvals"]["spend_usd"], "clef_api_cost_usd": 0,
               "production_writes": 0, "thresholds": {name: value["settings"][name] for name in ("embedding_thresholds", "clef_thresholds")},
               "splits": {}, "diagnostics": {}}
    for split in ("test", "challenge"):
        summary["splits"][split] = {}
        for decision in ("duplicate", "conflict"):
            positive = "same" if decision == "duplicate" else "contradict"
            subset = [pair for pair in pairs if pair["split"] == split and pair["decision"] == decision]
            selected = [row for row in rows if row["split"] == split and row["decision"] == decision and not row["swapped"]]
            arms = {arm: metrics(subset, reference, selected, arm) for arm in ARMS if not (arm == "P0" and split == "challenge")}
            control = arms["P1"]
            positives = sum(reference[pair["id"]]["outcome"] == positive for pair in subset)
            first = {row["pair_id"]: row["answer"] for row in selected if row["arm"] == "P1" and row["repeat"] == 1 and row["status"] == "ok"}
            cell = {"pairs": len(subset), "reference_positives": positives,
                    "reference_uncertain": sum(reference[pair["id"]]["outcome"] == "uncertain" for pair in subset), "arms": {}}
            for arm, item in arms.items():
                item.pop("correctness")
                valid = [row for row in selected if row["arm"] == arm and row["status"] == "ok"]
                item["recognised_positives"] = sum(row["answer"] and reference[row["pair_id"]]["outcome"] == positive for row in valid)
                agree = [row["answer"] == first[row["pair_id"]] for row in valid if row["repeat"] == 1 and row["pair_id"] in first]
                item["agreement_with_deepseek_first_repeat"] = statistics.fmean(agree) if agree else None
                item["speedup_vs_deepseek"] = control["mean_seconds"] / item["mean_seconds"] if control["mean_seconds"] and item["mean_seconds"] else None
                cold = [row["duration_seconds"] for row in selected if row["arm"] == arm and row.get("cold")]
                item["cold_seconds"] = cold[0] if cold else None
                if arm != "P1":
                    item["gates"], item["indicative_gates_vs_ai_labels"] = gates(item, control, decision, positives)
                cell["arms"][arm] = item
            summary["splits"][split][decision] = cell
    by_key = {(row["pair_id"], row["arm"], row["repeat"], row["swapped"]): row for row in rows}
    flips = {}
    for split in ("test", "challenge"):
        both = [(by_key.get((pair["id"], "P1", 1, False), {}), by_key.get((pair["id"], "P1", 2, False), {}))
                for pair in pairs if pair["split"] == split]
        valid = [(a, b) for a, b in both if a.get("status") == b.get("status") == "ok"]
        flips[f"deepseek_repeat_flips_{split}"] = [sum(a["answer"] != b["answer"] for a, b in valid), len(valid)]
    for arm in ("P1", CLEF):
        both = [(by_key.get((pair["id"], arm, 1, False), {}), by_key.get((pair["id"], arm, 1, True), {}))
                for pair in pairs if pair["split"] == "development"]
        valid = [(a, b) for a, b in both if a.get("status") == b.get("status") == "ok"]
        if arm == CLEF:  # judge order sensitivity at the frozen cut-offs
            limits = value["settings"]["clef_thresholds"]
            count = sum((a["probability"] >= limits[a["decision"]]) != (b["probability"] >= limits[b["decision"]]) for a, b in valid)
        else:
            count = sum(a["answer"] != b["answer"] for a, b in valid)
        flips[f"development_swap_flips_{arm}"] = [count, len(valid)]
    summary["diagnostics"] = flips
    return summary


def _number(value, digits=3):
    return "n/a" if value is None else f"{value:.{digits}f}" if isinstance(value, float) else str(value)


def render_report(summary):
    """Write the data report; it never declares independently verified merge safety."""
    lines = ["# Experiment 03: AI-labelled diagnostic on corpus v2", "", "**Merge safety: INCONCLUSIVE.** The reference labels are AI-generated "
             "(`human_reviewed: false`). Agreement and wrong-YES counts are measured against those labels, not against an independent human review.", "",
             f'Arms: {", ".join(summary["arms"])}. Withheld (zero calls): {", ".join(summary["withheld_arms"])}. '
             f'Records: {summary["record_count"]}/{summary["expected_records"]} (complete: {summary["complete"]}). Production writes: {summary["production_writes"]}.', ""]
    for split, decisions in summary["splits"].items():
        lines += [f"## {split.capitalize()} split", ""]
        for decision, cell in decisions.items():
            lines += [f'### {decision.capitalize()} ({cell["pairs"]} pairs, {cell["reference_positives"]} AI-labelled positives, {cell["reference_uncertain"]} uncertain)', "",
                      "| Arm | Accepted YES | Wrong YES | Wrong-YES 95% upper | Uncertain YES | Recognised positives | Missed positives | Agreement (AI labels) | Agreement with DeepSeek | Errors | Mean s | Speed-up vs DeepSeek | P-G1..P-G6 (official) | P-G1/P-G2 vs AI labels |",
                      "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |"]
            for arm, item in cell["arms"].items():
                official = " ".join(f"{key[2:]}:{value}" for key, value in item.get("gates", {}).items()) or "control"
                indicative = " ".join(f"{key[2:]}:{value}" for key, value in item.get("indicative_gates_vs_ai_labels", {}).items()) or "control"
                lines.append(f'| {arm} | {item["accepted_yes"]} | {item["wrong_merges"]} | {_number(item["false_merge_upper95"])} | {item["uncertain_accepted"]} | '
                             f'{item["recognised_positives"]} | {item["missed_merges"]} | {_number(item["agreement"])} | {_number(item["agreement_with_deepseek_first_repeat"])} | '
                             f'{item["errors"]} | {_number(item["mean_seconds"])} | {_number(item["speedup_vs_deepseek"], 1)} | {official} | {indicative} |')
            lines.append("")
    diagnostics = summary["diagnostics"]
    lines += ["## Order and repeat sensitivity", "", "| Check | Flips | Valid pairs |", "| --- | --- | --- |"]
    lines += [f"| `{name}` | {count} | {total} |" for name, (count, total) in diagnostics.items()]
    lines += ["", "## Cost and calls", "", f'DeepSeek calls: {summary["calls"]["P1"]}. Clef calls: {summary["calls"][CLEF]} (local, API cost US$0). '
              f'DeepSeek usage plus unresolved worst-case reservations: US${summary["deepseek_accounted_usd"]:.6f} of a US${summary["spend_cap_usd"]:.2f} cap. '
              "Usage costs use published peak rates; they are estimates, not an invoice.", "",
              f'Frozen thresholds (development only): `{json.dumps(summary["thresholds"], sort_keys=True)}`.', "",
              "## Limitations", "", "The labels come from one AI labeller that also wrote the tooling. "
              "The production test split has few duplicate positives and no contradictions, so the false-merge bound in `P-G1` cannot pass on this corpus "
              "and conflicts stay INCONCLUSIVE. Challenge cases are synthetic and sit outside the production gates. "
              "`P-G4` is not applicable because the hybrid is withheld.", ""]
    return "\n".join(lines)
