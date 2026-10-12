"""Experiment 18: validate the two AI labelling passes, prepare reconciliation, freeze the reference."""

import argparse
import hashlib
import json
import os
from pathlib import Path

HERE = Path(__file__).resolve().parent
CORPUS = HERE / "corpus"
OUT = HERE / "output"
SPECIAL = {"none_fit", "uncertain"}
NOTE_LIMIT = 200
G5_MIN_AGREEMENT = 0.75


def require(condition, code):
    if not condition:
        raise ValueError(code)


def file_hash(path):
    with open(path, "rb") as handle:
        return hashlib.file_digest(handle, "sha256").hexdigest()


def read_json(path):
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def atomic_json(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, indent=2, ensure_ascii=False, sort_keys=True) + "\n", encoding="utf-8")
    os.chmod(tmp, 0o600)
    os.replace(tmp, path)


def load_inputs():
    selection = read_json(OUT / "selection.json")
    require(file_hash(CORPUS / "label-input.json") == selection["label_input_sha256"], "label_input_drift")
    data = read_json(CORPUS / "label-input.json")
    sections = {l["id"]: l["section"] for l in data["catalogue"]}
    observations = {o["id"]: o for o in data["observations"]}
    require(len(observations) == 400, "observation_count")
    return observations, sections


def validate_pass(payload, observations, sections, name):
    """One valid answer per observation; returns {id: answer}."""
    require(payload.get("labeller") == name, "labeller_name")
    answers = {}
    for row in payload["answers"]:
        oid, label = row["id"], row["label"]
        require(oid in observations and oid not in answers, "answer_ids")
        section = observations[oid]["section"]
        require(label in SPECIAL or sections.get(label) == section, "answer_label")
        require(len(row.get("note", "")) <= NOTE_LIMIT, "note_length")
        require("new_label" not in row or label == "none_fit", "new_label_without_none_fit")
        answers[oid] = {"label": label, **({"new_label": row["new_label"]} if row.get("new_label") else {})}
    require(set(answers) == set(observations), "answer_coverage")
    return answers


def disagreements(first, second):
    return sorted(oid for oid in first if first[oid]["label"] != second[oid]["label"])


def finalise(first, second, responses):
    """Agreed answers stand; conceded answers take the judge's label; kept answers become disputed."""
    open_ids = disagreements(first, second)
    by_id = {row["id"]: row for row in responses}
    require(set(by_id) == set(open_ids) and len(by_id) == len(responses), "reconcile_coverage")
    final = {}
    for oid in first:
        if oid not in by_id:
            final[oid] = first[oid]["label"]
            continue
        row = by_id[oid]
        require(row["position"] in ("keep", "concede"), "reconcile_position")
        expected = first[oid]["label"] if row["position"] == "keep" else second[oid]["label"]
        require(row["final"] == expected, "reconcile_final")
        final[oid] = "disputed" if row["position"] == "keep" else row["final"]
    return final


def counts(final):
    result = {"label": 0, "none_fit": 0, "uncertain": 0, "disputed": 0}
    for label in final.values():
        result[label if label in result else "label"] += 1
    return result


def main(prepare):
    observations, sections = load_inputs()
    first = validate_pass(read_json(CORPUS / "label-pass1.json"), observations, sections, "pass1")
    second = validate_pass(read_json(CORPUS / "label-pass2.json"), observations, sections, "pass2")
    open_ids = disagreements(first, second)
    agreement = 1 - len(open_ids) / len(observations)
    if prepare:
        atomic_json(CORPUS / "reconcile-input.json", {
            "instruction": ("For each disagreement, re-read the observation and both answers. Keep your answer "
                            "or concede to the judge's answer. Reply with id, position (keep or concede) and "
                            "final (your answer if keep, the judge's if concede)."),
            "catalogue": read_json(CORPUS / "label-input.json")["catalogue"],
            "disagreements": [{"id": oid, "section": observations[oid]["section"],
                               "description": observations[oid]["description"],
                               "your_answer": first[oid]["label"], "judge_answer": second[oid]["label"]}
                              for oid in open_ids]})
        print(f"Agreement before reconciliation: {agreement:.4f}; {len(open_ids)} disagreements written", flush=True)
        return
    responses = read_json(CORPUS / "label-reconcile.json")["responses"] if open_ids else []
    final = finalise(first, second, responses)
    proposed = {oid: first[oid].get("new_label") or second[oid].get("new_label")
                for oid, label in final.items() if label == "none_fit"}
    atomic_json(CORPUS / "fresh-reference.json", {
        "mode": "AI-labelled: drafter and blind judge, drafter reconciliation; no human review",
        "decisions": {oid: {"label": label} for oid, label in sorted(final.items())},
        "proposed_new_labels": {k: v for k, v in sorted(proposed.items()) if v}})
    atomic_json(OUT / "reference-manifest.json", {
        "reference_sha256": file_hash(CORPUS / "fresh-reference.json"),
        "pass1_sha256": file_hash(CORPUS / "label-pass1.json"),
        "pass2_sha256": file_hash(CORPUS / "label-pass2.json"),
        "reconcile_sha256": file_hash(CORPUS / "label-reconcile.json") if open_ids else None,
        "label_input_sha256": file_hash(CORPUS / "label-input.json"),
        "agreement_before_reconcile": agreement, "disagreements": len(open_ids),
        "kept": sum(1 for r in responses if r["position"] == "keep"),
        "conceded": sum(1 for r in responses if r["position"] == "concede"),
        "G5_label_quality": agreement >= G5_MIN_AGREEMENT, "counts": counts(final)})
    print(f"Frozen reference: {counts(final)}; agreement {agreement:.4f}", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prepare", action="store_true", help="write reconcile-input.json for the drafter")
    main(parser.parse_args().prepare)
