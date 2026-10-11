"""Offline paired replay of explicitly verified category assignments."""

import argparse
import copy
import hashlib
import json
import subprocess
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
EXPERIMENTS = HERE.parent
SOURCE = EXPERIMENTS / "01-label-decisions-2026-10-07/output/revision-01-batch8192/corpus"
BASE = EXPERIMENTS / "05-retrieval-qwen-label-decisions-2026-10-10"
FIELDS = ("owner", "section", "project", "catalogue_revision", "description")
FAMILIES = ("approved", "unseen", "correction", "supersession", "owner", "section",
            "project", "catalogue_revision", "catalogue", "conflict", "near", "status")


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def file_hash(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read_json(path):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            require(key not in result, "duplicate_json_key")
            result[key] = value
        return result
    return json.loads(path.read_text(), object_pairs_hook=unique)


def atomic(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(json.dumps(value, indent=2, sort_keys=True, ensure_ascii=False) + "\n")
    temp.replace(path)


def key_of(value):
    require(all(isinstance(value.get(f), str) and value[f] for f in FIELDS), "missing_scope")
    return tuple(value[f] for f in FIELDS)


def apply_event(state, event):
    """Only explicit human assignment events enter verified history."""
    if event["type"] not in ("approval", "correction"):
        return
    key_of(event)
    require(all(row["id"] != event["id"] for row in state), "duplicate_event")
    if event.get("supersedes"):
        targets = [row for row in state if row["id"] == event["supersedes"]]
        require(event["type"] == "correction" and len(targets) == 1 and
                targets[0]["type"] == "correction" and key_of(targets[0]) == key_of(event),
                "invalid_supersession")
    state.append(copy.deepcopy(event))


def decide(query, state):
    """Resolve current eligible assignments without access to an evaluator key."""
    key = key_of(query)
    exact = [row for row in state if key_of(row) == key]
    allowed = set(query["catalogue"].get(query["section"], [])) & set(query["options"])
    eligible = [row for row in exact if row["label"] in allowed and row["label"] != "none_fit"]
    superseded = {row.get("supersedes") for row in eligible}
    current = [row for row in eligible if row["id"] not in superseded]
    corrections = [row for row in current if row["type"] == "correction"]
    choices = corrections or current
    labels = {row["label"] for row in choices}
    if len(labels) == 1:
        label = next(iter(labels))
        return {"source": "correction" if corrections else "assignment", "reason": "eligible",
                "outcome": {"status": "ok", "choice": label},
                "events": [row["id"] for row in choices]}
    reason = "ambiguous" if labels else "invalid_assignment" if exact else "no_exact_assignment"
    return {"source": "classifier", "reason": reason,
            "outcome": copy.deepcopy(query["baseline"]), "events": []}


def fixtures():
    """Declare input events and independent expected routing for 48 queries."""
    events, answers = [], {}
    for family in FAMILIES:
        for i in range(4):
            identifier = f"{family}-{i}"
            scope = dict(owner="owner", section="preferences", project="project",
                         catalogue_revision="v1", description="Café")
            approval = dict(scope, id=identifier + "-approval", type="approval", label="a")
            spare = dict(scope, id=identifier + "-spare", type="approval", label="a",
                         description="Unrelated")
            query = dict(scope, id=identifier, type="query", trace=identifier, family=family,
                         catalogue={"preferences": ["a", "b"], "patterns": ["p"]},
                         options=["a", "b", "none_fit"], baseline={"status": "ok", "choice": "b"})
            preceding = [approval, spare]
            source, choice = "classifier", "b"
            if family == "approved":
                if i == 0:
                    preceding = []  # Query before its approval must not see future state.
                else:
                    source, choice = "assignment", "a"
            elif family == "unseen":
                query["description"] = "Unseen"
                preceding.append(dict(scope, id=identifier + "-model", type="model", label="b"))
            elif family in ("correction", "supersession"):
                correction = dict(scope, id=identifier + "-correction", type="correction", label="b")
                preceding.append(correction)
                source = "correction"
                if family == "supersession":
                    preceding.append(dict(scope, id=identifier + "-next", type="correction",
                                          label="a", supersedes=correction["id"]))
                    choice = "a"
                preceding.append(dict(scope, id=identifier + "-model", type="model", label="b"))
            elif family in FIELDS:
                query[family] = "different"
            elif family == "catalogue":
                if i < 2:
                    query["catalogue"]["preferences"] = ["b"]
                else:
                    query["options"] = ["b", "none_fit"]
            elif family == "conflict":
                kind = "correction" if i < 2 else "approval"
                preceding.extend([dict(scope, id=identifier + "-x", type=kind, label="a"),
                                  dict(scope, id=identifier + "-y", type=kind, label="b")])
            elif family == "near":
                query["description"] = ["café", "Café ", "Café!", "Cafe\u0301"][i]
            elif family == "status":
                approval["label"] = ["none_fit", "invalid", "none_fit", "invalid"][i]
                query["baseline"] = [{"status": "ok", "choice": "none_fit"},
                                     {"status": "error", "code": "invalid"},
                                     {"status": "review", "code": "abstain"},
                                     {"status": "error", "code": "transport"}][i]
            events.extend([dict(row, trace=identifier) for row in preceding])
            events.append(query)
            if family == "approved" and i == 0:
                events.extend([dict(row, trace=identifier) for row in (approval, spare)])
            expected = {"status": "ok", "choice": choice} if source != "classifier" else query["baseline"]
            answers[identifier] = {"source": source, "outcome": copy.deepcopy(expected)}
    return events, answers


def replay(events):
    states, rows = {}, []
    ids = set()
    for event in events:
        require(event["id"] not in ids, "duplicate_event")
        ids.add(event["id"])
        state = states.setdefault(event["trace"], [])
        if event["type"] != "query":
            apply_event(state, event)
            continue
        result = decide(event, state)
        rows.append(dict(id=event["id"], family=event["family"],
                         seen=any(row["description"] == event["description"] for row in state),
                         baseline=event["baseline"], **result))
    return rows


def load_baseline():
    cases = [row for row in read_json(SOURCE / "ground-truth.json") if row["split"] == "test"]
    records = read_json(BASE / "output/eval_results.json")["records"]
    candidates = read_json(SOURCE / "candidates.json")
    require(len(cases) == 140 and len({c["id"] for c in cases}) == 140 and
            set(records) == {c["id"] for c in cases}, "baseline_ids")
    for identifier, row in records.items():
        require(row["case_id"] == identifier and row["status"] == "ok" and
                row["choice"] in candidates[identifier]["ids"], "baseline_outcome")
    return cases, records


def original_replay(cases, records):
    rows = []
    for case in cases:
        query = dict(owner="original", section=case["section"], project="original",
                     catalogue_revision="original", description=case["description"],
                     catalogue={}, options=[], baseline=records[case["id"]])
        result = decide(query, [])
        rows.append(dict(id=case["id"], baseline=records[case["id"]], **result))
    return rows


def summarise(synthetic, original, answers, cases):
    hits = [row for row in synthetic if row["source"] != "classifier"]
    corrections = sum(row["source"] == "correction" for row in hits)
    mismatch = sum({"source": row["source"], "outcome": row["outcome"]} != answers[row["id"]]
                   for row in synthetic)
    misses = [row for row in synthetic if row["source"] == "classifier"]
    unchanged = sum(row["outcome"] == row["baseline"] and row["source"] == "classifier" for row in original)
    by_id = {row["id"]: row for row in original}
    correct_existing = wrong_existing = correct_none = 0
    for case in cases:
        outcome = by_id[case["id"]]["outcome"]
        correct = outcome["status"] == "ok" and outcome.get("choice") in case["expected"]
        if outcome.get("choice") == "none_fit":
            correct_none += correct
        else:
            correct_existing += correct
            wrong_existing += not correct
    gates = {"complete": len(synthetic) == len(answers) == 48 and len(original) == 140,
             "nonempty": len(hits) >= 8 and corrections >= 8,
             "all_expected_routes": mismatch == 0,
             "miss_preservation": all(row["outcome"] == row["baseline"] for row in misses),
             "original_unchanged": unchanged == 140}
    return {"functional_result": "PASS" if all(gates.values()) else "FAIL",
            "validity": "INCONCLUSIVE", "gates": gates, "synthetic_queries": len(synthetic),
            "hits": len(hits), "assignment_hits": len(hits) - corrections, "correction_hits": corrections,
            "misses": len(misses), "outcome_mismatches": mismatch,
            "seen": sum(row["seen"] for row in synthetic),
            "unseen": sum(not row["seen"] for row in synthetic),
            "miss_reasons": dict(Counter(row["reason"] for row in misses)),
            "baseline_call_opportunities": len(synthetic) + len(original),
            "candidate_call_opportunities": len(misses) + len(original), "avoided_calls": len(hits),
            "fresh_model_calls": 0, "original_unchanged": unchanged,
            "original_accuracy": {"correct_existing": correct_existing, "wrong_existing": wrong_existing,
                                  "correct_none_fit": correct_none,
                                  "accuracy": (correct_existing + correct_none) / len(cases)},
            "original_paired": {"wins": 0, "losses": 0, "ties": unchanged}}


def preserved_files():
    return {str(p.relative_to(EXPERIMENTS)): file_hash(p)
            for prefix in ("01-", "02-", "03-", "04-", "05-")
            for directory in EXPERIMENTS.glob(prefix + "*") for p in directory.rglob("*")
            if p.is_file() and "__pycache__" not in p.parts}


def execute(resume=False, verify=False):
    output = HERE / "output"
    fixture_path, answer_path = HERE / "events.json", HERE / "expected.json"
    if not fixture_path.exists():
        require(not verify and not answer_path.exists(), "fixtures_missing")
        events, answers = fixtures()
        atomic(fixture_path, events)
        atomic(answer_path, answers)
    events, answers = read_json(fixture_path), read_json(answer_path)
    require(len([e for e in events if e["type"] == "query"]) == 48 and
            len([e for e in events if e["type"] != "query"]) >= 24, "fixture_counts")
    cases, records = load_baseline()
    report = (HERE / "report.md").read_text()
    plan = report.split("## Plan (written before the run)", 1)[1].split("## Results", 1)[0]
    pinned = [BASE / name for name in ("output/eval_results.json", "output/run-manifest.json",
                                     "output/summary.json", "run_eval.py")]
    pinned += [SOURCE / name for name in ("ground-truth.json", "catalogue.json", "candidates.json")]
    manifest = {"inputs": {str(p.relative_to(EXPERIMENTS)): file_hash(p) for p in pinned},
                "fixtures": [file_hash(fixture_path), file_hash(answer_path)],
                "runner_sha256": file_hash(Path(__file__)), "plan_sha256": hashlib.sha256(plan.encode()).hexdigest(),
                "preservation": preserved_files(),
                "commit": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=HERE, text=True).strip(),
                "approval": "User approved both runs; directed this session to Experiment 07"}
    manifest_path = output / "run-manifest.json"
    if manifest_path.exists():
        saved_manifest = read_json(manifest_path)
        require({k: v for k, v in saved_manifest.items() if k != "initial_report_sha256"} == manifest,
                "fingerprint_drift")
        require(verify or resume, "resume_required")
    else:
        require(not verify, "manifest_missing")
        manifest["initial_report_sha256"] = file_hash(HERE / "report.md")
        atomic(manifest_path, manifest)
        (output / "approved-report.md").write_text(report)
    saved_manifest = read_json(manifest_path)
    require(file_hash(output / "approved-report.md") == saved_manifest["initial_report_sha256"], "plan_snapshot_drift")
    cells = {"synthetic": replay(events), "original": original_replay(cases, records)}
    checkpoint_path = output / "eval_results.json"
    saved = read_json(checkpoint_path) if checkpoint_path.exists() else {}
    require(set(saved) <= set(cells), "unknown_cell")
    for name, rows in cells.items():
        if name in saved:
            require(saved[name] == rows, "checkpoint_drift")
        else:
            require(not verify, "incomplete_checkpoint")
            saved[name] = rows
            atomic(checkpoint_path, saved)
            print(f"Completed {name}: {len(rows)} queries", flush=True)
    summary = summarise(cells["synthetic"], cells["original"], answers, cases)
    require(summary["original_accuracy"] == {"correct_existing": 21, "wrong_existing": 44,
                                            "correct_none_fit": 57, "accuracy": 78 / 140}, "baseline_metric_drift")
    summary["state_events"] = sum(e["type"] != "query" for e in events)
    summary["preserved_files"] = len(manifest["preservation"])
    if verify:
        require(read_json(output / "summary.json") == summary, "summary_drift")
    else:
        atomic(output / "summary.json", summary)
    print(json.dumps(summary, indent=2), flush=True)
    return summary


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--verify", action="store_true")
    args = parser.parse_args()
    execute(args.resume, args.verify)
