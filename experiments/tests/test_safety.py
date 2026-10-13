"""Exercise snapshot and redaction guards with synthetic data only."""

import hashlib
import importlib
import sqlite3
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def safety():
    assert (Path(__file__).resolve().parents[1] / "safety.py").is_file(), "Safety helper required"
    return importlib.import_module("safety")


def test_snapshot_preserves_source(tmp_path):
    module = safety()
    source = tmp_path / "source.db"
    with sqlite3.connect(source) as db:
        db.execute("CREATE TABLE items (description TEXT)")
        db.execute("INSERT INTO items VALUES ('synthetic preference')")
    before = hashlib.sha256(source.read_bytes()).hexdigest()
    root = tmp_path / "experiments"
    root.mkdir()
    target = root / "corpus" / "snapshot.db"
    module.snapshot(source, target, root, approved=True)
    assert hashlib.sha256(source.read_bytes()).hexdigest() == before
    assert not Path(str(source) + "-wal").exists()
    assert not Path(str(source) + "-shm").exists()
    with sqlite3.connect(target) as db:
        assert db.execute("SELECT description FROM items").fetchone() == ("synthetic preference",)
    with pytest.raises(ValueError, match="exists"):
        module.snapshot(source, target, root, approved=True)


def test_snapshot_requires_approval(tmp_path):
    module = safety()
    with pytest.raises(ValueError, match="approval"):
        module.snapshot(tmp_path / "source.db", tmp_path / "copy.db", tmp_path, approved=False)
    assert not (tmp_path / "copy.db").exists()


def test_paths_reject_escape_live_and_symlinks(tmp_path):
    module = safety()
    root = tmp_path / "experiments"
    root.mkdir()
    with pytest.raises(ValueError, match="outside"):
        module.output_path(tmp_path / "escape.json", root)
    live = tmp_path / ".omms" / "data"
    live.mkdir(parents=True)
    with pytest.raises(ValueError, match="live"):
        module.output_path(live / "output.json", live)
    (root / "link").symlink_to(tmp_path, target_is_directory=True)
    with pytest.raises(ValueError, match="symlink"):
        module.output_path(root / "link" / "output.json", root)
    source = tmp_path / "source.db"
    source.touch()
    linked_source = tmp_path / "linked.db"
    linked_source.symlink_to(source)
    with pytest.raises(ValueError, match="symlink"):
        module.snapshot(linked_source, root / "copy.db", root, approved=True)


def test_redaction_removes_nested_and_unclosed_private_content():
    module = safety()
    assert module.redact("public <private>one <private>two</private> three</private> end") == "public [REDACTED] end"
    assert module.redact("public <PRIVATE >secret") == "public [REDACTED]"
    assert module.redact("public </private> end") == "public  end"


def test_redaction_removes_secrets_and_validation_fails_closed():
    module = safety()
    token = "sk-" + "a" * 24
    assert module.redact("token " + token) == "token [REDACTED]"
    assert module.redact("key=synthetic-secret", secrets=["synthetic-secret"]) == "key=[REDACTED]"
    with pytest.raises(ValueError, match="redaction"):
        module.require_redacted("<private>secret</private>")
    with pytest.raises(ValueError, match="redaction"):
        module.require_redacted(token)
    module.require_redacted("safe synthetic text")
