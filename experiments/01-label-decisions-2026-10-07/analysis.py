# %%
"""Read-only Jupytext view and reproduction check for Experiment 01."""

import argparse
import json
from pathlib import Path

from summarise_eval import summarise
from reference_guards import run_root


def load_rows(root):
    """Return per-arm metrics without making model calls."""
    return json.loads((root / "output/eval_results.summary.json").read_text())["arms"]


# %%
if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--verify", action="store_true")
    parser.add_argument("--root", type=Path, required=True)
    args = parser.parse_args()
    root = run_root(args.root)
    if args.verify:
        value = json.loads((root / "corpus/test-manifest.json").read_text())
        expected = summarise(value, root)
        if expected != json.loads((root / "output/eval_results.summary.json").read_text()):
            raise ValueError("saved metrics differ")
        print(json.dumps({"metrics_reproduced": True, "complete": expected["complete"], "hosted_calls": 0}))
    else:
        print(json.dumps(load_rows(root), indent=2))
