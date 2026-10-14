"""Verify WAL backups against synthetic files, without opening live stores."""

import hashlib
import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from safety import snapshot


def file_state(folder):
    """Exclude access times, which an ordinary read can update."""
    result = {}
    for path in folder.iterdir():
        stat = path.stat()
        result[path.name] = (
            hashlib.sha256(path.read_bytes()).hexdigest(),
            stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns,
            stat.st_mode, stat.st_ino,
        )
    return result


@pytest.fixture
def wal_source(tmp_path):
    folder = tmp_path / "source"
    folder.mkdir()
    source = folder / "profile.db"
    db = sqlite3.connect(source)
    assert db.execute("PRAGMA journal_mode=WAL").fetchone() == ("wal",)
    db.execute("PRAGMA wal_autocheckpoint=0")
    db.execute("CREATE TABLE items (id INTEGER PRIMARY KEY, description TEXT)")
    db.commit()
    db.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    db.execute("INSERT INTO items VALUES (1, 'committed in WAL only')")
    db.commit()
    assert Path(str(source) + "-wal").stat().st_size > 32
    try:
        yield source, db
    finally:
        db.close()


def read_copy(target):
    with sqlite3.connect(target) as db:
        assert db.execute("PRAGMA integrity_check").fetchone() == ("ok",)
        return db.execute("SELECT id, description FROM items ORDER BY id").fetchall()


def test_backup_includes_wal_and_preserves_all_source_files(wal_source, tmp_path):
    source, _ = wal_source
    before = file_state(source.parent)
    root = tmp_path / "experiments"
    target = root / "corpus" / "snapshot.db"
    snapshot(source, target, root, approved=True)
    assert read_copy(target) == [(1, "committed in WAL only")]
    assert file_state(source.parent) == before


def test_backup_excludes_uncommitted_transaction(wal_source, tmp_path):
    source, writer = wal_source
    writer.execute("INSERT INTO items VALUES (2, 'uncommitted synthetic item')")
    before = file_state(source.parent)
    root = tmp_path / "experiments"
    target = root / "corpus" / "snapshot.db"
    try:
        snapshot(source, target, root, approved=True)
        assert read_copy(target) == [(1, "committed in WAL only")]
        assert file_state(source.parent) == before
    finally:
        writer.rollback()


def test_missing_shm_fails_without_creating_sidecar(wal_source, tmp_path):
    source, _ = wal_source
    isolated = tmp_path / "missing-shm"
    isolated.mkdir()
    copied = isolated / source.name
    copied.write_bytes(source.read_bytes())
    Path(str(copied) + "-wal").write_bytes(Path(str(source) + "-wal").read_bytes())
    before = file_state(isolated)
    root = tmp_path / "experiments"
    with pytest.raises(ValueError, match="snapshot failed"):
        snapshot(copied, root / "corpus" / "snapshot.db", root, approved=True)
    assert file_state(isolated) == before


def test_wal_sidecar_symlink_is_rejected(wal_source, tmp_path):
    source, _ = wal_source
    isolated = tmp_path / "linked-wal"
    isolated.mkdir()
    copied = isolated / source.name
    copied.write_bytes(source.read_bytes())
    Path(str(copied) + "-wal").symlink_to(Path(str(source) + "-wal"))
    before = file_state(source.parent)
    root = tmp_path / "experiments"
    with pytest.raises(ValueError, match="symlink"):
        snapshot(copied, root / "corpus" / "snapshot.db", root, approved=True)
    assert file_state(source.parent) == before
    assert not (root / "corpus" / "snapshot.db").exists()


def test_cli_uses_readonly_shm_and_keeps_locking(wal_source, tmp_path, monkeypatch):
    source, _ = wal_source
    original = subprocess.run
    calls = []

    def record(args, **kwargs):
        calls.append(args)
        return original(args, **kwargs)

    monkeypatch.setattr(subprocess, "run", record)
    root = tmp_path / "experiments"
    snapshot(source, root / "corpus" / "snapshot.db", root, approved=True)
    assert len(calls) == 1
    command = calls[0]
    assert "-readonly" in command
    assert any("mode=ro" in arg and "readonly_shm=1" in arg for arg in command)
    assert all("immutable" not in arg and "nolock" not in arg for arg in command)
    assert any(arg.startswith(".backup ") for arg in command)


def test_empty_shm_is_refused_without_changing_permissions(wal_source, tmp_path):
    source, _ = wal_source
    isolated = tmp_path / "empty-shm"
    isolated.mkdir()
    copied = isolated / source.name
    copied.write_bytes(source.read_bytes())
    Path(str(copied) + "-wal").write_bytes(Path(str(source) + "-wal").read_bytes())
    shm = Path(str(copied) + "-shm")
    shm.touch(mode=0o400)
    before = file_state(isolated)
    root = tmp_path / "experiments"
    with pytest.raises(ValueError, match="uninitialised shared memory"):
        snapshot(copied, root / "corpus" / "snapshot.db", root, approved=True)
    assert file_state(isolated) == before
    assert not (root / "corpus" / "snapshot.db").exists()


def test_empty_database_is_refused_without_removing_wal(tmp_path):
    isolated = tmp_path / "empty-source"
    isolated.mkdir()
    source = isolated / "profile.db"
    source.touch()
    Path(str(source) + "-wal").write_bytes(b"synthetic WAL placeholder")
    before = file_state(isolated)
    root = tmp_path / "experiments"
    with pytest.raises(ValueError, match="SQLite database header required"):
        snapshot(source, root / "corpus" / "snapshot.db", root, approved=True)
    assert file_state(isolated) == before
    assert not (root / "corpus" / "snapshot.db").exists()
