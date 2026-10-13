"""Prove that interrupted work and changed settings cannot corrupt resume."""

import importlib
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def module():
    assert (Path(__file__).resolve().parents[1] / "checkpoint.py").is_file(), "Checkpoint implementation required"
    return importlib.import_module("checkpoint")


def test_matching_resume_skips_completed_and_keeps_errors(tmp_path):
    checkpoint = module().Checkpoint(tmp_path / "state.json", tmp_path, "a" * 64)
    checkpoint.record("p1/P1", {"status": "ok", "answer": False})
    checkpoint.record("p1/P2", {"status": "error", "code": "timeout"})
    resumed = module().Checkpoint(tmp_path / "state.json", tmp_path, "a" * 64, resume=True)
    assert not resumed.should_run("p1/P1")
    assert not resumed.should_run("p1/P2")
    assert resumed.should_run("p1/P2", retry_failed=True)
    assert resumed.should_run("p2/P1")
    assert not resumed.should_run("p1/P1", retry_failed=True)
    assert resumed.records["p1/P2"]["code"] == "timeout"


def test_resume_rejects_mismatch_and_overwrite(tmp_path):
    path = tmp_path / "state.json"
    checkpoint = module().Checkpoint(path, tmp_path, "a" * 64)
    checkpoint.record("p1/P1", {"status": "ok", "answer": True})
    with pytest.raises(ValueError, match="fingerprint"):
        module().Checkpoint(path, tmp_path, "b" * 64, resume=True)
    with pytest.raises(ValueError, match="resume"):
        module().Checkpoint(path, tmp_path, "a" * 64)
    with pytest.raises(ValueError, match="completed"):
        checkpoint.record("p1/P1", {"status": "ok", "answer": False})


def test_interrupted_replace_preserves_checkpoint(tmp_path, monkeypatch):
    path = tmp_path / "state.json"
    checkpoint = module().Checkpoint(path, tmp_path, "a" * 64)
    checkpoint.record("p1/P1", {"status": "ok", "answer": True})
    before = path.read_bytes()
    def interrupted(*args):
        raise OSError("synthetic interruption")
    monkeypatch.setattr(Path, "replace", interrupted)
    with pytest.raises(OSError):
        checkpoint.record("p2/P1", {"status": "error", "code": "timeout"})
    assert path.read_bytes() == before
    assert "p2/P1" not in checkpoint.records
    assert path.with_suffix(".json.tmp").exists()


def test_checkpoint_path_and_record_validation(tmp_path):
    with pytest.raises(ValueError, match="outside"):
        module().Checkpoint(tmp_path.parent / "escape.json", tmp_path, "a" * 64)
    checkpoint = module().Checkpoint(tmp_path / "state.json", tmp_path, "a" * 64)
    with pytest.raises(ValueError, match="status"):
        checkpoint.record("p1/P1", {"answer": True})
    with pytest.raises(ValueError, match="redaction"):
        checkpoint.record("p1/P1", {"status": "error", "code": "sk-" + "a" * 24})
