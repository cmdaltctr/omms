"""Small offline replay of provisional drafts, preserving earlier experiments."""

import argparse
import hashlib
import json
import subprocess
import types
from pathlib import Path

HERE = Path(__file__).resolve().parent
EXPERIMENTS = HERE.parent
ENGINE_PATH = EXPERIMENTS / "07-retrieval-scoped-assignment-reuse-2026-10-10/run_eval.py"
engine = types.ModuleType("experiment07")
engine.__file__ = str(ENGINE_PATH)
exec(compile(ENGINE_PATH.read_text(), str(ENGINE_PATH), "exec"), engine.__dict__)
SOURCE = EXPERIMENTS / "01-label-decisions-2026-10-07/output/revision-01-batch8192/corpus"
BASE = EXPERIMENTS / "05-retrieval-qwen-label-decisions-2026-10-10/output"
PHASES = ("initial", "repeat", "unseen")


def load_inputs():
    drafts = engine.read_json(HERE / "drafts.json")
    engine.require(drafts["provenance"] == "AI_draft" and drafts["human_reviewed"] is False and
                   drafts["individual_labels_human_approved"] is False, "draft_provenance")
    cases = sorted([row for row in engine.read_json(SOURCE / "ground-truth.json")
                    if row["split"] == "test"], key=lambda row: row["id"])
    engine.require(len(cases) == 140 and len({c["id"] for c in cases}) == 140, "case_ids")
    cases = cases[:20]
    records = engine.read_json(BASE / "eval_results.json")["records"]
    candidates = engine.read_json(SOURCE / "candidates.json")
    catalogue = engine.read_json(SOURCE / "catalogue.json")
    engine.require(set(drafts["assignments"]) == {row["id"] for row in cases[:10]}, "draft_ids")
    labels = {}
    for item in catalogue:
        labels.setdefault(item["section"], []).append(item["id"])
    for case in cases:
        row = records.get(case["id"], {})
        engine.require(row.get("case_id") == case["id"] and row.get("status") in ("ok", "error", "review"),
                       "baseline_missing")
        if row["status"] == "ok":
            engine.require(row["choice"] in candidates[case["id"]]["ids"], "baseline_invalid")
    for case in cases[:10]:
        label = drafts["assignments"][case["id"]]["label"]
        engine.require(label == "none_fit" or (label in labels[case["section"]] and
                       label in candidates[case["id"]]["ids"]), "draft_membership")
    return cases, records, candidates, labels, drafts


def query_for(case, records, candidates, catalogue):
    return {"owner": "delegated-experimental-fixture", "section": case["section"],
            "project": "omms-follow-up-only", "catalogue_revision": engine.digest(catalogue),
            "description": case["description"], "baseline": records[case["id"]],
            "options": candidates[case["id"]]["ids"], "catalogue": catalogue}


def replay(inputs):
    cases, records, candidates, catalogue, drafts = inputs
    state, cells = [], {}
    for phase in PHASES:
        selected = cases[10:20] if phase == "unseen" else cases[:10]
        rows = []
        for case in selected:
            query = query_for(case, records, candidates, catalogue)
            result = engine.decide(query, state)
            rows.append({"id": f"{phase}:{case['id']}", "case_id": case["id"], "phase": phase,
                         "baseline": records[case["id"]], **result,
                         "draft_provenance": "AI_draft" if result["events"] else None,
                         "human_reviewed": False, "eligible_draft": case["id"] in drafts["assignments"] and
                         drafts["assignments"][case["id"]]["label"] != "none_fit"})
        cells[phase] = rows
        if phase == "initial":
            for case in cases[:10]:
                label = drafts["assignments"][case["id"]]["label"]
                if label == "none_fit":
                    continue
                scope = query_for(case, records, candidates, catalogue)
                event = {field: scope[field] for field in engine.FIELDS}
                # Approval is a replay event type, not a claim of human adjudication.
                engine.apply_event(state, dict(event, type="approval", label=label,
                                              id=f"draft:{case['id']}", provenance="AI_draft",
                                              human_reviewed=False, experimental_fixture=True))
    return cells


def summarise(cells, drafts):
    rows = [row for phase in PHASES for row in cells[phase]]
    hits = [row for row in rows if row["source"] != "classifier"]
    misses = [row for row in rows if row["source"] == "classifier"]
    repeat_ok = all((row["source"] == "assignment" and row["outcome"] ==
                     {"status": "ok", "choice": drafts["assignments"][row["case_id"]]["label"]})
                    if row["eligible_draft"] else
                    (row["source"] == "classifier" and row["outcome"] == row["baseline"])
                    for row in cells["repeat"])
    gates = {"complete": all(len(cells[p]) == 10 for p in PHASES) and
             len({row["id"] for row in rows}) == 30,
             "initial_unchanged": all(row["source"] == "classifier" and row["outcome"] == row["baseline"]
                                      for row in cells["initial"]),
             "repeat_choices": repeat_ok and len(hits) == 3,
             "unseen_unchanged": all(row["source"] == "classifier" and row["outcome"] == row["baseline"]
                                     for row in cells["unseen"]),
             "miss_preservation": all(row["outcome"] == row["baseline"] for row in misses),
             "provisional_provenance": all(row["draft_provenance"] == "AI_draft" and
                                           row["human_reviewed"] is False and row["events"] for row in hits)}
    return {"functional_result": "PASS" if all(gates.values()) else "FAIL", "validity": "INCONCLUSIVE",
            "gates": gates, "queries": len(rows), "draft_hits": len(hits), "misses": len(misses),
            "baseline_call_opportunities": len(rows), "candidate_call_opportunities": len(misses),
            "avoided_call_opportunities": len(hits), "fresh_model_calls": 0, "human_reviewed": False,
            "uncached_none_fit_drafts": sum(a["label"] == "none_fit" for a in drafts["assignments"].values()),
            "baseline_errors": sum(row["baseline"]["status"] == "error" for row in rows),
            "phases": {p: {"queries": len(cells[p]),
                           "hits": sum(row["source"] != "classifier" for row in cells[p]),
                           "outcomes_identical_to_baseline": sum(row["outcome"] == row["baseline"] for row in cells[p])}
                       for p in PHASES}}


def preservation():
    return {str(p.relative_to(EXPERIMENTS)): engine.file_hash(p)
            for number in range(1, 8) for directory in EXPERIMENTS.glob(f"{number:02}-*")
            for p in directory.rglob("*") if p.is_file() and "__pycache__" not in p.parts}


def execute(resume=False, verify=False):
    inputs = load_inputs()
    report = (HERE / "report.md").read_text()
    plan = report.split("## Plan (written before the run)", 1)[1].split("## Results", 1)[0]
    paths = [SOURCE / name for name in ("ground-truth.json", "catalogue.json", "candidates.json")]
    paths += [BASE / name for name in ("eval_results.json", "run-manifest.json", "summary.json")]
    paths += [ENGINE_PATH, HERE / "drafts.json", Path(__file__)]
    manifest = {"inputs": {str(p.relative_to(EXPERIMENTS)): engine.file_hash(p) for p in paths},
                "plan_sha256": hashlib.sha256(plan.encode()).hexdigest(), "preservation": preservation(),
                "commit": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=HERE, text=True).strip(),
                "human_reviewed": False, "execution_authorised": True}
    output = HERE / "output"
    manifest_path = output / "run-manifest.json"
    if manifest_path.exists():
        engine.require(engine.read_json(manifest_path) == manifest, "fingerprint_drift")
        engine.require(verify or resume, "resume_required")
    else:
        engine.require(not verify, "manifest_missing")
        engine.atomic(manifest_path, manifest)
        (output / "approved-plan.md").write_text(plan)
    engine.require((output / "approved-plan.md").read_text() == plan, "plan_snapshot_drift")
    cells = replay(inputs)
    checkpoint = output / "eval_results.json"
    saved = engine.read_json(checkpoint) if checkpoint.exists() else {}
    engine.require(set(saved) <= set(PHASES), "unknown_cell")
    for phase in PHASES:
        if phase in saved:
            engine.require(saved[phase] == cells[phase], "checkpoint_drift")
        else:
            engine.require(not verify, "incomplete_checkpoint")
            saved[phase] = cells[phase]
            engine.atomic(checkpoint, saved)
            print(f"Completed {phase}: {len(cells[phase])} queries", flush=True)
    summary = summarise(cells, inputs[-1])
    summary["preserved_files"] = len(manifest["preservation"])
    if verify:
        engine.require(engine.read_json(output / "summary.json") == summary, "summary_drift")
    else:
        engine.atomic(output / "summary.json", summary)
    print(json.dumps(summary, indent=2), flush=True)
    return summary


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--verify", action="store_true")
    args = parser.parse_args()
    execute(args.resume, args.verify)
