# %% [markdown]
# # Experiment 11: catalogue consolidation replay
#
# Reads `output/summary.json` and `output/build.json`. Run `run_eval.py --phase verify` first.

# %%
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent if "__file__" in globals() else Path.cwd()
summary = json.loads((HERE / "output/summary.json").read_text())
build = json.loads((HERE / "output/build.json").read_text())

# %% [markdown]
# ## Cells: wrong reuse by catalogue size

# %%
print(f"{'cell':<5}{'labels':>7}{'E':>4}{'C':>4}{'W':>4}{'W none_fit':>11}{'W label':>8}{'W/E':>8}{'U95':>8}")
for cell, c in summary["counts"].items():
    print(f"{cell:<5}{summary['labels_per_cell'][cell]:>7}{c['existing']:>4}{c['correct']:>4}"
          f"{c['wrong']:>4}{c['wrong_on_none_fit']:>11}{c['wrong_label_vs_label']:>8}"
          f"{c['wrong_reuse']:>8.4f}{c['upper_bound_95']:>8.4f}")

# %% [markdown]
# ## H1 and guardrail

# %%
print(summary["h1"])
for level, top in summary["guardrail_largest_share"].items():
    print(level, f"{top['share']:.3f}", top["label"].count("+") + 1, "original labels")

# %% [markdown]
# ## Do the test confusions match the development similarity?
#
# Percentile of each confused pair's development similarity among all same-section pairs.

# %%
values = sorted(build["similarity"].values())
for pair in summary["exploratory"]["remaining_confused_pairs"]["C1"]:
    pick, ref = pair.split(" -> ")
    key = "|".join(sorted([pick, ref]))
    score = build["similarity"][key]
    print(f"{sum(v <= score for v in values) / len(values):.2f}  {pair}")
