# %% [markdown]
# # Experiment 18: fresh-data confirmation of all methods together
#
# Reads `output/summary.json`, `output/raw.json` and the frozen reference. Run `run_eval.py --phase verify` first.
# The frozen hypotheses are in `summary.json`. Everything after the first cell is exploratory.

# %%
import importlib.util
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent if "__file__" in globals() else Path.cwd()
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("experiment18", HERE / "run_eval.py")
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)
summary = json.loads((HERE / "output/summary.json").read_text())
for key in ("reference_counts", "H1", "H2", "H3", "H4", "clef_none_fit_recognition", "top3_right", "seconds_per_item"):
    print(key, json.dumps(summary[key]))

# %% [markdown]
# ## Exploratory: other suggestion lists on the same fresh cases

# %%
world = r.load_world()
raw = json.loads((HERE / "output/raw.json").read_text())
requests = r.build_requests(world, json.loads((HERE / "output/fresh-vectors.json").read_text())["vectors"])
answers = r.score_answers(requests, raw, world)
reference = world["reference"]
labelled = [c for c, v in reference.items() if v not in ("none_fit", "uncertain", "disputed")]
none_cases = [c for c, v in reference.items() if v == "none_fit"]


def clef_top(c, n):
    probs = raw["clef"][c]["probabilities"]
    return [l for l, _ in sorted(probs.items(), key=lambda kv: -kv[1]) if l != "none_fit"][:n]


picks = {c: {"cosine": (answers[c]["cosine"]["top3"] or [None])[0],
             "reranker": (answers[c]["reranker"]["top3"] or [None])[0],
             "clef": answers[c]["clef"]["pick"]} for c in reference}
n = len(labelled)
print(f"Clef top-3 by probability contains the right label: {sum(reference[c] in clef_top(c, 3) for c in labelled)}/{n}")
print(f"Clef top-2 plus cosine pick: {sum(reference[c] in set(clef_top(c, 2) + [picks[c]['cosine']]) for c in labelled)}/{n}")
for pair in (("cosine", "clef"), ("reranker", "clef"), ("cosine", "reranker")):
    union = sum(any(picks[c][m] == reference[c] for m in pair) for c in labelled)
    agree = [c for c in labelled if picks[c][pair[0]] is not None and picks[c][pair[0]] == picks[c][pair[1]]]
    agree_none = sum(1 for c in none_cases if picks[c][pair[0]] is not None and picks[c][pair[0]] == picks[c][pair[1]])
    print(f"{' + '.join(pair)}: union {union}/{n}; agree {len(agree)}, right {sum(picks[c][pair[0]] == reference[c] for c in agree)}; "
          f"agree on no-label cases {agree_none}/{len(none_cases)}")
