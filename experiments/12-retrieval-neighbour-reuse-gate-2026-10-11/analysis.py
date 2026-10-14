# %% [markdown]
# # Experiment 12: neighbour gate
#
# Reads `output/summary.json` and `output/predictions.json`. Run `run_eval.py --phase verify` first.
# Everything below the first table is exploratory: it looks at the test cases directly.

# %%
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent if "__file__" in globals() else Path.cwd()
summary = json.loads((HERE / "output/summary.json").read_text())
predictions = json.loads((HERE / "output/predictions.json").read_text())
sets = json.loads((HERE.parent / "11-retrieval-catalogue-consolidation-replay-2026-10-11/output/build.json").read_text())["acceptable_sets"]

# %% [markdown]
# ## Frozen result

# %%
print(summary["counts"])
print("rules per fold:", summary["rules"])
print("learning curve, mean correct:", summary["learning_curve"]["mean_correct"])
print("holding pen:", summary["holding_pen"])
print("paired with Experiment 06:", summary["paired_experiment06"])

# %% [markdown]
# ## Exploratory: how often could the frozen rule fire at all?

# %%
unanimous = sum(1 for r in predictions.values()
                if len({n[1] for n in r["neighbours"][:3]}) == 1 and r["neighbours"][0][1] != "none_fit")
first_right = sum(1 for c, r in predictions.items()
                  if sets[c] != ["none_fit"] and r["neighbours"][0][1] in sets[c])
positives = sum(1 for c in predictions if sets[c] != ["none_fit"])
first_label_on_none = sum(1 for c, r in predictions.items()
                          if sets[c] == ["none_fit"] and r["neighbours"][0][1] != "none_fit")
print(f"unanimous existing top 3: {unanimous} of 140")
print(f"nearest neighbour carries an acceptable label: {first_right} of {positives} labelled cases")
print(f"nearest neighbour carries a label on a none_fit case: {first_label_on_none} of {140 - positives}")

# %% [markdown]
# ## Exploratory: looser rules (k = 1 and k = 2) on the saved neighbour lists

# %%
def loose(k, tau, delta):
    correct = wrong = 0
    for c, r in predictions.items():
        nb = r["neighbours"]
        top = [n[1] for n in nb[:k]]
        label = top[0]
        if label == "none_fit" or any(t != label for t in top):
            continue
        rival = next((n[2] for n in nb if n[1] != label), None)
        gap = float("inf") if rival is None else nb[0][2] - rival
        if nb[0][2] >= tau and gap >= delta:
            correct, wrong = (correct + 1, wrong) if label in sets[c] else (correct, wrong + 1)
    return correct, wrong


for k in (1, 2):
    for tau in (0.6, 0.65, 0.7, 0.74, 0.76, 0.78):
        c, w = loose(k, tau, 0)
        print(f"k={k} tau={tau}: C={c} W={w}")
