"""Run documented tooling commands against synthetic data."""

import sqlite3
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "experiments/tooling.py"


def run(*args):
    assert SCRIPT.is_file(), "Tooling command required"
    return subprocess.run([sys.executable, str(SCRIPT), *map(str, args)], cwd=ROOT, text=True, capture_output=True)


def test_documented_snapshot_command(tmp_path):
    source = tmp_path / "source.db"
    with sqlite3.connect(source) as db:
        db.execute("CREATE TABLE items (id INTEGER)")
        db.execute("INSERT INTO items VALUES (1)")
    root = tmp_path / "experiments"
    target = root / "corpus/copy.db"
    result = run("snapshot", "--source", source, "--target", target, "--root", root, "--snapshot-approved")
    assert result.returncode == 0, result.stderr
    assert target.exists()
    refused = run("snapshot", "--source", source, "--target", root / "corpus/refused.db", "--root", root)
    assert refused.returncode != 0
    assert not (root / "corpus/refused.db").exists()


def test_documented_resume_command(tmp_path):
    first = run("resume-probe", "--root", tmp_path)
    assert first.returncode == 0, first.stderr
    assert '"written": 1' in first.stdout
    resumed = run("resume-probe", "--root", tmp_path, "--resume")
    assert resumed.returncode == 0, resumed.stderr
    assert '"written": 0' in resumed.stdout
    refused = run("resume-probe", "--root", tmp_path)
    assert refused.returncode != 0
