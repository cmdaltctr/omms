"""Validate revised annotations before vector generation or model calls."""

import json
from pathlib import Path

from safety import output_path, require_redacted

EXPERIMENT = Path(__file__).resolve().parent


def run_root(path):
    """Restrict command writes to a revision beneath this experiment's output."""
    path = output_path(Path(path).absolute(), EXPERIMENT)
    if not path.is_relative_to(EXPERIMENT / "output") or path == EXPERIMENT / "output":
        raise ValueError("revision root must be beneath experiment output; original corpus is read-only")
    return path


def read_reference(root):
    """Load annotation artefacts using guarded experiment-local paths."""
    names = {"catalogue": "catalogue.json", "reference": "ground-truth.json",
             "annotation_input": "annotation-input.json", "notes": "annotation-notes.json",
             "provenance": "ai-reference-provenance.json"}
    data = {name: json.loads(output_path(root / "corpus" / file, root).read_text()) for name, file in names.items()}
    pool = root / "corpus/entries.json"
    if pool.exists():
        data["entries"] = json.loads(output_path(pool, root).read_text())
    validate_reference(data)
    return data


def validate_reference(data):
    """Reject uncertain, leaked, altered or single-class reference corpora."""
    catalogue, cases = data["catalogue"], data["reference"]
    if data["notes"].get("uncertain_cases") != []:
        raise ValueError("unresolved annotation notes")
    if any(c.get("annotation_status") != "resolved" for c in cases):
        raise ValueError("unresolved reference case")
    if len(cases) != 200 or len({c["id"] for c in cases}) != 200:
        raise ValueError("200 unique cases required")
    development = [c for c in cases if c["split"] == "development"]
    if len(development) != 60 or sum(c["split"] == "test" for c in cases) != 140:
        raise ValueError("60/140 grouped split required")
    groups, intents = {}, {}
    for c in cases:
        if not c["group"] or groups.setdefault(c["group"], c["split"]) != c["split"]:
            raise ValueError("split leakage")
        intent = (c["section"], " ".join(c["description"].split()).casefold())
        if intents.setdefault(intent, c["split"]) != c["split"]:
            raise ValueError("intent leakage across split groups")
    provenance = data["provenance"]
    if provenance.get("human_reviewed") is not False:
        raise ValueError("AI provenance must retain human_reviewed false")
    if set(provenance["development_ids"]) != {c["id"] for c in development}:
        raise ValueError("development provenance differs")
    source = {c["id"]: c for c in data.get("entries", [])}
    source.update({c["id"]: c for c in data["annotation_input"]})
    labels = {c["id"]: c for c in catalogue}
    for c in cases:
        if c["id"] not in source or any(c[k] != source[c["id"]][k] for k in ("section", "category", "description")):
            raise ValueError("source fields changed")
        expected = c["expected"]
        if not isinstance(expected, list) or not expected or len(set(expected)) != len(expected):
            raise ValueError("expected labels required")
        if "none_fit" in expected and expected != ["none_fit"]:
            raise ValueError("none_fit cannot accompany an existing label")
        if any(i != "none_fit" and (i not in labels or labels[i]["section"] != c["section"]) for i in expected):
            raise ValueError("cross-section or unknown expected label")
    for label in catalogue:
        aliases = {c["category"] for c in development if c["section"] == label["section"]}
        if not set(label["aliases"]).issubset(aliases):
            raise ValueError("catalogue alias lacks development provenance")
    for section in ("preferences", "patterns"):
        test = [c for c in cases if c["section"] == section and c["split"] == "test"]
        positives = {i for c in test for i in c["expected"] if i != "none_fit"}
        if len(positives) < 2 or not any(c["expected"] == ["none_fit"] for c in test):
            raise ValueError("test needs positive labels and genuine none_fit in each section")
    require_redacted(json.dumps(data))


def verify_freeze(value, root):
    """Recompute the saved development freeze before permitting test calls."""
    from labels import freeze, validate
    from manifest import digest
    development = json.loads(output_path(root / "corpus/development-manifest.json", root).read_text())
    raw = json.loads(output_path(root / "output/development/eval_results.json", root).read_text())
    _, cases, _ = validate(development, root)
    if raw["manifest_sha256"] != digest(development) or freeze(development, cases, raw["records"]) != value:
        raise ValueError("saved development freeze differs")
