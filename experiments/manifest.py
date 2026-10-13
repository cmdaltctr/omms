"""Validate frozen experiment inputs before any provider call."""

import hashlib
import json
import math
import re
from datetime import datetime
from pathlib import Path

from safety import output_path, require_redacted


def digest(value) -> str:
    """Hash a value with deterministic JSON encoding."""
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()


def file_digest(path: Path) -> str:
    """Hash a file without interpreting its contents."""
    hasher = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            hasher.update(block)
    return hasher.hexdigest()


def spending_fingerprint(value: dict, root: Path, *, hosted_arms=()) -> str:
    """Keep one spending scope across tuning, without resetting its ledger."""
    validate(value, root, hosted_arms=hosted_arms)
    return digest({key: value[key] for key in (
        "source_commit", "files", "test_split_sha256", "models", "approvals"
    )})


def validate(value: dict, root: Path, *, hosted_arms=()) -> str:
    """Refuse incomplete, changed or unapproved inputs; return a fingerprint."""
    required = {"version", "source_commit", "reference_time", "split_seed", "files", "pairs", "models", "settings", "approvals", "test_split_sha256", "settings_sha256"}
    if not isinstance(value, dict) or not required.issubset(value):
        raise ValueError("missing manifest fields")
    if value["version"] != 1 or not isinstance(value["source_commit"], str) or not re.fullmatch(r"[0-9a-f]{40}", value["source_commit"]):
        raise ValueError("invalid source pin")
    try:
        reference = datetime.fromisoformat(value["reference_time"])
        if reference.tzinfo is None or type(value["split_seed"]) is not int:
            raise ValueError("invalid reference time or seed")
        require_redacted(json.dumps(value, allow_nan=False))
        _validate_files(value["files"], root)
        _validate_pairs(value["pairs"])
        _validate_models(value["models"])
    except (TypeError, KeyError, OSError) as error:
        raise ValueError("invalid manifest structure") from error
    if digest([pair for pair in value["pairs"] if pair["split"] == "test"]) != value["test_split_sha256"]:
        raise ValueError("test split hash changed")
    if digest(value["settings"]) != value["settings_sha256"]:
        raise ValueError("settings hash changed")
    approvals = value["approvals"]
    if not isinstance(approvals, dict) or any(approvals.get(key) is not True for key in ("review", "gates", "calls")):
        raise ValueError("inference approval required")
    for arm in hosted_arms:
        if not isinstance(approvals.get("transfer"), dict):
            raise ValueError("transfer scope approval required")
        if approvals.get("transfer", {}).get(arm) != value["files"]["corpus"]["sha256"]:
            raise ValueError("transfer scope approval required")
        limit = approvals.get("spend_usd")
        estimate = value.get("estimated_cost_usd")
        if any(type(n) not in (int, float) or not math.isfinite(n) for n in (limit, estimate)):
            raise ValueError("spending approval required")
        if limit <= 0 or estimate < 0 or estimate > limit:
            raise ValueError("spending limit exceeded")
        if value["models"].get(arm, {}).get("status") != "ready":
            raise ValueError("hosted model unavailable")
    return digest(value)


def _validate_files(files, root):
    if not isinstance(files, dict) or not {"source", "corpus", "ground_truth"}.issubset(files):
        raise ValueError("file pins required")
    for record in files.values():
        path = output_path(root / record["path"], root)
        if file_digest(path) != record["sha256"]:
            raise ValueError("file hash changed")


def _validate_pairs(pairs):
    if not isinstance(pairs, list) or not pairs:
        raise ValueError("pair split required")
    seen = set()
    assignments = {}
    for pair in pairs:
        if pair["split"] not in ("development", "test") or pair["id"] in seen:
            raise ValueError("invalid pair split or duplicate ID")
        if len(pair["entries"]) != 2 or len(set(pair["entries"])) != 2:
            raise ValueError("two distinct entry IDs required")
        seen.add(pair["id"])
        for key in [("entry", entry) for entry in pair["entries"]] + [("group", pair["group"])]:
            if key in assignments and assignments[key] != pair["split"]:
                raise ValueError("split leakage")
            assignments[key] = pair["split"]
    if {pair["split"] for pair in pairs} != {"development", "test"}:
        raise ValueError("both splits required")


def _validate_models(models):
    if not isinstance(models, dict) or not models:
        raise ValueError("model pins required")
    for model in models.values():
        if not isinstance(model, dict) or not isinstance(model.get("parameters", {}), dict):
            raise ValueError("invalid model pin")
        if model.get("status") == "blocked" and model.get("reason"):
            continue
        if model.get("status") != "ready" or any(not model.get(key) for key in ("provider", "model")) or "parameters" not in model:
            raise ValueError("complete model pin required")


def authorised_call(value, root, arm, call):
    """Invoke an external call only after all hosted prerequisites pass."""
    validate(value, root, hosted_arms=[arm])
    return call()
