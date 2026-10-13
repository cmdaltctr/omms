"""Validate the blind decisions, freeze the human reference, re-score, verify."""

import argparse
import hashlib
import importlib.util
import json
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
EXP05 = HERE.parent / "05-retrieval-qwen-label-decisions-2026-10-10"
EXP06 = HERE.parent / "06-retrieval-primary-intent-label-selection-2026-10-10"
EXP05_PIN = "3b58ff46edf2d3e5fbb93a524f0dbbcd158ce4c984961cceb1331f67a90b241d"
CORPUS_PINS = {
    "corpus/ground-truth.json": "8a4771923c458c45aff494839adf932eb42cdd72cf8bd452c44074bba7484f7c",
    "corpus/catalogue.json": "3d9af990a51225037e5bca52bcaa28ca0d9486da7166a02d27cbb2366f0d52bc",
    "corpus/candidates.json": "c783b5522d44e33c86c1b6969790118b875c35f3c6d96c21bbbe151c4c7d9560",
    "corpus/test-manifest.json": "9572035106415d4c60d608c7948185fa08b030c18c79fa386f53f2935b8bbefd",
    "corpus/annotation-notes.json": "666e54104ce50a6b0eb8eb3bb4e6e94e53debb0718648413e58f64816a252f61",
}
EXP06_PIN = {"output/eval_results.json":
             "89de5774c588343003021abe4ddf1343ee37d453d67aa781946155133ec808e8"}
OMITTED = {"f37f028b607ada53080ffd18", "b1cb9c6fabb574250de3f653", "eab23004788a8de9ea82bc8f"}
BOUNDARY = {"1467cebd77184343247fa302", "188c3c023907447d10523239", "1f9560db54792f236cf58285"}
SPECIAL = {"none_fit", "uncertain"}

if hashlib.file_digest(EXP05.joinpath("run_eval.py").open("rb"), "sha256").hexdigest() != EXP05_PIN:
    raise ValueError("input_hash_drift")
_spec = importlib.util.spec_from_file_location("experiment05_readonly", EXP05 / "run_eval.py")
b = importlib.util.module_from_spec(_spec)
_previous = sys.dont_write_bytecode
sys.dont_write_bytecode = True
try:
    _spec.loader.exec_module(b)
finally:
    sys.dont_write_bytecode = _previous


def check_pins():
    for name, expected in CORPUS_PINS.items():
        b.require(b.file_hash(b.path_in(b.SOURCE, name)) == expected, "input_hash_drift")
    for name, expected in EXP06_PIN.items():
        b.require(b.file_hash(b.path_in(EXP06, name)) == expected, "input_hash_drift")
    b.require(b.preservation(b.SOURCE)["original_files"] == 97, "preservation_drift")


def load_inputs():
    """Pinned corpus and saved answers; the AI reference stays unread by the page builder."""
    check_pins()
    refs = b.read_json(b.path_in(b.SOURCE, "corpus/ground-truth.json"))
    catalogue = b.read_json(b.path_in(b.SOURCE, "corpus/catalogue.json"))
    labels = {l["id"]: l for l in catalogue}
    cases = [c for c in refs if c["split"] == "test"]
    b.require(len(cases) == 140, "split_shape")
    saved = b.read_json(b.path_in(EXP06, "output/eval_results.json"))["records"]
    b.require(set(saved) == {c["id"] for c in cases}, "baseline_selection")
    b.require(all(row["status"] == "ok" for row in saved.values()), "invalid_baseline")
    return cases, labels, saved


def valid_choices(case, labels):
    return {l["id"] for l in labels.values() if l["section"] == case["section"]} | SPECIAL


def validate_decisions(cases, labels, payload):
    """Refuse incomplete work; every case needs one valid outcome."""
    entries = payload.get("answers")
    b.require(isinstance(entries, list), "decisions_shape")
    by_key = {}
    for entry in entries:
        b.require(isinstance(entry, dict) and set(entry) <= {"key", "label", "note"},
                  "decisions_shape")
        b.require(entry.get("key") not in by_key, "duplicate_case")
        by_key[entry["key"]] = entry
    b.require(set(by_key) == {c["id"] for c in cases}, "decisions_incomplete")
    decisions = {}
    for case in cases:
        entry = by_key[case["id"]]
        label = entry.get("label")
        note = entry.get("note", "")
        b.require(isinstance(label, str) and label in valid_choices(case, labels), "invalid_choice")
        b.require(not note or (isinstance(note, str) and len(note) <= 500), "invalid_note")
        decisions[case["id"]] = {"label": label, **({"note": note} if note else {})}
    return decisions


def agreement(cases, decisions):
    """Compare the human labels with the AI reference, case by case."""
    rows, counts = [], {"agree": 0, "disagree": 0, "uncertain": 0}
    for case in cases:
        human = decisions[case["id"]]["label"]
        ai = case["expected"]
        if human == "uncertain":
            counts["uncertain"] += 1
        elif human in ai:
            counts["agree"] += 1
        else:
            counts["disagree"] += 1
        if case["id"] in OMITTED | BOUNDARY:
            rows.append({"case_id": case["id"], "subgroup":
                         "omitted_candidates" if case["id"] in OMITTED else "boundary_cases",
                         "ai_expected": ai, "human": human})
    return {**counts, "n": len(cases),
            "disagreement_rate": counts["disagree"] / len(cases),
            "by_ai_reference": {
                "ai_existing": sum(1 for c in cases if c["expected"] != ["none_fit"]
                                   and decisions[c["id"]]["label"] not in c["expected"]
                                   and decisions[c["id"]]["label"] != "uncertain"),
                "ai_none_fit": sum(1 for c in cases if c["expected"] == ["none_fit"]
                                   and decisions[c["id"]]["label"] != "none_fit"
                                   and decisions[c["id"]]["label"] != "uncertain")},
            "special_cases": rows}


def rescore(cases, saved, decisions):
    """Score the saved Experiment 06 answers against the human reference."""
    rated = [c for c in cases if decisions[c["id"]]["label"] != "uncertain"]
    uncertain = len(cases) - len(rated)
    existing = correct = 0
    for case in rated:
        choice = saved[case["id"]]["choice"]
        if choice != "none_fit":
            existing += 1
            correct += choice == decisions[case["id"]]["label"]
    none_fit = [c for c in rated if saved[c["id"]]["choice"] == "none_fit"]
    correct_none_fit = sum(saved[c["id"]]["choice"] == decisions[c["id"]]["label"]
                           for c in none_fit)
    wrong = existing - correct
    wrong_reuse = wrong / existing if existing else None
    return {"rated_cases": len(rated), "uncertain_excluded": uncertain,
            "existing": existing, "correct_existing": correct, "wrong_existing": wrong,
            "wrong_reuse": wrong_reuse,
            "wrong_reuse_below_2_percent": existing > 0 and wrong_reuse is not None
            and wrong_reuse < 0.02,
            "accepted_none_fit": len(none_fit), "correct_none_fit": correct_none_fit,
            "ai_reference_comparison": {"existing": 71, "correct_existing": 23,
                                        "wrong_existing": 48}}


def summarise(cases, labels, saved, decisions):
    choices = {c["id"]: valid_choices(c, labels) for c in cases}
    return {"gates": {
                "G1_integrity": True,
                "G3_completeness": set(decisions) == set(choices) and all(
                    d["label"] in choices[k] for k, d in decisions.items())},
            "agreement": agreement(cases, decisions),
            "rescored_experiment06": rescore(cases, saved, decisions),
            "operator": "Dr Muhammad Aizat Md Hawari",
            "mode": "AI-drafted and cross-judged, batch-confirmed by operator instruction",
            "validity": ("OPERATOR-ARBITRATED reference: the 10 disputed cases received "
                         "individual human decisions; the 124 two-agent-agreed cases were "
                         "accepted wholesale without individual review; confirmation anchoring "
                         "and batch acceptance are recorded risks. Weaker than per-case human "
                         "confirmation, stronger than a single unreviewed AI pass"),
            "human_reviewed": "partial: disputes only"}


def manifest_for(decisions_path):
    """Fingerprint everything the frozen reference depends on, except its own bytes."""
    def sha(name):
        path = b.path_in(HERE, "corpus") / name
        return b.file_hash(path) if path.exists() else None
    return {"runner_sha256": b.file_hash(Path(__file__)),
            "corpus_pins": CORPUS_PINS, "exp06_pins": EXP06_PIN,
            "decisions_sha256": b.file_hash(decisions_path),
            "agent_draft_sha256": sha("agent-draft-decisions.json"),
            "agent_judge_sha256": sha("agent-judge-verdicts.json"),
            "agent_response_sha256": sha("agent-draft-response.json")}


def execute(resume=False, verify=False):
    cases, labels, saved = load_inputs()
    decisions_path = b.path_in(HERE, "corpus/adjudication-decisions.json")
    reference_path = b.path_in(HERE, "corpus/adjudicated-reference.json")
    summary_path = b.path_in(b.path_in(HERE, "output"), "summary.json")
    if verify:
        b.require(decisions_path.exists() and reference_path.exists() and summary_path.exists(),
                  "missing_frozen_outputs")
        reference = b.read_json(reference_path)
        b.require(reference["manifest_digest"] == b.digest(manifest_for(decisions_path)),
                  "reference_fingerprint_mismatch")
        plan = b.read_json(b.path_in(HERE, "plan.json"))
        pinned = plan.get("frozen", {}).get("adjudication", {}).get("reference_sha256")
        b.require(pinned is not None and b.file_hash(reference_path) == pinned, "reference_pin_mismatch")
        b.require(reference["decisions"] == validate_decisions(
            cases, labels, b.read_json(decisions_path)), "decisions_drift")
        expected_summary = summarise(cases, labels, saved, reference["decisions"])
        expected_summary["manifest_digest"] = reference["manifest_digest"]
        b.require(b.read_json(summary_path) == expected_summary, "summary_mismatch")
        check_pins()
        print("Verified decisions, frozen reference and summary; zero writes", flush=True)
        return
    b.require(decisions_path.exists(), "decisions_missing")
    b.require(not reference_path.exists(), "reference_already_frozen")
    decisions = validate_decisions(cases, labels, b.read_json(decisions_path))
    output = b.path_in(HERE, "output")
    output.mkdir(parents=True, exist_ok=True)
    manifest = manifest_for(decisions_path)
    reference = {"manifest_digest": b.digest(manifest), "operator":
                 "Dr Muhammad Aizat Md Hawari", "created": time.strftime("%Y-%m-%d"),
                 "mode": ("AI-drafted and cross-judged, batch-confirmed by operator instruction: "
                          "an independent agent drafted every case from blind inputs, a second "
                          "agent judged all 140, the drafter reconsidered the 16 disagreements, "
                          "and the operator took the judge's labels for the 10 remaining "
                          "disputes and accepted the 130 consensus cases wholesale"),
                 "ai_drafted": bool(manifest["agent_draft_sha256"]),
                 "agent_draft_sha256": manifest["agent_draft_sha256"],
                 "agent_judge_sha256": manifest["agent_judge_sha256"],
                 "agent_response_sha256": manifest["agent_response_sha256"],
                 "inputs_sha256": {"corpus": CORPUS_PINS, "exp06": EXP06_PIN},
                 "decisions": decisions}
    b.atomic_json(reference_path, reference)
    plan_path = b.path_in(HERE, "plan.json")
    plan = b.read_json(plan_path)
    plan["frozen"]["adjudication"]["reference_sha256"] = b.file_hash(reference_path)
    b.atomic_json(plan_path, plan)
    summary = summarise(cases, labels, saved, decisions)
    summary["manifest_digest"] = b.digest(manifest)
    b.atomic_json(summary_path, summary)
    check_pins()
    a = summary["agreement"]
    r = summary["rescored_experiment06"]
    print(f"Agreement: {a['agree']} agree, {a['disagree']} disagree, {a['uncertain']} uncertain",
          flush=True)
    print(f"Re-scored Experiment 06: C={r['correct_existing']}/E={r['existing']} "
          f"(AI reference: 23/71); W/E="
          f"{r['wrong_reuse'] if r['wrong_reuse'] is None else round(r['wrong_reuse'], 4)}",
          flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--resume", action="store_true")
    mode.add_argument("--verify", action="store_true")
    args = parser.parse_args()
    execute(args.resume, args.verify)
