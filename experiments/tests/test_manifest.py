"""Check inference prerequisites using synthetic manifests."""

import copy
import hashlib
import importlib
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def module():
    assert (Path(__file__).resolve().parents[1] / "manifest.py").is_file(), "Manifest guard required"
    return importlib.import_module("manifest")


@pytest.fixture
def manifest(tmp_path):
    files = {}
    for name in ("source", "corpus", "ground_truth"):
        path = tmp_path / (name + ".json")
        path.write_text("[]")
        files[name] = {"path": path.name, "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}
    value = {
        "version": 1, "source_commit": "a" * 40,
        "reference_time": "2026-10-10T00:00:00+00:00", "split_seed": 42,
        "files": files,
        "pairs": [
            {"id": "d1", "entries": ["a", "b"], "group": "g1", "split": "development"},
            {"id": "t1", "entries": ["c", "d"], "group": "g2", "split": "test"},
        ],
        "models": {"P1": {"status": "ready", "provider": "synthetic", "model": "fake-1", "parameters": {"temperature": 0}}},
        "settings": {"question": "synthetic question", "threshold": 0.5},
        "approvals": {"review": True, "gates": True, "calls": True,
                      "transfer": {"P1": files["corpus"]["sha256"]}, "spend_usd": 0.01},
        "estimated_cost_usd": 0.001,
    }
    value["test_split_sha256"] = module().digest([value["pairs"][1]])
    value["settings_sha256"] = module().digest(value["settings"])
    return value, tmp_path


def test_valid_manifest_and_fingerprint(manifest):
    value, root = manifest
    fingerprint = module().validate(value, root, hosted_arms=["P1"])
    assert len(fingerprint) == 64
    changed = copy.deepcopy(value)
    changed["models"]["P1"]["parameters"]["temperature"] = 0.1
    assert module().validate(changed, root, hosted_arms=["P1"]) != fingerprint


@pytest.mark.parametrize("field", ["source_commit", "reference_time", "split_seed", "files", "pairs", "models", "settings", "approvals", "test_split_sha256", "settings_sha256"])
def test_missing_fields_refused(manifest, field):
    value, root = manifest
    del value[field]
    with pytest.raises(ValueError):
        module().validate(value, root, hosted_arms=["P1"])


def test_shared_entry_and_group_leakage_refused(manifest):
    value, root = manifest
    value["pairs"][1]["entries"][0] = "a"
    with pytest.raises(ValueError, match="leakage"):
        module().validate(value, root)
    value["pairs"][1]["entries"][0] = "c"
    value["pairs"][1]["group"] = "g1"
    with pytest.raises(ValueError, match="leakage"):
        module().validate(value, root)


def test_changed_file_and_frozen_hash_refused(manifest):
    value, root = manifest
    (root / value["files"]["corpus"]["path"]).write_text('["changed"]')
    with pytest.raises(ValueError, match="hash"):
        module().validate(value, root)
    (root / value["files"]["corpus"]["path"]).write_text("[]")
    value["settings"]["threshold"] = 0.6
    with pytest.raises(ValueError, match="settings hash"):
        module().validate(value, root)


@pytest.mark.parametrize("approval", ["review", "gates", "calls", "transfer", "spend_usd"])
def test_missing_approval_blocks_calls(manifest, approval):
    value, root = manifest
    del value["approvals"][approval]
    calls = []
    with pytest.raises(ValueError):
        module().authorised_call(value, root, "P1", lambda: calls.append("called"))
    assert calls == []


def test_model_pin_cost_and_transfer_scope_refused(manifest):
    value, root = manifest
    value["models"]["P1"]["model"] = ""
    with pytest.raises(ValueError, match="model"):
        module().validate(value, root)
    value["models"]["P1"]["model"] = "fake-1"
    value["estimated_cost_usd"] = 1
    with pytest.raises(ValueError, match="spending"):
        module().validate(value, root, hosted_arms=["P1"])
    value["estimated_cost_usd"] = 0.001
    value["approvals"]["transfer"]["P1"] = "b" * 64
    with pytest.raises(ValueError, match="transfer"):
        module().validate(value, root, hosted_arms=["P1"])


@pytest.mark.parametrize("field,bad", [
    ("source_commit", None), ("reference_time", 42),
    ("models", {"P1": []}), ("pairs", [None]),
    ("approvals", {"review": True, "gates": True, "calls": True, "transfer": []}),
])
def test_malformed_manifest_fails_closed(manifest, field, bad):
    value, root = manifest
    value[field] = bad
    calls = []
    with pytest.raises(ValueError):
        module().authorised_call(value, root, "P1", lambda: calls.append(1))
    assert calls == []


def test_spending_scope_changes_with_corpus_or_model(manifest):
    value, root = manifest
    first = module().spending_fingerprint(value, root, hosted_arms=["P1"])
    value["models"]["P1"]["model"] = "fake-2"
    assert module().spending_fingerprint(value, root, hosted_arms=["P1"]) != first


def test_changed_test_split_is_refused_before_call(manifest):
    value, root = manifest
    value["pairs"][1]["id"] = "changed-test-pair"
    calls = []
    with pytest.raises(ValueError, match="test split hash"):
        module().authorised_call(value, root, "P1", lambda: calls.append(1))
    assert calls == []
