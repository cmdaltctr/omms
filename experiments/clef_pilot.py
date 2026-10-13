"""Standalone, local Clef diagnostics beside the frozen hosted pair pilot."""

import copy
import json
import time
from http.client import IncompleteRead
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import ProxyHandler, Request, build_opener

from ai_pilot import PilotStopped, _read_reference, validate as validate_baseline
from manifest import digest, file_digest
from pair_metrics import metrics
from providers import NoRedirect, probability
from safety import output_path, reject_symlinks, require_redacted

MODEL = "clef-flash"
ARM = "P6-clef"
ENDPOINT = "http://127.0.0.1:3002/v1/systemone"
PROPS = "http://127.0.0.1:3002/props"
GRID = [0.5, 0.65, 0.8, 0.9, 0.95, 0.99, 1.0]


def code_pins():
    """Pin the separate runner and its dependencies without changing old pins."""
    root = Path(__file__).resolve().parent
    names = ["clef_pilot.py", "03-pair-decisions-2026-10-10/run_clef.py", "ai_pilot.py",
             "checkpoint.py", "manifest.py", "pair_metrics.py", "providers.py", "safety.py"]
    return {name: file_digest(root / name) for name in names}


def prepare(root, baseline_path, model, *, approved=False):
    """Describe an approved local add-on while preserving the hosted evidence."""
    if approved is not True:
        raise ValueError("local inference approval required")
    path = output_path(root / baseline_path, root)
    baseline = json.loads(path.read_text())
    validate_baseline(baseline, path.parent)
    preserved = {path, *root.glob("output/ai-pilot/**/*.json")}
    preserved.update(path.parent / record["path"] for record in baseline["files"].values())
    settings = {"endpoint": ENDPOINT, "questions": baseline["settings"]["questions"], "concurrency": 1,
                "threshold_grid": GRID, "thresholds": {"duplicate": 0.5, "conflict": 0.5}, "code_sha256": code_pins()}
    return copy.deepcopy({"version": 1, "arm": ARM, "reference_kind": "ai-draft", "human_reviewed": False,
                          "baseline_manifest": str(path.relative_to(root)), "model": model, "settings": settings,
                          "settings_sha256": digest(settings), "test_frozen": False,
                          "preserved_files": {str(item.relative_to(root)): file_digest(output_path(item, root)) for item in sorted(preserved)},
                          "approvals": {"local_calls": True, "ai_reference": True, "hosted_calls": False,
                                        "corpus_sha256": baseline["files"]["corpus"]["sha256"]}})


def validate(value, root):
    """Check approvals, corpus, code, weights and unchanged baseline artefacts."""
    try:
        if (value["version"] != 1 or value["arm"] != ARM or value["reference_kind"] != "ai-draft"
                or value["human_reviewed"] is not False):
            raise ValueError("local AI-reference mode required")
        approvals = value["approvals"]
        if approvals["local_calls"] is not True or approvals["ai_reference"] is not True or approvals["hosted_calls"] is not False:
            raise ValueError("local-only approval required")
        for name, pin in value["preserved_files"].items():
            if file_digest(output_path(root / name, root)) != pin:
                raise ValueError("preserved file hash changed")
        path = output_path(root / value["baseline_manifest"], root)
        baseline = json.loads(path.read_text())
        validate_baseline(baseline, path.parent)
        if approvals["corpus_sha256"] != baseline["files"]["corpus"]["sha256"]:
            raise ValueError("approved corpus changed")
        required = {value["baseline_manifest"], "output/ai-pilot/eval_results.json", "output/ai-pilot/eval_results.summary.json", "output/ai-pilot/spending.json"}
        required.update(str((path.parent / pin["path"]).relative_to(root)) for pin in baseline["files"].values())
        if not required.issubset(value["preserved_files"]):
            raise ValueError("baseline evidence pins required")
        settings = value["settings"]
        if settings["endpoint"] != ENDPOINT or settings["concurrency"] != 1 or settings["threshold_grid"] != GRID:
            raise ValueError("local endpoint and sequential settings required")
        if settings["questions"] != baseline["settings"]["questions"] or settings["code_sha256"] != code_pins():
            raise ValueError("questions or code pins changed")
        if digest(settings) != value["settings_sha256"]:
            raise ValueError("settings hash changed")
        for decision in ("duplicate", "conflict"):
            probability(settings["thresholds"][decision])
        pin = value["model"]
        if pin["model"] != MODEL or pin["quantisation"] != "Q8_0" or "--offline" not in pin["launch_args"]:
            raise ValueError("approved Clef model required")
        for name in ("gguf", "server"):
            if file_digest(reject_symlinks(Path(pin[name + "_path"]))) != pin[name + "_sha256"]:
                raise ValueError("model or server hash changed")
        if not pin["server_version"] or not pin["hardware"]:
            raise ValueError("runtime provenance required")
        require_redacted(json.dumps(value))
    except (KeyError, TypeError, OSError, AttributeError) as error:
        raise ValueError("invalid local Clef manifest") from error
    return baseline


def scope(value, split):
    """Bind each checkpoint to one split and the complete add-on manifest."""
    if split not in ("development", "test"):
        raise ValueError("invalid split")
    return digest({"manifest": value, "split": split})


def payload(pair, questions):
    """Keep both complete descriptions as data, with one native Noul question."""
    body = {"model": MODEL, "state": {"A": pair["A"], "B": pair["B"]},
            "questions": {"decision": {"type": "noul", "instructions": questions[pair["decision"]]}}}
    require_redacted(json.dumps(body))
    return body


def local_json(url, body=None):
    """Use loopback without proxies, credentials, redirects or automatic retries."""
    if url not in (ENDPOINT, PROPS):
        raise ValueError("unapproved local endpoint")
    data = json.dumps(body).encode() if body is not None else None
    request = Request(url, data=data, headers={"Content-Type": "application/json"})
    with build_opener(ProxyHandler({}), NoRedirect()).open(request, timeout=30) as response:
        return json.load(response)


def parse(data):
    """Validate native probability and usage, with no hosted API charge."""
    if data.get("model") != MODEL or set(data["answers"]) != {"decision"}:
        raise ValueError("returned model or question differs from pin")
    item, usage = data["answers"]["decision"], data["usage"]
    if item["type"] != "noul":
        raise ValueError("Noul answer required")
    if (type(usage.get("input_tokens")) is not int or not 0 < usage["input_tokens"] <= 8192
            or type(usage.get("output_tokens")) is not int or usage["output_tokens"] != 0):
        raise ValueError("invalid native token usage")
    return {"probability": probability(item["noul"]), "returned_model": data["model"],
            "usage": usage, "usage_cost_usd": 0}


def request(pair, settings):
    """Time one local request and retain only validated fields or an error code."""
    body = payload(pair, settings["questions"])
    start = time.monotonic()
    try:
        data = local_json(ENDPOINT, body)
        if data.get("model") != MODEL:
            result = {"status": "error", "code": "model-mismatch", "fatal": True}
        else:
            result = {"status": "ok", **parse(data)}
    except HTTPError as error:
        result = {"status": "error", "code": "http-error", "http_status": error.code, "fatal": True}
    except TimeoutError:
        result = {"status": "error", "code": "timeout"}
    except (URLError, IncompleteRead):
        result = {"status": "error", "code": "transport-error"}
    except (ValueError, KeyError, TypeError, AttributeError):
        result = {"status": "error", "code": "invalid-answer"}
    return {**result, "duration_seconds": time.monotonic() - start}


def expected_keys(baseline, split):
    """Enumerate original-order cells and development-only swaps."""
    return {f'{pair["id"]}/{ARM}/1/{int(swapped)}' for pair in baseline["pairs"] if pair["split"] == split
            for swapped in ((False, True) if split == "development" else (False,))}


def evaluate(value, root, split, saved, *, retry_failed=False):
    """Run only Clef, preserving failures and every completed checkpoint record."""
    baseline = validate(value, root)
    if split == "test" and (value.get("test_frozen") is not True or not value.get("development_result_sha256")):
        raise ValueError("development freeze required before test inference")
    if saved.fingerprint != scope(value, split):
        raise ValueError("checkpoint scope changed")
    if local_json(PROPS).get("model_path") != value["model"]["gguf_path"]:
        raise ValueError("served model differs from pinned weights")
    for pair in baseline["pairs"]:
        if pair["split"] != split:
            continue
        for swapped in ((False, True) if split == "development" else (False,)):
            key = f'{pair["id"]}/{ARM}/1/{int(swapped)}'
            if not saved.should_run(key, retry_failed=retry_failed):
                continue
            ordered = {**pair, "A": pair["B"], "B": pair["A"]} if swapped else pair
            result = request(ordered, value["settings"])
            if result["status"] == "ok":
                result["answer"] = result["probability"] >= value["settings"]["thresholds"][pair["decision"]]
            row = {**result, "pair_id": pair["id"], "arm": ARM, "decision": pair["decision"], "split": split,
                   "repeat": 1, "swapped": swapped, "reference_kind": "ai-draft"}
            saved.record(key, row, retry_failed=retry_failed)
            print(json.dumps({field: row[field] for field in ("pair_id", "arm", "split", "swapped", "status")}), flush=True)
            if result.get("fatal"):
                raise PilotStopped("local provider failure; partial results saved without retry")
    return saved.records


def freeze(value, root, records):
    """Tune only original-order development cells on the existing threshold grid."""
    path = root / value["baseline_manifest"]
    baseline = json.loads(path.read_text())
    development = {key: row for key, row in records.items() if row["split"] == "development"}
    if set(development) != expected_keys(baseline, "development") or any(row["status"] != "ok" for row in development.values()):
        raise ValueError("complete valid development records required")
    reference = _read_reference(baseline, path.parent)
    frozen = copy.deepcopy(value)
    for decision in ("duplicate", "conflict"):
        primary = [row for row in development.values() if row["decision"] == decision and not row["swapped"]]
        positive = "same" if decision == "duplicate" else "contradict"
        def rank(threshold):
            wrong = uncertain = correct = 0
            for row in primary:
                outcome = reference[row["pair_id"]]["outcome"]
                yes = row["probability"] >= threshold
                wrong += int(yes and outcome not in (positive, "uncertain"))
                uncertain += int(yes and outcome == "uncertain")
                correct += int(outcome != "uncertain" and yes == (outcome == positive))
            return wrong, uncertain, -correct, threshold
        frozen["settings"]["thresholds"][decision] = min(GRID, key=rank)
    frozen["settings_sha256"] = digest(frozen["settings"])
    frozen["test_frozen"] = True
    frozen["development_result_sha256"] = digest(development)
    return frozen


def summarise(value, root, records):
    """Compare test answers to frozen controls without changing their results."""
    path = root / value["baseline_manifest"]
    baseline = json.loads(path.read_text())
    reference = _read_reference(baseline, path.parent)
    controls = json.loads((root / "output/ai-pilot/eval_results.json").read_text())["records"]
    control_summary = json.loads((root / "output/ai-pilot/eval_results.summary.json").read_text())
    expected = expected_keys(baseline, "development") | expected_keys(baseline, "test")
    if not set(records).issubset(expected):
        raise ValueError("unexpected Clef record IDs")
    summary = {"reference_kind": "ai-draft", "human_reviewed": False, "merge_safety_verdict": "INCONCLUSIVE",
               "arm": ARM, "record_count": len(records), "expected_records": len(expected), "complete": set(records) == expected,
               "hosted_calls": 0, "api_cost_usd": 0, "decisions": {}}
    for decision in ("duplicate", "conflict"):
        pairs = [pair for pair in baseline["pairs"] if pair["split"] == "test" and pair["decision"] == decision]
        rows = [row for row in records.values() if row["split"] == "test" and row["decision"] == decision]
        item = metrics(pairs, reference, rows, ARM)
        item.pop("correctness")
        item["pairs"] = len(pairs)
        positive = "same" if decision == "duplicate" else "contradict"
        item["ai_matches"] = sum(row["status"] == "ok" and row["answer"] == (reference[row["pair_id"]]["outcome"] == positive)
                                 for row in rows if reference[row["pair_id"]]["outcome"] != "uncertain")
        item["matches"] = {arm: sum(row["status"] == "ok" and controls[f'{row["pair_id"]}/{arm}/1/0']["status"] == "ok"
                                       and row["answer"] == controls[f'{row["pair_id"]}/{arm}/1/0']["answer"] for row in rows)
                           for arm in ("P1", "P2", "P3")}
        item["speedup_vs_deepseek"] = control_summary["decisions"][decision]["P1"]["mean_seconds"] / item["mean_seconds"] if item["mean_seconds"] else None
        summary["decisions"][decision] = item
    swaps = [(records.get(f'{pair["id"]}/{ARM}/1/0', {}), records.get(f'{pair["id"]}/{ARM}/1/1', {}))
             for pair in baseline["pairs"] if pair["split"] == "development"]
    valid = [(a, b) for a, b in swaps if a.get("status") == b.get("status") == "ok"]
    summary["development_valid_swap_pairs"] = len(valid)
    summary["development_swap_flips"] = sum((a["probability"] >= value["settings"]["thresholds"][a["decision"]]) !=
                                             (b["probability"] >= value["settings"]["thresholds"][b["decision"]]) for a, b in valid)
    return summary
