"""Experiment 20: select 200 new observations, prepare reconciliation, freeze the version 2 reference."""

import argparse
import hashlib
import importlib.util
import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
EXPERIMENTS = HERE.parent
CORPUS = HERE / "corpus"
OUT = HERE / "output"
E18 = EXPERIMENTS / "18-retrieval-fresh-confirmation-all-methods-2026-10-12"
E19 = EXPERIMENTS / "19-review-catalogue-v2-candidates-2026-10-12"
PINS = {
    E18 / "select_cases.py": "57e372bdabb0e49b4a94a759a890f70c96747410301cbe1e80a30b1375ef285d",
    E18 / "finalise_reference.py": "eb94121f0277a7dfe87ac95bff1118496dbd24c1bbddf5412fd6b41d432707d8",
    E18 / "corpus/fresh-cases.json": "7d89a84610b5cd9b6ccc24b149c81a2a4e7cc6d9bc8c1b6b6b8d03def391e940",
    E19 / "output/catalogue-v2.json": "7f393d3c4e989d1dbc40e14200db4119295e913faa38f31b99a539a9920dc45b",
}
SEED = 20261013
PER_SECTION = {"preferences": 100, "patterns": 100}
INSTRUCTION = ("Pick the one label whose definition matches the observation's primary intent. "
               "Respect each definition's exclusions. Answer none_fit when no label's intent matches. "
               "Answer uncertain only when two labels fit equally.")


def file_hash(path):
    with open(path, "rb") as handle:
        return hashlib.file_digest(handle, "sha256").hexdigest()


def check_pins():
    for path, expected in PINS.items():
        if file_hash(path) != expected:
            raise ValueError("input_hash_drift")


def load_module(path, name):
    check_pins()
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    previous = sys.dont_write_bytecode
    sys.dont_write_bytecode = True
    try:
        spec.loader.exec_module(module)
    finally:
        sys.dont_write_bytecode = previous
    return module


sel = load_module(E18 / "select_cases.py", "experiment20_select")
fin = load_module(E18 / "finalise_reference.py", "experiment20_finalise")


def read(path):
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def write_private(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, indent=2, ensure_ascii=False, sort_keys=True) + "\n", encoding="utf-8")
    os.chmod(tmp, 0o600)
    os.replace(tmp, path)


def select_phase():
    entries = sel.load_pinned(sel.ENTRIES, sel.ENTRIES_SHA256)
    truth = sel.load_pinned(sel.GROUND_TRUTH, sel.GROUND_TRUTH_SHA256)
    previous = read(E18 / "corpus/fresh-cases.json")["cases"]
    used_ids = {r["id"] for r in truth} | {c["id"] for c in previous}
    used_texts = [r["description"] for r in truth] + [c["description"] for c in previous]
    sel.SEED = SEED
    sel.PER_SECTION.clear()
    sel.PER_SECTION.update(PER_SECTION)
    chosen, counts = sel.select(entries, used_ids, used_texts)
    for item in chosen:
        if sel.exclusion_reason(item["description"]) is not None or item["id"] in used_ids:
            raise ValueError("privacy_or_overlap_gate")
    catalogue = read(E19 / "output/catalogue-v2.json")["labels"]
    write_private(CORPUS / "new-cases.json", {"seed": SEED, "cases": chosen})
    write_private(CORPUS / "label-input.json", {
        "instruction": INSTRUCTION,
        "answer_format": {"id": "observation id", "label": "label id, none_fit or uncertain",
                          "new_label": "optional short name when none_fit", "note": "at most 200 characters"},
        "catalogue": catalogue, "observations": chosen})
    write_private(OUT / "selection.json", {
        "pool": len([e for e in entries if e["id"] not in used_ids]), "selected": len(chosen),
        "per_section": {s: sum(1 for c in chosen if c["section"] == s) for s in PER_SECTION},
        "excluded_while_scanning": counts, "label_input_sha256": file_hash(CORPUS / "label-input.json"),
        "new_cases_sha256": file_hash(CORPUS / "new-cases.json")})
    print(f"Selected {len(chosen)}; excluded while scanning: {counts}", flush=True)


def load_label_inputs():
    selection = read(OUT / "selection.json")
    if file_hash(CORPUS / "label-input.json") != selection["label_input_sha256"]:
        raise ValueError("label_input_drift")
    data = read(CORPUS / "label-input.json")
    return {o["id"]: o for o in data["observations"]}, {l["id"]: l["section"] for l in data["catalogue"]}, data


def reconcile_phase():
    observations, sections, data = load_label_inputs()
    first = fin.validate_pass(read(CORPUS / "label-pass1.json"), observations, sections, "pass1")
    second = fin.validate_pass(read(CORPUS / "label-pass2.json"), observations, sections, "pass2")
    open_ids = fin.disagreements(first, second)
    write_private(CORPUS / "reconcile-input.json", {
        "instruction": ("For each disagreement, re-read the observation and both answers. Keep your answer or "
                        "concede to the judge's answer. Reply with id, position (keep or concede) and final."),
        "catalogue": data["catalogue"],
        "disagreements": [{"id": k, "section": observations[k]["section"], "description": observations[k]["description"],
                           "your_answer": first[k]["label"], "judge_answer": second[k]["label"]} for k in open_ids]})
    print(f"Agreement before reconciliation: {1 - len(open_ids) / len(observations):.4f}; "
          f"{len(open_ids)} disagreements", flush=True)


def freeze_phase():
    observations, sections, _ = load_label_inputs()
    first = fin.validate_pass(read(CORPUS / "label-pass1.json"), observations, sections, "pass1")
    second = fin.validate_pass(read(CORPUS / "label-pass2.json"), observations, sections, "pass2")
    open_ids = fin.disagreements(first, second)
    responses = read(CORPUS / "label-reconcile.json")["responses"] if open_ids else []
    final = fin.finalise(first, second, responses)
    agreement = 1 - len(open_ids) / len(observations)
    write_private(CORPUS / "reference.json", {"mode": "AI-labelled against catalogue version 2: drafter, blind judge, reconciliation",
                                              "decisions": {k: {"label": v} for k, v in sorted(final.items())}})
    write_private(OUT / "reference-manifest.json", {
        "reference_sha256": file_hash(CORPUS / "reference.json"), "agreement_before_reconcile": agreement,
        "disagreements": len(open_ids), "kept": sum(r["position"] == "keep" for r in responses),
        "conceded": sum(r["position"] == "concede" for r in responses),
        "G5_label_quality": agreement >= fin.G5_MIN_AGREEMENT, "counts": fin.counts(final)})
    print(f"Frozen reference: {fin.counts(final)}; agreement {agreement:.4f}", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--phase", choices=("select", "reconcile", "freeze"), required=True)
    phase = parser.parse_args().phase
    {"select": select_phase, "reconcile": reconcile_phase, "freeze": freeze_phase}[phase]()
