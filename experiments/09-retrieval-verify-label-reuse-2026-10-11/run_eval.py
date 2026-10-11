"""Experiment 09: calibrated verification gate before first label reuse."""

import argparse
import hashlib
import importlib.metadata
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
EXP03 = HERE.parent / "03-pair-decisions-2026-10-10"
EXP05 = HERE.parent / "05-retrieval-qwen-label-decisions-2026-10-10"
EXP06 = HERE.parent / "06-retrieval-primary-intent-label-selection-2026-10-10"
SOURCE = HERE.parent / "01-label-decisions-2026-10-07/output/revision-01-batch8192"

EXP05_PINS = {"run_eval.py": "3b58ff46edf2d3e5fbb93a524f0dbbcd158ce4c984961cceb1331f67a90b241d"}
EXP06_PINS = {
    "output/eval_results.json": "89de5774c588343003021abe4ddf1343ee37d453d67aa781946155133ec808e8",
    "output/summary.json": "be31ba0664ecc7be3bba09e407ec0cea0618c0a62db8f591a783a6a06f8ac18b",
    "output/run-manifest.json": "6f6d4738325d1cf704b39a0d6d4f030e692fd2f71b5dd3a587ffb1e263cb9c5a",
}
CORPUS_PINS = {
    "corpus/ground-truth.json": "8a4771923c458c45aff494839adf932eb42cdd72cf8bd452c44074bba7484f7c",
    "corpus/catalogue.json": "3d9af990a51225037e5bca52bcaa28ca0d9486da7166a02d27cbb2366f0d52bc",
    "corpus/candidates.json": "c783b5522d44e33c86c1b6969790118b875c35f3c6d96c21bbbe151c4c7d9560",
    "corpus/test-manifest.json": "9572035106415d4c60d608c7948185fa08b030c18c79fa386f53f2935b8bbefd",
    "corpus/annotation-notes.json": "666e54104ce50a6b0eb8eb3bb4e6e94e53debb0718648413e58f64816a252f61",
}
NLI_REPO = "cross-encoder/nli-deberta-v3-small"
NLI_REVISION = "fa2804872c3b4bd748f38c0185cc85775361e735"
NLI_URL = f"https://huggingface.co/{NLI_REPO}/resolve/main/onnx/model_qint8_arm64.onnx"
TOKENIZER_URL = f"https://huggingface.co/{NLI_REPO}/resolve/main/tokenizer.json"
NLI_NAME = "model_qint8_arm64.onnx"
NLI_SHA = "a1da6815c8da542d16381c7d84892d409b4b6604d655bb3054ecb15dd8714e6e"
NLI_BYTES = 172503006
TOK_NAME = "tokenizer.json"
TOK_BYTES = 8656624
LABELS = ("contradiction", "entailment", "neutral")
GRID = [0.5, 0.6, 0.7, 0.75, 0.8, 0.9, 0.95]
ARMS = ("nli", "clef")
CAL_POSITIVE = 60
CAL_NEGATIVE = 1170  # Amended from 1470; the pinned catalogue holds 41 labels, not 51.
BASELINE_COUNTS = {"n": 140, "existing": 71, "correct_existing": 23, "wrong_existing": 48,
                   "accepted_none_fit": 69, "correct_none_fit": 49}
HYPOTHESIS_PREFIX = "The primary requirement of this observation is to "
CLEF_QUESTION = ("Does this category definition describe the observation's primary requirement? "
                 "Answer yes or no.")
CLEF_OPTIONS = {"yes": "Yes, the definition describes the observation's primary requirement.",
                "no": "No, the definition does not describe the observation's primary requirement."}
CLEF_PORT = 3004
OMITTED = {"f37f028b607ada53080ffd18", "b1cb9c6fabb574250de3f653", "eab23004788a8de9ea82bc8f"}
BOUNDARY = {"1467cebd77184343247fa302", "188c3c023907447d10523239", "1f9560db54792f236cf58285"}
SELECTION_RULE = ("smallest grid threshold with wrong accepts at most 2% of accepted development "
                  "pairs and at least 45 of 60 positives retained")

# Authenticate the read-only Experiment 05 helper before importing it.
if hashlib.file_digest(EXP05.joinpath("run_eval.py").open("rb"), "sha256").hexdigest() != EXP05_PINS["run_eval.py"]:
    raise ValueError("input_hash_drift")
_spec = importlib.util.spec_from_file_location("experiment05_readonly", EXP05 / "run_eval.py")
b = importlib.util.module_from_spec(_spec)
_previous = sys.dont_write_bytecode
sys.dont_write_bytecode = True
try:
    _spec.loader.exec_module(b)
finally:
    sys.dont_write_bytecode = _previous


def check_pins(root, pins):
    for name, expected in pins.items():
        if b.file_hash(b.path_in(root, name)) != expected:
            raise ValueError("input_hash_drift")


def baseline_metrics(cases, records):
    counts = dict(BASELINE_COUNTS)
    existing = sum(1 for c in cases if records[c["id"]]["choice"] != "none_fit")
    correct_existing = sum(1 for c in cases if records[c["id"]]["choice"] != "none_fit"
                           and records[c["id"]]["choice"] in c["expected"])
    none_fit = len(cases) - existing
    correct_none_fit = sum(1 for c in cases if records[c["id"]]["choice"] == "none_fit"
                           and records[c["id"]]["choice"] in c["expected"])
    observed = {"n": len(cases), "existing": existing, "correct_existing": correct_existing,
                "wrong_existing": existing - correct_existing, "accepted_none_fit": none_fit,
                "correct_none_fit": correct_none_fit}
    if {k: observed[k] for k in counts} != counts:
        raise ValueError("baseline_counts")
    wrong_reuse = (existing - correct_existing) / existing if existing else None
    return {**observed, "wrong_reuse": wrong_reuse, "review_load": 0.0}


def load_inputs():
    """Authenticate every pinned input before any scoring or inference."""
    check_pins(EXP05, EXP05_PINS)
    check_pins(EXP06, EXP06_PINS)
    check_pins(SOURCE, CORPUS_PINS)
    refs = b.read_json(b.path_in(SOURCE, "corpus/ground-truth.json"))
    dev = [c for c in refs if c["split"] == "development"]
    test = [c for c in refs if c["split"] == "test"]
    b.require(len(dev) == CAL_POSITIVE and len(test) == BASELINE_COUNTS["n"], "split_shape")
    b.require(all(len(c["expected"]) == 1 and c["expected"] != ["none_fit"] for c in dev), "dev_positive_shape")
    catalogue = b.read_json(b.path_in(SOURCE, "corpus/catalogue.json"))
    labels = {row["id"]: row for row in catalogue}
    b.require(len(labels) == len(catalogue) == 41, "catalogue_shape")
    for case in dev:
        b.require(case["expected"][0] in labels
                  and labels[case["expected"][0]]["section"] == case["section"], "dev_label_section")
    saved = b.read_json(b.path_in(EXP06, "output/eval_results.json"))
    records = saved["records"]
    b.require(set(records) == {c["id"] for c in test}, "baseline_selection")
    b.require(all(row["status"] == "ok" for row in records.values()), "invalid_baseline")
    candidates = b.read_json(b.path_in(SOURCE, "corpus/candidates.json"))
    for case in test:
        b.require(records[case["id"]]["choice"] in candidates[case["id"]]["ids"], "baseline_choice")
    return dev, test, catalogue, labels, records, b.preservation(SOURCE)


def dev_pairs(dev, catalogue):
    """One positive pair per case, then every other same-section definition."""
    pairs = []
    for case in dev:
        want = case["expected"][0]
        pairs.append({"pair_id": f'{case["id"]}:{want}', "case_id": case["id"],
                      "label_id": want, "kind": "positive"})
        for label in catalogue:
            if label["section"] == case["section"] and label["id"] != want:
                pairs.append({"pair_id": f'{case["id"]}:{label["id"]}', "case_id": case["id"],
                              "label_id": label["id"], "kind": "negative"})
    b.require(sum(p["kind"] == "positive" for p in pairs) == CAL_POSITIVE
              and sum(p["kind"] == "negative" for p in pairs) == CAL_NEGATIVE
              and len({p["pair_id"] for p in pairs}) == len(pairs), "calibration_shape")
    return pairs


def premise_text(case):
    return b.private_safe(case["description"])


def hypothesis_text(definition):
    text = b.private_safe(definition).strip()
    text = text[0].lower() + text[1:]
    if not text.endswith("."):
        text += "."
    return HYPOTHESIS_PREFIX + text


def softmax3(logits):
    b.require(len(logits) == 3 and all(math.isfinite(v) for v in logits), "nli_logit_shape")
    top = max(logits)
    weights = [math.exp(v - top) for v in logits]
    total = sum(weights)
    return [w / total for w in weights]


def nli_runtime():
    import onnxruntime as ort
    from tokenizers import Tokenizer
    model_dir = b.path_in(HERE, "output/model")
    model = b.path_in(model_dir, NLI_NAME)
    tokenizer_path = b.path_in(model_dir, TOK_NAME)
    b.require(model.stat().st_size == NLI_BYTES and b.file_hash(model) == NLI_SHA, "nli_model_drift")
    b.require(tokenizer_path.stat().st_size == TOK_BYTES, "nli_tokenizer_drift")
    options = ort.SessionOptions()
    options.intra_op_num_threads = 1
    options.inter_op_num_threads = 1
    options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
    session = ort.InferenceSession(str(model), options, providers=["CPUExecutionProvider"])
    names = [i.name for i in session.get_inputs()]
    b.require("input_ids" in names and set(names) <= {"input_ids", "attention_mask", "token_type_ids"},
              "nli_input_shape")
    tokenizer = Tokenizer.from_file(str(tokenizer_path))
    tokenizer.enable_truncation(max_length=512)
    return session, tokenizer, names


def error_code(error):
    text = str(error)
    return text if isinstance(error, ValueError) and re.fullmatch(r"[a-z0-9_]+", text) else type(error).__name__


def nli_score(runtime, case, label):
    session, tokenizer, names = runtime
    started = time.monotonic()
    try:
        encoding = tokenizer.encode(premise_text(case), hypothesis_text(label["definition"]))
        feed = {"input_ids": [encoding.ids], "attention_mask": [encoding.attention_mask]}
        if "token_type_ids" in names:
            feed["token_type_ids"] = [encoding.type_ids]
        logits = session.run(None, feed)[0][0]
        probabilities = softmax3([float(v) for v in logits])
        return {"status": "ok", "p_entailment": probabilities[1],
                "argmax": LABELS[probabilities.index(max(probabilities))],
                "tokens": len(encoding.ids), "duration_seconds": time.monotonic() - started}
    except (ValueError, KeyError, TypeError, OSError, RuntimeError) as error:
        return {"status": "error", "error_code": error_code(error),
                "duration_seconds": time.monotonic() - started}


def clef_pins():
    manifest = b.read_json(b.path_in(EXP03, "corpus/clef-test-manifest.json"))
    model = manifest["model"]
    b.require(model["model"] == "clef-flash" and model["quantisation"] == "Q8_0"
              and "--offline" in model["launch_args"], "clef_pin_shape")
    return model


def verify_clef_runtime(model):
    for kind in ("gguf", "server"):
        path = Path(model[kind + "_path"])
        b.require(not path.is_symlink() and b.file_hash(path) == model[kind + "_sha256"],
                  "clef_runtime_drift")


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, url):
        raise ValueError("redirect_refused")


def http(path, value=None):
    b.require(path in ("/props", "/v1/systemone"), "endpoint_refused")
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    body = json.dumps(value).encode() if value is not None else None
    request = urllib.request.Request(f"http://127.0.0.1:{CLEF_PORT}" + path, data=body,
                                     headers={"Content-Type": "application/json"})
    with opener.open(request, timeout=120) as response:
        return b.decode(response.read().decode())


def clef_state(case, label):
    return {"description": premise_text(case), "section": case["section"],
            "candidate": {"id": label["id"], "definition": b.private_safe(label["definition"])}}


def clef_payload(case, label):
    return {"model": "clef-flash", "state": clef_state(case, label),
            "questions": {"decision": {"type": "choice", "instructions": CLEF_QUESTION,
                                       "criteria": CLEF_OPTIONS}}}


def parse_clef(data):
    b.require(data.get("model") == "clef-flash", "wrong_model")
    item = data["answers"]["decision"]
    b.require(item["type"] == "choice", "answer_type")
    probabilities = item["probabilities"]
    b.require(set(probabilities) == set(CLEF_OPTIONS), "option_shape")
    values = {}
    for key, value in probabilities.items():
        b.require(type(value) in (int, float) and math.isfinite(value) and 0 <= value <= 1,
                  "invalid_probability")
        values[key] = float(value)
    b.require(abs(sum(values.values()) - 1) <= 1e-6, "invalid_probability_sum")
    b.require(item["choice"] in CLEF_OPTIONS, "unexpected_choice")
    usage = data["usage"]
    b.require(type(usage["input_tokens"]) is int and 0 < usage["input_tokens"] <= 8192
              and type(usage["output_tokens"]) is int and usage["output_tokens"] == 0, "invalid_usage")
    confidence = item["confidence"]
    b.require(type(confidence) in (int, float) and math.isfinite(confidence)
              and 0 <= confidence <= 1, "invalid_confidence")
    return {"p_yes": values["yes"], "choice": item["choice"], "provider_confidence": float(confidence),
            "usage": {"input_tokens": usage["input_tokens"], "output_tokens": usage["output_tokens"]}}


def clef_score(case, label):
    started = time.monotonic()
    try:
        return {"status": "ok", **parse_clef(http("/v1/systemone", clef_payload(case, label))),
                "duration_seconds": time.monotonic() - started}
    except (ValueError, KeyError, TypeError, OSError) as error:
        return {"status": "error", "error_code": error_code(error),
                "duration_seconds": time.monotonic() - started}


class OwnedServer:
    """Own only this experiment's child on port 3004; never touch other servers."""

    def __init__(self, model):
        self.model = model

    def __enter__(self):
        with socket.socket() as check:
            check.bind(("127.0.0.1", CLEF_PORT))
        args = list(self.model["launch_args"])
        port = args.index("--port")
        b.require(args[port + 1] == "3002", "clef_pin_shape")
        args[port + 1] = str(CLEF_PORT)
        env = {k: v for k, v in os.environ.items() if not k.startswith("LLAMA_ARG_") and k != "HF_TOKEN"}
        self.started = time.monotonic()
        self.process = subprocess.Popen([self.model["server_path"], *args], env=env,
                                        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            while time.monotonic() - self.started < 300:
                b.require(self.process.poll() is None, "server_start_failed")
                try:
                    if http("/props").get("model_path") == self.model["gguf_path"]:
                        self.startup = time.monotonic() - self.started
                        return self
                except (OSError, ValueError):
                    pass
                time.sleep(0.2)
            raise ValueError("server_readiness_timeout")
        except BaseException:
            self.__exit__(None, None, None)
            raise

    def __exit__(self, *args):
        if self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(timeout=15)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait(timeout=15)

    def preflight(self):
        props = http("/props")
        b.require(Path(props["model_path"]).resolve() == Path(self.model["gguf_path"]).resolve(),
                  "served_file_mismatch")
        b.require("11510" in props["build_info"] and "c35b66744" in props["build_info"],
                  "served_build_mismatch")
        b.require(props["total_slots"] == 1, "slot_mismatch")
        probe_case = {"description": "A synthetic verification probe.", "section": "preferences"}
        probe_label = {"id": "probe_label", "section": "preferences",
                       "definition": "A synthetic probe definition."}
        b.require(clef_score(probe_case, probe_label)["status"] == "ok", "schema_probe_failed")
        return {"startup_seconds": self.startup, "build_info": props["build_info"],
                "pid": self.process.pid, "probe_calls": 1}


def nli_accept(row, tau):
    return row["argmax"] == "entailment" and row["p_entailment"] >= tau


def clef_accept(row, tau):
    return row["p_yes"] >= tau


ACCEPT = {"nli": nli_accept, "clef": clef_accept}


def calibration_points(pairs, records, arm):
    points = []
    for tau in GRID:
        accepted_positive = accepted_negative = 0
        for pair in pairs:
            row = records[f"{arm}/calibration/{pair['pair_id']}"]
            if ACCEPT[arm](row, tau):
                if pair["kind"] == "positive":
                    accepted_positive += 1
                else:
                    accepted_negative += 1
        accepted = accepted_positive + accepted_negative
        wrong_rate = accepted_negative / accepted if accepted else None
        points.append({"threshold": tau, "accepted": accepted, "accepted_positive": accepted_positive,
                       "accepted_negative": accepted_negative, "wrong_accepts": accepted_negative,
                       "wrong_rate": wrong_rate, "retained_positive": accepted_positive,
                       "qualifies": accepted > 0 and wrong_rate is not None and wrong_rate <= 0.02
                       and accepted_positive >= 45})
    return points


def frozen_threshold(points):
    for point in points:
        if point["qualifies"]:
            return point["threshold"]
    return None


def binom_upper(wrong, n, alpha=0.05):
    """Exact one-sided binomial upper bound by standard-library summation."""
    if n <= 0:
        return None
    if wrong >= n:
        return 1.0

    def cdf(p):
        total = 0.0
        for k in range(wrong + 1):
            log_pmf = (math.lgamma(n + 1) - math.lgamma(k + 1) - math.lgamma(n - k + 1)
                       + (k * math.log(p) if k else 0.0) + (n - k) * math.log1p(-p))
            total += math.exp(log_pmf)
        return min(total, 1.0)

    low, high = 0.0, 1.0
    for _ in range(200):
        middle = (low + high) / 2
        if cdf(middle) > alpha:
            low = middle
        else:
            high = middle
    return high


def arm_metrics(test, baseline, records, arm, tau):
    picks = [c for c in test if baseline[c["id"]]["choice"] != "none_fit"]
    passthrough = len(test) - len(picks)
    none_fit_correct = sum(1 for c in test if baseline[c["id"]]["choice"] == "none_fit"
                           and baseline[c["id"]]["choice"] in c["expected"])
    accepted = correct = review = errors = missing = 0
    blocked_wrong = lost_correct = error_correct = error_wrong = 0
    for case in picks:
        row = records.get(f"{arm}/test/{case['id']}")
        is_correct = baseline[case["id"]]["choice"] in case["expected"]
        if row is None:
            missing += 1
        elif row["status"] == "error":
            errors += 1
            error_correct += is_correct
            error_wrong += not is_correct
        elif ACCEPT[arm](row, tau):
            accepted += 1
            correct += is_correct
        else:
            review += 1
            lost_correct += is_correct
            blocked_wrong += not is_correct
    wrong = accepted - correct
    wrong_reuse = wrong / accepted if accepted else None
    classified = passthrough + accepted + review + errors
    return {"n": len(test), "picks": len(picks), "none_fit_passthrough": passthrough,
            "none_fit_correct": none_fit_correct, "accepted_reuse": accepted,
            "correct_accepted": correct, "wrong_accepted": wrong, "routed_review": review,
            "verifier_errors": errors, "missing": missing, "classified": classified,
            "wrong_reuse": wrong_reuse, "review_load": (review + errors) / len(test),
            "routing": {"accepted_correct": correct, "accepted_wrong": wrong,
                        "blocked_wrong": blocked_wrong, "lost_correct": lost_correct,
                        "error_correct": error_correct, "error_wrong": error_wrong},
            "gates": {"G2_completeness": missing == 0 and classified == len(test),
                      "G3_safety": accepted > 0 and wrong_reuse is not None and wrong_reuse < 0.02,
                      "G4_retention": correct >= 19,
                      "G5_review_load": review + errors <= 0.7 * len(test)}}


def subgroup_rows(test, baseline, records, arm, tau):
    rows = []
    for case in test:
        if case["id"] not in OMITTED | BOUNDARY:
            continue
        choice = baseline[case["id"]]["choice"]
        if choice == "none_fit":
            classification = "none_fit_passthrough"
        else:
            row = records.get(f"{arm}/test/{case['id']}")
            classification = ("missing" if row is None else "error" if row["status"] == "error"
                              else "accepted_reuse" if ACCEPT[arm](row, tau) else "review")
        rows.append({"case_id": case["id"],
                     "subgroup": "omitted_candidates" if case["id"] in OMITTED else "boundary_cases",
                     "expected": case["expected"], "baseline_choice": choice,
                     "classification": classification})
    return rows


def event_order(run_manifest, arm):
    events = run_manifest["events"]
    marks = [(i, e) for i, e in enumerate(events) if e.get("arm") == arm]
    calibrate = next((i for i, e in marks if e["event"] == "calibrate_complete" and e.get("threshold") is not None), None)
    test = next((i for i, e in marks if e["event"] == "test_start"), None)
    return calibrate is not None and test is not None and calibrate < test


def summarise(test, baseline, saved, calibration, run_manifest, integrity):
    result = {"manifest_digest": saved["manifest_digest"], "baseline": baseline_metrics(test, baseline),
              "arms": {}, "validity": "INCONCLUSIVE", "human_reviewed": False,
              "interval_method": "exact one-sided 95% binomial upper bound, standard-library summation"}
    for arm in ARMS:
        arm_cal = calibration["arms"].get(arm)
        test_rows = {key: row for key, row in saved["records"].items() if key.startswith(f"{arm}/test/")}
        if arm_cal is None:
            result["arms"][arm] = {"status": "not_calibrated"}
            continue
        entry = {"calibration": {"frozen_threshold": arm_cal["frozen_threshold"],
                                 "status": arm_cal["status"], "pairs": arm_cal["pairs"]}}
        if arm_cal["status"] != "frozen" or arm_cal["frozen_threshold"] is None:
            entry["status"] = "calibration_failed"
            result["arms"][arm] = entry
            continue
        tau = arm_cal["frozen_threshold"]
        entry["threshold"] = tau
        if not test_rows:
            entry["status"] = "not_tested"
            result["arms"][arm] = entry
            continue
        entry["status"] = "tested"
        metrics = arm_metrics(test, baseline, saved["records"], arm, tau)
        frozen_first = (event_order(run_manifest, arm)
                        and run_manifest["frozen_thresholds"].get(arm) == tau)
        gates = {"G1_integrity": bool(integrity and frozen_first), **metrics["gates"]}
        verdict = ("INCONCLUSIVE" if metrics["verifier_errors"] > 0 or not gates["G2_completeness"]
                   else "PASS" if all(gates.values()) else "FAIL")
        interval = None
        if metrics["accepted_reuse"] > 0:
            interval = {"wrong": metrics["wrong_accepted"], "accepted": metrics["accepted_reuse"],
                        "upper_bound_95_one_sided": binom_upper(metrics["wrong_accepted"],
                                                                metrics["accepted_reuse"])}
        entry.update({"metrics": metrics, "gates": gates, "verdict": verdict,
                      "wrong_reuse_upper_bound": interval,
                      "subgroups": subgroup_rows(test, baseline, saved["records"], arm, tau)})
        result["arms"][arm] = entry
    verdicts = [entry.get("verdict") for entry in result["arms"].values()]
    result["overall_functional"] = ("PASS" if "PASS" in verdicts else
                                    "INCONCLUSIVE" if "INCONCLUSIVE" in verdicts else "FAIL")
    result["decision"] = {
        "any_arm_passed": "PASS" in verdicts,
        "rule": ("An arm passing all gates becomes the candidate mechanism for a later production "
                 "design proposal. If no arm passes, stop. Validity stays INCONCLUSIVE because the "
                 "reference is AI-authored and previously inspected.")}
    return result


def validate_saved(saved, fingerprint, dev, test, catalogue, baseline):
    b.require(saved.get("manifest_digest") == fingerprint, "resume_fingerprint_mismatch")
    expected = set()
    for arm in ARMS:
        for pair in dev_pairs(dev, catalogue):
            expected.add(f"{arm}/calibration/{pair['pair_id']}")
        for case in test:
            if baseline[case["id"]]["choice"] != "none_fit":
                expected.add(f"{arm}/test/{case['id']}")
    records = saved.get("records", {})
    b.require(set(records) <= expected, "unknown_saved_record")
    for key, row in records.items():
        arm, phase, identifier = key.split("/", 2)
        b.require(row.get("arm") == arm and row.get("phase") == phase, "invalid_saved_record")
        b.require(row.get("pair_id" if phase == "calibration" else "case_id") == identifier,
                  "invalid_saved_record")
        b.require(row.get("status") in ("ok", "error"), "invalid_saved_record")
        b.require(not (set(row) & {"description", "definition", "prompt", "reply"}), "content_leak")
        if row["status"] == "ok":
            score = row.get("p_entailment") if arm == "nli" else row.get("p_yes")
            b.require(type(score) in (int, float) and math.isfinite(score) and 0 <= score <= 1,
                      "invalid_saved_score")
            if arm == "nli":
                b.require(row.get("argmax") in LABELS, "invalid_saved_score")
            if arm == "clef":
                b.require(row.get("choice") in CLEF_OPTIONS, "invalid_saved_score")
    return records


def earlier_hashes():
    prefixes = tuple(f"{i:02d}" for i in range(1, 9))
    return {str(p.relative_to(HERE.parent)): b.file_hash(p)
            for folder in sorted(HERE.parent.iterdir())
            if folder.is_dir() and folder.name[:2] in prefixes
            for p in sorted(folder.rglob("*"))
            if p.is_file() and not p.is_symlink() and p.suffix in (".py", ".md", ".json")
            and "__pycache__" not in p.parts}


def plan_core_digest():
    plan = b.read_json(b.path_in(HERE, "plan.json"))
    return b.digest({k: v for k, v in plan.items() if k != "status"})


def manifest_for(dev, test, catalogue, preserved):
    model_dir = b.path_in(HERE, "output/model")
    model = b.path_in(model_dir, NLI_NAME)
    tokenizer = b.path_in(model_dir, TOK_NAME)
    b.require(model.stat().st_size == NLI_BYTES and b.file_hash(model) == NLI_SHA, "nli_model_drift")
    b.require(tokenizer.stat().st_size == TOK_BYTES, "nli_tokenizer_drift")
    pins = clef_pins()
    versions = {"python": sys.version.split()[0]}
    for name in ("onnxruntime", "tokenizers"):
        versions[name] = importlib.metadata.version(name)
    commit = subprocess.run(["git", "rev-parse", "HEAD"], cwd=HERE, capture_output=True,
                            text=True, check=True).stdout.strip()
    return {"runner_sha256": b.file_hash(Path(__file__)), "plan_core_digest": plan_core_digest(),
            "input_sha256": {"exp05_runner": EXP05_PINS, "exp06": EXP06_PINS, "corpus": CORPUS_PINS},
            "corpus_counts": {"development": len(dev), "test": len(test),
                              "catalogue_labels": len(catalogue),
                              "sections": {s: sum(l["section"] == s for l in catalogue)
                                           for s in ("preferences", "patterns")}},
            "baseline_counts": BASELINE_COUNTS,
            "calibration_plan": {"positive_pairs": CAL_POSITIVE, "negative_pairs": CAL_NEGATIVE,
                                 "grid": GRID, "selection_rule": SELECTION_RULE,
                                 "amendment": ("negative pairs corrected from 1470 to 1170; the pinned "
                                               "catalogue holds 41 labels, not 51; see plan.json amendments")},
            "nli": {"repo": NLI_REPO, "revision": NLI_REVISION, "url": NLI_URL, "file": NLI_NAME,
                    "sha256": NLI_SHA, "bytes": NLI_BYTES, "tokenizer_file": TOK_NAME,
                    "tokenizer_bytes": TOK_BYTES, "tokenizer_sha256": b.file_hash(tokenizer),
                    "label_order": list(LABELS),
                    "runtime": "onnxruntime CPU, offline, single thread, sequential",
                    "truncation_max_tokens": 512},
            "clef": {"port": CLEF_PORT, "alias": "clef-flash", "question": CLEF_QUESTION,
                     "options": CLEF_OPTIONS,
                     "pins_source": "experiments/03-pair-decisions-2026-10-10/corpus/clef-test-manifest.json",
                     "pins": {k: pins[k] for k in ("gguf_path", "gguf_sha256", "server_path",
                                                   "server_sha256", "server_version", "launch_args")},
                     "request": {"temperature": 0,
                                 "seed": "not applicable: native probability scoring without generation"}},
            "versions": versions, "git_commit": commit,
            "earlier_file_sha256": earlier_hashes(), "preservation": preserved,
            "approval": {"installs": True, "nli_download": True, "owned_clef_server": True,
                         "source": "User approved all three execution items on 2026-10-11"},
            "subgroups": {"omitted_candidates": sorted(OMITTED), "boundary_cases": sorted(BOUNDARY)}}


def verify_model_files(static, records):
    model_dir = b.path_in(HERE, "output/model")
    model = b.path_in(model_dir, NLI_NAME)
    b.require(model.stat().st_size == static["nli"]["bytes"]
              and b.file_hash(model) == static["nli"]["sha256"], "nli_model_drift")
    tokenizer = b.path_in(model_dir, static["nli"]["tokenizer_file"])
    b.require(tokenizer.stat().st_size == static["nli"]["tokenizer_bytes"]
              and b.file_hash(tokenizer) == static["nli"]["tokenizer_sha256"], "nli_tokenizer_drift")
    if any(key.startswith("clef/") for key in records):
        pins = static["clef"]["pins"]
        for kind in ("gguf", "server"):
            path = Path(pins[kind + "_path"])
            b.require(not path.is_symlink() and b.file_hash(path) == pins[kind + "_sha256"],
                      "clef_runtime_drift")


def score_pair(arm, runtime, case, label):
    if arm == "nli":
        return nli_score(runtime, case, label)
    return clef_score(case, label)


def checkpoint_pairs(arm, runtime, items, saved, save, key_of, row_of):
    total = len(items)
    done = sum(1 for item in items if key_of(item) in saved["records"])
    for item in items:
        key = key_of(item)
        if key in saved["records"]:
            continue
        row = {**row_of(item), **score_pair(arm, runtime, item["case"], item["label"])}
        saved["records"][key] = row
        save(saved)
        done += 1
        print(f"Completed {done}/{total} ({arm}): {row['status']}", flush=True)


def download_nli():
    def fetch(url, name, expected_bytes, expected_sha=None):
        model_dir = b.path_in(HERE, "output/model")
        model_dir.mkdir(parents=True, exist_ok=True)
        target = b.path_in(model_dir, name)
        if target.exists() and target.stat().st_size == expected_bytes:
            if expected_sha is None or b.file_hash(target) == expected_sha:
                print(f"{name}: already present and verified", flush=True)
                return
        temporary = target.with_name(name + ".tmp")
        started = time.monotonic()
        with urllib.request.urlopen(urllib.request.Request(url), timeout=120) as response, \
                temporary.open("wb") as stream:
            while block := response.read(1 << 20):
                stream.write(block)
        if temporary.stat().st_size != expected_bytes:
            temporary.unlink()
            raise ValueError("download_mismatch")
        digest = b.file_hash(temporary)
        if expected_sha is not None and digest != expected_sha:
            temporary.unlink()
            raise ValueError("download_mismatch")
        temporary.replace(target)
        print(f"{name}: {expected_bytes} bytes, sha256 {digest}, "
              f"{time.monotonic() - started:.1f}s", flush=True)

    fetch(NLI_URL, NLI_NAME, NLI_BYTES, NLI_SHA)
    fetch(TOKENIZER_URL, TOK_NAME, TOK_BYTES)


def integrity_checks(static):
    check_pins(EXP05, EXP05_PINS)
    check_pins(EXP06, EXP06_PINS)
    check_pins(SOURCE, CORPUS_PINS)
    b.require(earlier_hashes() == static["earlier_file_sha256"], "preservation_drift")
    b.require(b.preservation(SOURCE) == static["preservation"], "preservation_drift")


def run_calibrate(arm, dev, test, catalogue, baseline, saved, save, output, run_manifest, fingerprint):
    calibration_path = b.path_in(output, "calibration.json")
    calibration = {"manifest_digest": fingerprint, "arms": {}}
    if calibration_path.exists():
        calibration = b.read_json(calibration_path)
        b.require(calibration["manifest_digest"] == fingerprint, "calibration_fingerprint_mismatch")
        b.require(arm not in calibration["arms"], "calibration_already_frozen")
    pairs = dev_pairs(dev, catalogue)
    items = [{"key": f"{arm}/calibration/{p['pair_id']}", "case_id": p["case_id"],
              "pair_id": p["pair_id"], "label_id": p["label_id"], "kind": p["kind"],
              "case": dev_case(dev, p["case_id"]), "label": catalogue_label(catalogue, p["label_id"])}
             for p in pairs]
    pending = [item for item in items if item["key"] not in saved["records"]]
    if pending:
        if arm == "nli":
            checkpoint_pairs(arm, nli_runtime(), items, saved, save,
                             lambda item: item["key"],
                             lambda item: {"arm": arm, "phase": "calibration",
                                           "pair_id": item["pair_id"], "case_id": item["case_id"],
                                           "label_id": item["label_id"], "kind": item["kind"]})
        else:
            model = clef_pins()
            verify_clef_runtime(model)
            with OwnedServer(model) as server:
                server.preflight()
                checkpoint_pairs(arm, None, items, saved, save,
                                 lambda item: item["key"],
                                 lambda item: {"arm": arm, "phase": "calibration",
                                               "pair_id": item["pair_id"], "case_id": item["case_id"],
                                               "label_id": item["label_id"], "kind": item["kind"]})
    errors = [key for key, row in saved["records"].items()
              if key.startswith(f"{arm}/calibration/") and row["status"] == "error"]
    b.require(not errors, "calibration_error_rows")
    points = calibration_points(pairs, saved["records"], arm)
    tau = frozen_threshold(points)
    status = "frozen" if tau is not None else "failed"
    calibration["arms"][arm] = {"status": status, "frozen_threshold": tau,
                                "pairs": {"positive": CAL_POSITIVE, "negative": CAL_NEGATIVE},
                                "grid": GRID, "points": points, "selection_rule": SELECTION_RULE}
    b.atomic_json(calibration_path, calibration)
    if tau is not None:
        run_manifest["frozen_thresholds"][arm] = tau
    run_manifest["events"].append({"event": "calibrate_complete", "arm": arm, "status": status,
                                   "threshold": tau, "pairs_scored": len(pairs)})
    b.atomic_json(b.path_in(output, "run-manifest.json"), run_manifest)
    integrity_checks(run_manifest["static"])
    summary = summarise(test, baseline, saved, b.read_json(b.path_in(output, "calibration.json")),
                        run_manifest, integrity=True)
    b.atomic_json(b.path_in(output, "summary.json"), summary)
    print(f"{arm} calibration {status}; threshold {tau}", flush=True)


def dev_case(dev, case_id):
    return next(c for c in dev if c["id"] == case_id)


def catalogue_label(catalogue, label_id):
    return next(l for l in catalogue if l["id"] == label_id)


def run_test(arm, test, catalogue, labels, baseline, saved, save, output, run_manifest):
    calibration_path = b.path_in(output, "calibration.json")
    b.require(calibration_path.exists(), "arm_not_calibrated")
    calibration = b.read_json(calibration_path)
    arm_cal = calibration["arms"].get(arm)
    b.require(arm_cal is not None, "arm_not_calibrated")
    b.require(arm_cal["status"] == "frozen" and arm_cal["frozen_threshold"] is not None,
              "calibration_failed_test_refused")
    tau = arm_cal["frozen_threshold"]
    b.require(run_manifest["frozen_thresholds"].get(arm) == tau, "threshold_not_frozen_in_manifest")
    run_manifest["events"].append({"event": "test_start", "arm": arm, "threshold": tau})
    b.atomic_json(b.path_in(output, "run-manifest.json"), run_manifest)
    picks = [c for c in test if baseline[c["id"]]["choice"] != "none_fit"]
    b.require(len(picks) == BASELINE_COUNTS["existing"], "pick_shape")
    items = [{"key": f"{arm}/test/{c['id']}", "case": c, "label": labels[baseline[c["id"]]["choice"]]}
             for c in picks]
    pending = [item for item in items if item["key"] not in saved["records"]]
    if pending:
        if arm == "nli":
            checkpoint_pairs(arm, nli_runtime(), items, saved, save,
                             lambda item: item["key"],
                             lambda item: {"arm": arm, "phase": "test", "case_id": item["case"]["id"],
                                           "verified_choice": baseline[item["case"]["id"]]["choice"]})
        else:
            model = clef_pins()
            verify_clef_runtime(model)
            with OwnedServer(model) as server:
                server.preflight()
                checkpoint_pairs(arm, None, items, saved, save,
                                 lambda item: item["key"],
                                 lambda item: {"arm": arm, "phase": "test",
                                               "case_id": item["case"]["id"],
                                               "verified_choice": baseline[item["case"]["id"]]["choice"]})
    integrity_checks(run_manifest["static"])
    summary = summarise(test, baseline, saved, calibration, run_manifest, integrity=True)
    b.atomic_json(b.path_in(output, "summary.json"), summary)
    b.atomic_json(b.path_in(output, "verification.json"),
                  {"manifest_digest": saved["manifest_digest"], "records": len(saved["records"]),
                   "post_pins_verified": True})
    for name in ARMS:
        entry = summary["arms"][name]
        print(f"{name}: {entry.get('status')} verdict {entry.get('verdict')}", flush=True)
    print(f"Overall functional: {summary['overall_functional']}", flush=True)


def execute(phase=None, arm=None, resume=False):
    if phase == "download":
        download_nli()
        return
    dev, test, catalogue, labels, baseline, preserved = load_inputs()
    static = manifest_for(dev, test, catalogue, preserved)
    fingerprint = b.digest(static)
    output = b.path_in(HERE, "output")
    manifest_path = b.path_in(output, "run-manifest.json")
    results_path = b.path_in(output, "eval_results.json")
    run_manifest = None
    if manifest_path.exists():
        b.require(resume or phase == "verify", "existing_run_requires_resume")
        run_manifest = b.read_json(manifest_path)
        b.require(run_manifest["static"] == static, "manifest_changed_on_resume")
    saved = {"manifest_digest": fingerprint, "records": {}}
    if results_path.exists():
        b.require(resume or phase == "verify", "existing_run_requires_resume")
        saved = b.read_json(results_path)
        validate_saved(saved, fingerprint, dev, test, catalogue, baseline)
    if phase == "verify":
        execute_verify(dev, test, catalogue, baseline, static, saved, output)
        return
    b.require(phase in ("calibrate", "test") and arm in ARMS, "phase_required")
    output.mkdir(parents=True, exist_ok=True)
    if run_manifest is None:
        run_manifest = {"static": static, "frozen_thresholds": {}, "events": []}
        b.atomic_json(manifest_path, run_manifest)

    def save(value):
        b.atomic_json(results_path, value)

    if not results_path.exists():
        save(saved)
    if phase == "calibrate":
        run_calibrate(arm, dev, test, catalogue, baseline, saved, save, output, run_manifest,
                      fingerprint)
    else:
        run_test(arm, test, catalogue, labels, baseline, saved, save, output, run_manifest)


def execute_verify(dev, test, catalogue, baseline, static, saved, output):
    b.require(earlier_hashes() == static["earlier_file_sha256"], "preservation_drift")
    b.require(b.preservation(SOURCE) == static["preservation"], "preservation_drift")
    run_manifest = b.read_json(b.path_in(output, "run-manifest.json"))
    b.require(run_manifest["static"] == static, "manifest_static_mismatch")
    calibration = b.read_json(b.path_in(output, "calibration.json"))
    b.require(calibration["manifest_digest"] == saved["manifest_digest"],
              "calibration_fingerprint_mismatch")
    verify_model_files(static, saved["records"])
    pairs = dev_pairs(dev, catalogue)
    for arm, arm_cal in calibration["arms"].items():
        rows = {key: row for key, row in saved["records"].items()
                if key.startswith(f"{arm}/calibration/")}
        b.require(len(rows) == len(pairs) and all(row["status"] == "ok" for row in rows.values()),
                  "calibration_incomplete")
        points = calibration_points(pairs, saved["records"], arm)
        b.require(arm_cal["points"] == points
                  and arm_cal["frozen_threshold"] == frozen_threshold(points), "calibration_mismatch")
    summary_path = b.path_in(output, "summary.json")
    b.require(summary_path.exists(), "summary_missing")
    summary = summarise(test, baseline, saved, calibration, run_manifest, integrity=True)
    b.require(b.read_json(summary_path) == summary, "summary_mismatch")
    for arm in ARMS:
        if not any(key.startswith(f"{arm}/test/") for key in saved["records"]):
            continue
        arm_cal = calibration["arms"][arm]
        b.require(arm_cal["status"] == "frozen", "test_without_frozen_threshold")
        b.require(run_manifest["frozen_thresholds"].get(arm) == arm_cal["frozen_threshold"],
                  "threshold_not_frozen_in_manifest")
        b.require(event_order(run_manifest, arm), "freeze_order_violation")
    print(f"Verified pins, calibration freeze order, gates and summary; "
          f"{len(saved['records'])} records; zero inference, writes or server calls", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--phase", choices=("download", "calibrate", "test", "verify"))
    parser.add_argument("--arm", choices=ARMS)
    parser.add_argument("--resume", action="store_true")
    args = parser.parse_args()
    if not args.phase:
        parser.error("one of --phase download|calibrate|test|verify is required")
    if args.phase in ("calibrate", "test") and not args.arm:
        parser.error(f"--phase {args.phase} requires --arm")
    if args.phase in ("download", "verify") and args.arm:
        parser.error(f"--phase {args.phase} takes no --arm")
    execute(args.phase, args.arm, args.resume)
