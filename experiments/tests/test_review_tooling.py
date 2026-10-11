"""Check the blind review page builder and export validator with synthetic pairs."""

import importlib.util
import json
import re
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from manifest import digest

PAIR_DATA = re.compile(r'<script type="application/json" id="pair-data">(.*?)</script>', re.DOTALL)
CORPUS_HASH = re.compile(r'<meta name="corpus-hash" content="([0-9a-f]+)">')


def script(name):
    path = Path(__file__).resolve().parents[1] / "03-pair-decisions-2026-10-10" / name
    assert path.exists(), "Review tooling required"
    spec = importlib.util.spec_from_file_location(name.replace("-", "_"), path)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


def synthetic_records():
    return [
        {"id": "duplicate-1", "decision": "duplicate", "A": "Prefer the terminal for Git work.",
         "B": "Use the command line for Git.", "outcome": "", "reason": ""},
        {"id": "conflict-1", "decision": "conflict", "A": "Commit straight to the shared branch.",
         "B": "Never commit straight to the shared branch.", "outcome": "", "reason": ""},
    ]


def reviewed_records(records=None):
    labels = {"duplicate-1": ("different", "One description names Git; the other does not."),
              "conflict-1": ("contradict", "One bars what the other requires.")}
    result = []
    for record in records or synthetic_records():
        item = dict(record)
        item["outcome"], item["reason"] = labels[item["id"]]
        result.append(item)
    return result


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2))
    return path


def build(tmp_path, records):
    review = write_json(tmp_path / "blind-review.json", records)
    page = tmp_path / "review.html"
    script("build_review_page.py").build_page(review, page, tmp_path)
    return page.read_text()


def validate(tmp_path, records, corpus=None):
    review = write_json(tmp_path / "blind-review.json", corpus or synthetic_records())
    export = write_json(tmp_path / "review-export.json", records)
    return script("validate_review.py").validate_export(review, export, tmp_path)


def test_page_is_self_contained_and_blind(tmp_path):
    page = build(tmp_path, synthetic_records())
    assert page.startswith("<!DOCTYPE html>")
    # No network reference of any kind, and only the two inline scripts.
    assert "http://" not in page and "https://" not in page
    assert "<link" not in page
    assert page.count("<script") == 2
    # No leaked signal wording anywhere in the template.
    for word in ("cosine", "similarity", "probability", "model_answer"):
        assert word not in page.lower()
    assert "runs locally" in page


def test_page_embeds_pairs_and_corpus_hash(tmp_path):
    records = synthetic_records()
    page = build(tmp_path, records)
    embedded = json.loads(PAIR_DATA.search(page).group(1))
    assert embedded == records
    assert CORPUS_HASH.search(page).group(1) == digest(records)


def test_progress_key_is_per_corpus_and_never_deleted(tmp_path):
    # Both review pages share one browser origin; a fixed key let one page wipe the other's labels.
    page = build(tmp_path, synthetic_records())
    assert 'var KEY = "omms-blind-review-progress:" + HASH;' in page
    assert "removeItem" not in page


def test_page_escapes_markup_in_pair_text(tmp_path):
    records = [{"id": "hostile-1", "decision": "duplicate",
                "A": '</script><script>alert("x")</script> <!--',
                "B": "<img src=x onerror=alert(1)>", "outcome": "", "reason": ""}]
    page = build(tmp_path, records)
    raw = PAIR_DATA.search(page).group(1)
    # Every angle bracket leaves as a JSON escape, so the text cannot inject markup.
    assert "<" not in raw
    assert json.loads(raw) == records


def test_builder_rejects_malformed_records(tmp_path):
    builder = script("build_review_page.py")
    broken = {
        "not-a-list": ({"id": "x"}, "non-empty JSON array"),
        "unknown-decision": ([{"id": "x", "decision": "merge", "A": "a", "B": "b", "outcome": "", "reason": ""}], "unknown decision"),
        "missing-key": ([{"id": "x", "decision": "duplicate", "A": "a", "outcome": "", "reason": ""}], "missing record keys"),
        "empty-id": ([{"id": "", "decision": "duplicate", "A": "a", "B": "b", "outcome": "", "reason": ""}], "non-empty record id"),
        "empty-list": ([], "non-empty JSON array"),
    }
    for name, (records, message) in broken.items():
        review = write_json(tmp_path / f"{name}.json", records)
        with pytest.raises(ValueError, match=message):
            builder.build_page(review, tmp_path / f"{name}.html", tmp_path)


def test_builder_rejects_private_corpus_text(tmp_path):
    records = [{"id": "x", "decision": "duplicate", "A": "keep <private>hidden</private> quiet",
                "B": "b", "outcome": "", "reason": ""}]
    review = write_json(tmp_path / "blind-review.json", records)
    with pytest.raises(ValueError, match="redaction required"):
        script("build_review_page.py").build_page(review, tmp_path / "review.html", tmp_path)


def test_validator_accepts_complete_review(tmp_path):
    summary = validate(tmp_path, reviewed_records())
    assert summary == {"valid": True, "reviewed": 2,
                       "outcomes": {"same": 0, "different": 1, "uncertain": 0,
                                    "contradict": 1, "compatible": 0}}


def test_validator_rejects_non_array_export(tmp_path):
    with pytest.raises(ValueError, match="must be a JSON array"):
        validate(tmp_path, {"duplicate-1": "different"})


def test_validator_rejects_missing_id(tmp_path):
    records = reviewed_records()[1:]
    with pytest.raises(ValueError, match="id set differs"):
        validate(tmp_path, records)


def test_validator_rejects_extra_id(tmp_path):
    records = reviewed_records() + [dict(reviewed_records()[0], id="other-1")]
    with pytest.raises(ValueError, match="id set differs"):
        validate(tmp_path, records)


def test_validator_rejects_duplicated_id(tmp_path):
    records = reviewed_records() + [dict(reviewed_records()[0])]
    with pytest.raises(ValueError, match="duplicate review id"):
        validate(tmp_path, records)


def test_validator_rejects_changed_pair_text(tmp_path):
    records = reviewed_records()
    records[0]["B"] = "A rewritten description."
    with pytest.raises(ValueError, match="pair text changed"):
        validate(tmp_path, records)


def test_validator_rejects_changed_decision(tmp_path):
    records = reviewed_records()
    records[0]["decision"] = "conflict"
    with pytest.raises(ValueError, match="pair text changed"):
        validate(tmp_path, records)


def test_validator_rejects_extra_key(tmp_path):
    records = reviewed_records()
    records[0]["cosine"] = 0.99
    with pytest.raises(ValueError, match="unexpected review key"):
        validate(tmp_path, records)


def test_validator_rejects_wrong_outcome_for_decision(tmp_path):
    records = reviewed_records()
    records[1]["outcome"] = "same"
    with pytest.raises(ValueError, match="outcome not allowed"):
        validate(tmp_path, records)


def test_validator_rejects_incomplete_outcome(tmp_path):
    records = reviewed_records()
    records[0]["outcome"] = ""
    records[0]["reason"] = ""
    with pytest.raises(ValueError, match="outcome missing"):
        validate(tmp_path, records)


def test_validator_rejects_empty_reason(tmp_path):
    records = reviewed_records()
    records[0]["reason"] = "   "
    with pytest.raises(ValueError, match="reason required"):
        validate(tmp_path, records)


def test_validator_rejects_reason_without_outcome(tmp_path):
    records = reviewed_records()
    records[0]["outcome"] = ""
    with pytest.raises(ValueError, match="reason without outcome"):
        validate(tmp_path, records)


def test_validator_rejects_private_content(tmp_path):
    records = reviewed_records()
    records[0]["reason"] = "found <private>sk-ant-1234567890abcdef</private> inside"
    with pytest.raises(ValueError, match="private content"):
        validate(tmp_path, records)
