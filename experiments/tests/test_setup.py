"""Check that experiment dependencies and personal data stay isolated."""

import subprocess
import unittest
from pathlib import Path
import tomllib


ROOT = Path(__file__).resolve().parents[2]


class SetupTests(unittest.TestCase):
    def test_experiment_environment(self):
        path = ROOT / "experiments/pyproject.toml"
        self.assertTrue(path.is_file(), "Experiment configuration is required")
        config = tomllib.loads(path.read_text())
        self.assertEqual(config["project"]["requires-python"], ">=3.11")
        self.assertEqual(config["project"]["dependencies"], ["pytest==8.4.2"])
        self.assertTrue((ROOT / "experiments/uv.lock").is_file())

    def test_local_data_ignored(self):
        paths = [
            "experiments/03-pair-decisions-2026-10-10/corpus/manifest.json",
            "experiments/03-pair-decisions-2026-10-10/output/results.json",
            "experiments/models/weights.bin",
            "experiments/.venv/pyvenv.cfg",
            "experiments/03-pair-decisions-2026-10-10/analysis.ipynb",
            "experiments/.pytest_cache/state",
            "experiments/tests/__pycache__/test_setup.pyc",
        ]
        result = subprocess.run(
            ["git", "check-ignore", "--stdin"],
            input="\n".join(paths) + "\n",
            text=True, capture_output=True, cwd=ROOT, check=False,
        )
        self.assertEqual(set(result.stdout.splitlines()), set(paths))
        tracked = subprocess.run(
            ["git", "check-ignore", "experiments/tests/test_setup.py"],
            capture_output=True, cwd=ROOT, check=False,
        )
        self.assertEqual(tracked.returncode, 1)


if __name__ == "__main__":
    unittest.main()
