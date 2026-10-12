# %% [markdown]
# # Experiment 15: Clef selects the intent label
#
# Reads `output/summary.json` and `output/calls.json`. Run `run_eval.py --phase verify` first.
# Everything after the first cell is exploratory: it looks at the test cases directly.

# %%
import json
import statistics
from pathlib import Path

HERE = Path(__file__).resolve().parent if "__file__" in globals() else Path.cwd()
summary = json.loads((HERE / "output/summary.json").read_text())
calls = json.loads((HERE / "output/calls.json").read_text())
sets = json.loads((HERE.parent / "11-retrieval-catalogue-consolidation-replay-2026-10-11/output/build.json").read_text())["acceptable_sets"]
print(summary["counts"], "errors:", summary["errors"])
print("order consistency:", summary["order_consistency"])
print("none_fit recognition:", summary["none_fit_recognition"])

# %% [markdown]
# ## Did the option order change anything?

# %%
cases = sorted({k[:-2] for k in calls})
diff = max(abs(calls[c + "|1"]["probabilities"][o] - calls[c + "|2"]["probabilities"][o])
           for c in cases for o in calls[c + "|1"]["probabilities"])
print("largest probability difference between orders:", diff)

# %% [markdown]
# ## Risk-coverage over cut-offs (both orders)

# %%
for key, row in summary["exploratory"].items():
    if key.startswith("both") or key == "order1|0.0":
        print(key, row)

# %% [markdown]
# ## How confident is Clef when right and when wrong?

# %%
right, wrong = [], []
for c in cases:
    row = calls[c + "|1"]
    if row["choice"] == "none_fit":
        continue
    (right if row["choice"] in sets[c] else wrong).append(row["probabilities"][row["choice"]])
print(f"right picks: {len(right)}, median p {statistics.median(right):.3f}, max {max(right):.3f}")
print(f"wrong picks: {len(wrong)}, median p {statistics.median(wrong):.3f}, max {max(wrong):.3f}")
