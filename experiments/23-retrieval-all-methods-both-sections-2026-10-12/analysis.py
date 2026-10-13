# ---
# jupyter:
#   jupytext:
#     cell_metadata_filter: -all
#     formats: ipynb,py:percent
#     text_representation:
#       extension: .py
#       format_name: percent
#       format_version: '1.3'
#       jupytext_version: 1.16.0
#   kernelspec:
#     display_name: .venv
#     language: python
#     name: python3
# ---

# %% [markdown]
# # Experiment 23: all label methods, one section against both sections
#
# Reads `output/summary.json`, `output/raw.json`, the saved Experiment 18 and 20 Clef answers and the
# multi-label key. Run `run_eval.py --phase verify` first. The first cell restates planned results.
# Every cell after it is exploratory and cannot change the answer.

# %%
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent if "__file__" in globals() else Path.cwd()
EXPERIMENTS = HERE.parent
E18 = EXPERIMENTS / "18-retrieval-fresh-confirmation-all-methods-2026-10-12"
E19 = EXPERIMENTS / "19-review-catalogue-v2-candidates-2026-10-12"
E20 = EXPERIMENTS / "20-retrieval-catalogue-v2-fresh-test-2026-10-12"
E22 = EXPERIMENTS / "22-retrieval-tag-cutoff-check-2026-10-12/corpus"


def load(path):
    return json.loads(Path(path).read_text())


summary = load(HERE / "output/summary.json")
for key in ("counts", "gates", "H1", "H2", "decision", "status"):
    print(key, json.dumps(summary[key]))
for name, test in summary["H3"]["tests"].items():
    print(name, json.dumps(test))

# %% [markdown]
# ## Planned table: hit@3 per arm and per set
# Hit means at least one of the three tags is a valid label in the multi-label key.

# %%
for scope, arms in summary["arms"].items():
    print(scope)
    for arm, v in arms.items():
        low, high = v["ci95"]
        print(f"  {arm:18s} {v['hits']:4d}/{v['n']:<4d} {v['rate']:.3f} ({low:.3f} to {high:.3f})"
              f"  wrong tags {v['wrong_tags']:4d}/{v['tags']:<4d}  first-pick hits {v['first_pick_hits']}")

# %% [markdown]
# ## Exploratory: how long should Clef's list be, one section against both?
# Hit rate for the first k labels by Clef probability, `none_fit` left out.

# %%
raw = load(HERE / "output/raw.json")
raw18, raw20 = load(E18 / "output/raw.json"), load(E20 / "output/raw.json")
clef_one = {**{f"exp18|{c}": r for c, r in raw18["clef"].items()}, **{f"exp20|{c}": r for c, r in raw20.items()}}
clef_both = raw["clef_both"]
key = {}
for name, file in (("exp18", "multilabel-18.json"), ("exp20", "multilabel-20.json")):
    key.update({f"{name}|{c}": v["labels"] for c, v in load(E22 / file)["decisions"].items()})
labelled = sorted(k for k, v in key.items() if v)


def ranked(row):
    probs = row["probabilities"]
    return [l for l, _ in sorted(probs.items(), key=lambda kv: (-kv[1], kv[0])) if l != "none_fit"]


for k in (1, 2, 3, 4, 5):
    one = sum(any(l in key[c] for l in ranked(clef_one[c])[:k]) for c in labelled)
    both = sum(any(l in key[c] for l in ranked(clef_both[c])[:k]) for c in labelled)
    print(f"top {k}: one section {one}/{len(labelled)} ({one / len(labelled):.1%}), "
          f"both sections {both}/{len(labelled)} ({both / len(labelled):.1%})")

# %% [markdown]
# ## Exploratory: how often does Clef reach for the other section, and how often does it say `none_fit`?

# %%
section_of_label = {l["id"]: l["section"] for l in load(E18 / "corpus/label-input.json")["catalogue"]}
section_of_label_v2 = {l["id"]: l["section"] for l in load(E19 / "output/catalogue-v2.json")["labels"]}
case_section = {}
for name, path in (("exp18", E18 / "corpus/fresh-cases.json"), ("exp20", E20 / "corpus/new-cases.json")):
    case_section.update({f"{name}|{c['id']}": c["section"] for c in load(path)["cases"]})
tags = other = 0
for c, row in clef_both.items():
    labels = section_of_label_v2 if c.startswith("exp20|") else section_of_label
    for label in ranked(row)[:3]:
        tags += 1
        other += labels[label] != case_section[c]
print(f"Clef tags from the other section, both sections: {other}/{tags} ({other / tags:.1%})")
for name, rows in (("one section", clef_one), ("both sections", clef_both)):
    said = sum(rows[c]["choice"] == "none_fit" for c in rows)
    said_valid = sum(rows[c]["choice"] == "none_fit" for c in rows if key[c])
    print(f"Clef said none_fit, {name}: {said}/{len(rows)} overall, {said_valid}/{len(labelled)} where a valid label exists")

# %% [markdown]
# ## Exploratory: do the answers cost more time with the longer list?

# %%
for method, settings in summary["exploratory"]["seconds_per_item"].items():
    print(f"{method:12s} one section {settings['one']:.2f} s, both sections {settings['both']:.2f} s per memory")

# %% [markdown]
# ## Exploratory, added after the result: cosine with both sections against Clef with one section
# The plan tested H2 only for Clef against itself. This cell asks the question the section choice depends on.
# It rebuilds the same tags as `run_eval.py --phase verify` from saved answers. No servers, no writes.

# %%
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, str(HERE))
import run_eval as run  # noqa: E402  (loads the pinned runners read-only)

sets = run.load_sets()
requests, saved = run.build_requests(sets), run.saved_rows()
records = run.make_records(sets, requests, run.merged_rows(saved, raw))
valid = [r for r in records if r["valid"]]
groups = {"all 561 with a valid label": valid,
          "391 valid in own section": [r for r in valid if r["own_valid"]],
          "170 valid only in other section": [r for r in valid if not r["own_valid"]]}
arms = ("clef|one", "cosine|one", "clef|both", "cosine|both", "combination|both")
for name, rs in groups.items():
    print(name)
    for arm in arms:
        hits = sum(run.is_hit(r["arms"][arm], r["valid"]) for r in rs)
        print(f"  {arm:18s} {hits:3d}/{len(rs)} = {hits / len(rs):.1%}")
    for other in ("clef|both", "combination|both"):
        p = run.paired(rs, "cosine|both", other)
        print(f"  cosine|both vs {other:17s} wins {p['wins']:3d} losses {p['losses']:3d} p={p['p']:.3g}")
    for other in ("clef|one",):
        p = run.paired(rs, "cosine|both", other)
        print(f"  cosine|both vs {other:17s} wins {p['wins']:3d} losses {p['losses']:3d} p={p['p']:.3g}")
# Memories where each setting alone gives a hit: how much would a "Clef one, plus cosine both as fallback" rule add?
rs = groups["all 561 with a valid label"]
either = sum(run.is_hit(r["arms"]["clef|one"], r["valid"]) or run.is_hit(r["arms"]["cosine|both"], r["valid"]) for r in rs)
print(f"hit by Clef one OR cosine both (upper bound for a combined rule): {either}/{len(rs)} = {either / len(rs):.1%}")

# %% [markdown]
# ## Exploratory, designed after the result: the mixed five-suggestion review list
# Clef's top three from the memory's own section, then the two labels from the other section whose past
# observations rank closest by cosine (all gallery members, both sections). Compared with Clef's own-section top five.

# %%
other_two = {}
for s in sets.values():
    world, labels = s["world"], s["world"]["labels"]
    for c, case in s["cases"].items():
        ranked_all, _ = run.ranked_gallery_both(run.e18.unit(s["vectors"][c]), world)
        picks = []
        for member in ranked_all:
            label = world["gallery"][member]["label"]
            if label != "none_fit" and labels[label]["section"] != case["section"] and label not in picks:
                picks.append(label)
            if len(picks) == 2:
                break
        other_two[f"{s['name']}|{c}"] = picks
lists = {"Clef top five, own section": lambda r: ranked(clef_one[f"{r['set']}|{r['id']}"])[:5],
         "Clef top three own + two cosine other": lambda r: r["arms"]["clef|one"] + other_two[f"{r['set']}|{r['id']}"]}
for name, tags_of in lists.items():
    cells = [f"{g.split(' ')[0]} {sum(run.is_hit(tags_of(r), r['valid']) for r in rs)}/{len(rs)}"
             f" = {sum(run.is_hit(tags_of(r), r['valid']) for r in rs) / len(rs):.1%}" for g, rs in groups.items()]
    tags = [t for r in records for t in tags_of(r)]
    right = sum(t in r["valid"] for r in records for t in tags_of(r))
    print(f"{name:40s} " + " | ".join(cells) + f" | valid tags {right}/{len(tags)} = {right / len(tags):.1%}")
