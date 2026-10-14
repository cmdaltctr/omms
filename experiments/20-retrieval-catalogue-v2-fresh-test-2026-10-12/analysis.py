# %% [markdown]
# # Experiment 20: catalogue version 2 and Clef top three
#
# Reads `output/summary.json`, `output/raw.json` and the frozen reference. Run `run_eval.py --phase verify` first.
# Everything after the first cell is exploratory.

# %%
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent if "__file__" in globals() else Path.cwd()
summary = json.loads((HERE / "output/summary.json").read_text())
for key in ("counts", "H1", "H2", "H3", "seconds_per_item"):
    print(key, json.dumps(summary[key]))

# %% [markdown]
# ## Exploratory: how long should the suggestion list be?

# %%
raw = json.loads((HERE / "output/raw.json").read_text())
reference = {k: v["label"] for k, v in json.loads((HERE / "corpus/reference.json").read_text())["decisions"].items()}
new_labels = set(json.loads((HERE.parent / "19-review-catalogue-v2-candidates-2026-10-12/output/catalogue-v2.json").read_text())["accepted"])
labelled = [c for c, r in reference.items() if r not in ("none_fit", "uncertain", "disputed")]


def ranked(c):
    probs = raw[c]["probabilities"]
    return [l for l, _ in sorted(probs.items(), key=lambda kv: (-kv[1], kv[0])) if l != "none_fit"]


for k in (1, 2, 3, 4, 5):
    hits = sum(1 for c in labelled if reference[c] in ranked(c)[:k])
    print(f"top {k}: {hits}/{len(labelled)} ({hits / len(labelled):.1%})")
old = [c for c in labelled if reference[c] not in new_labels]
new = [c for c in labelled if reference[c] in new_labels]
for name, group in (("existing labels", old), ("new labels", new)):
    hits = sum(1 for c in group if reference[c] in ranked(c)[:3])
    print(f"top 3 on {name}: {hits}/{len(group)}")
