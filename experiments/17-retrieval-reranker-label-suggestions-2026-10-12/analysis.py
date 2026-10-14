# %% [markdown]
# # Experiment 17: reranker label suggestions
#
# Reads `output/scores.json` and `output/summary.json`. Run `run_eval.py --phase verify` first.
# The paired and agreement tables below are exploratory except the frozen counts in `summary.json`.

# %%
import importlib.util
import json
import sys
from math import comb
from pathlib import Path

HERE = Path(__file__).resolve().parent if "__file__" in globals() else Path.cwd()
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("experiment17", HERE / "run_eval.py")
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)
world = r.load_world()
cases, fold_of = world[0], world[2]
ids = sorted(fold_of)
requests = r.build_requests(world)
scores = json.loads((HERE / "output/scores.json").read_text())
summary = json.loads((HERE / "output/summary.json").read_text())
print("cosine baseline:", summary["cosine_baseline"])
print("routes:", {k: (v["top1_correct"], v["top3_correct"]) for k, v in summary["routes"].items()})
print("H1:", summary["h1"], "shortlist coverage:", summary["shortlist_coverage"])

# %% [markdown]
# ## Route B against cosine, case by case

# %%
route_b = r.route_rows(scores, requests, "B", "plain", ids)
cosine = {c: r.suggestions(requests[f"A|plain|{c}"]["doc_labels"], list(range(r.SHORTLIST))) for c in ids}
labelled = [c for c in ids if cases[c]["label"] != "none_fit"]


def right(top, c):
    return bool(top) and top[0] in cases[c]["accept"]


only_b = sum(right(route_b[c]["top3"], c) and not right(cosine[c], c) for c in labelled)
only_cos = sum(right(cosine[c], c) and not right(route_b[c]["top3"], c) for c in labelled)
both = sum(right(route_b[c]["top3"], c) and right(cosine[c], c) for c in labelled)
n = only_b + only_cos
p = min(1.0, 2 * sum(comb(n, k) for k in range(min(only_b, only_cos) + 1)) / 2**n) if n else 1.0
print(f"only route B right: {only_b}; only cosine right: {only_cos}; both right: {both}")
print(f"two-sided sign test on the disagreements: p = {p:.3f}")

# %% [markdown]
# ## When the two methods agree

# %%
agree = [c for c in labelled if route_b[c]["top3"][:1] == cosine[c][:1]]
disagree = [c for c in labelled if c not in agree]
print(f"agree on {len(agree)} of {len(labelled)}; right when agreeing: {sum(right(cosine[c], c) for c in agree)}")
print(f"disagree on {len(disagree)}; route B right {sum(right(route_b[c]['top3'], c) for c in disagree)}, "
      f"cosine right {sum(right(cosine[c], c) for c in disagree)}, "
      f"either right {sum(right(route_b[c]['top3'], c) or right(cosine[c], c) for c in disagree)}")
none_cases = [c for c in ids if cases[c]["label"] == "none_fit"]
print(f"none_fit cases where both suggest the same label: "
      f"{sum(route_b[c]['top3'][:1] == cosine[c][:1] for c in none_cases)} of {len(none_cases)}")

# %% [markdown]
# ## Three suggestions on screen: route B's top 2 plus cosine's best other label

# %%
mixed = sum(any(l in cases[c]["accept"]
                for l in route_b[c]["top3"][:2] + [x for x in cosine[c] if x not in route_b[c]["top3"][:2]][:1])
            for c in labelled)
print(f"right label among 3 shown: route B {summary['routes']['B|plain']['top3_correct']}, "
      f"cosine {summary['cosine_baseline']['top3_correct']}, mixed {mixed}")

# %% [markdown]
# ## Exploratory: adding Clef's saved Experiment 15 answers (no new model calls)
#
# Clef's pick is its order-1 choice from Experiment 15. A Clef pick of `none_fit` counts as no label suggested.

# %%
clef_calls = json.loads((HERE.parent / "15-retrieval-clef-intent-select-2026-10-11/output/calls.json").read_text())
clef = {c: clef_calls[f"{c}|1"]["choice"] for c in ids}
picks = {c: {"cosine": cosine[c][0] if cosine[c] else None,
             "reranker": route_b[c]["top3"][0] if route_b[c]["top3"] else None,
             "clef": None if clef[c] == "none_fit" else clef[c]} for c in ids}


def is_right(label, c):
    return label is not None and label in cases[c]["accept"]


for name in ("cosine", "reranker", "clef"):
    on_none = sum(picks[c][name] is not None for c in none_cases)
    print(f"{name}: first right {sum(is_right(picks[c][name], c) for c in labelled)}/67; "
          f"suggests a label on {on_none}/73 no-label cases")

for combo in (("cosine", "reranker"), ("cosine", "clef"), ("reranker", "clef"), ("cosine", "reranker", "clef")):
    agree_lab = [c for c in labelled if len({picks[c][n] for n in combo}) == 1 and picks[c][combo[0]] is not None]
    agree_none = [c for c in none_cases if len({picks[c][n] for n in combo}) == 1 and picks[c][combo[0]] is not None]
    shown = sum(any(is_right(picks[c][n], c) for n in combo) for c in labelled)
    print(f"{' + '.join(combo)}: all agree on {len(agree_lab)}/67 labelled, right {sum(is_right(picks[c][combo[0]], c) for c in agree_lab)}; "
          f"agree on {len(agree_none)}/73 no-label cases; right label among their picks {shown}/67")

vote_right = 0
for c in labelled:
    votes = [picks[c][n] for n in ("cosine", "reranker", "clef") if picks[c][n] is not None]
    best = max(set(votes), key=lambda l: (votes.count(l), l == picks[c]["clef"])) if votes else None
    vote_right += is_right(best, c)
print(f"majority vote of the three (ties go to Clef): first right {vote_right}/67")
