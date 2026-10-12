"""Experiment 23: four label methods, one section against both sections, on 600 observations.

Phases: check (no Clef answers), run (new reranker and Clef answers), verify (no servers, no writes).
Reuses the pinned Experiment 15, 17, 18 and 20 runners read-only. See protocol.md for the plan.
"""

import argparse
import hashlib
import importlib.util
import json
import sys
import urllib.request
from fractions import Fraction
from pathlib import Path

HERE = Path(__file__).resolve().parent
EXPERIMENTS = HERE.parent
ROOT = EXPERIMENTS.parent
OUT = HERE / "output"
PLAN = json.loads((HERE / "plan.json").read_text(encoding="utf-8"))
FROZEN = PLAN["frozen"]
INPUTS = FROZEN["inputs"]
E18_DIR = EXPERIMENTS / "18-retrieval-fresh-confirmation-all-methods-2026-10-12"
E20_DIR = EXPERIMENTS / "20-retrieval-catalogue-v2-fresh-test-2026-10-12"
E22_CORPUS = EXPERIMENTS / "22-retrieval-tag-cutoff-check-2026-10-12/corpus"
E20_RUNNER = "experiments/20-retrieval-catalogue-v2-fresh-test-2026-10-12/run_eval.py"
SETTINGS = ("one", "both")
METHODS = ("cosine", "reranker", "clef", "combination")  # cheapest first: the decision rule uses this order
NO_LABEL = ("none_fit", "uncertain", "disputed")
SAVE_EVERY = 20
MAX_INPUT_TOKENS = 8192


def load_pinned(key, name):
    """Import a pinned runner read-only; refuse a changed file."""
    path = ROOT / key
    with open(path, "rb") as handle:
        if hashlib.file_digest(handle, "sha256").hexdigest() != INPUTS[key]:
            raise ValueError("input_hash_drift")
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    previous = sys.dont_write_bytecode
    sys.dont_write_bytecode = True
    try:
        spec.loader.exec_module(module)
    finally:
        sys.dont_write_bytecode = previous
    return module


e20 = load_pinned(E20_RUNNER, "experiment23_e20")
e18 = e20.e18
e15, e17, e12 = e18.e15, e18.e17, e18.e12
require, read_json, file_hash, atomic_json = e12.require, e12.read_json, e12.file_hash, e12.atomic_json
digest = e18.digest


def threshold(name):
    """A frozen threshold as an exact fraction, so a gain of exactly 0.10 is not lost to rounding."""
    return Fraction(str(FROZEN["thresholds"][name]))


# --- The three places where "both sections" differs -----------------------------------------


def ranked_gallery_both(vector, world):
    """Experiment 18 ranked_gallery without the same-section filter: every gallery member."""
    members = list(world["gallery"])
    sims = {g: sum(a * b for a, b in zip(vector, world["gallery_vectors"][g])) for g in members}
    return sorted(members, key=lambda g: (-sims[g], g)), sims


def clef_payload_both(case, ranked, world):
    """Experiment 18 clef_payload with every catalogue label as an option, not only the case's section."""
    gallery, labels = world["gallery"], world["labels"]
    chosen = {}
    for member in ranked:
        require(member in gallery, "fresh_in_gallery")
        label = gallery[member]["label"]
        limit = e18.NONE_EXAMPLES if label == "none_fit" else e18.LABEL_EXAMPLES
        if len(chosen.setdefault(label, [])) < limit:
            chosen[label].append(member)
    ids = sorted(labels) + ["none_fit"]
    criteria = {}
    for option in ids:
        if option == "none_fit":
            criteria[option] = e15.option_text(e15.NONE_TEXT, chosen.get("none_fit", []), world["texts"],
                                               "Past observations that matched no label")
        else:
            criteria[option] = e15.option_text(labels[option]["definition"], chosen.get(option, []),
                                               world["texts"], "Past observations filed under this label")
    return {"model": "clef-flash", "state": {"description": case["description"], "section": case["section"]},
            "questions": {"decision": {"type": "choice", "instructions": e15.QUESTION, "criteria": criteria}}}


def reranker_request_both(case, labels):
    """Experiment 18 reranker_request with every catalogue label definition as a document."""
    ids = sorted(labels)
    return {"query": case["description"], "documents": [labels[l]["definition"] for l in ids], "doc_labels": ids}


# --- Inputs and requests --------------------------------------------------------------------


def load_key(name):
    key = f"experiments/22-retrieval-tag-cutoff-check-2026-10-12/corpus/{name}"
    require(file_hash(ROOT / key) == INPUTS[key], "input_hash_drift")
    return {c: v["labels"] for c, v in read_json(ROOT / key)["decisions"].items()}


def load_sets():
    """The two observation sets with their worlds, saved vectors and multi-label keys."""
    w18, w20 = e18.load_world(), e20.load_world()
    sets = {}
    for name, world, cases, vectors, key in (
            ("exp18", w18, w18["fresh"], E18_DIR / "output/fresh-vectors.json", "multilabel-18.json"),
            ("exp20", w20, w20["new"], E20_DIR / "output/new-vectors.json", "multilabel-20.json")):
        multi = load_key(key)
        saved_vectors = read_json(vectors)["vectors"]
        require(set(multi) == set(cases) and set(saved_vectors) >= set(cases), "key_or_vector_coverage")
        require(all(l in world["labels"] for valid in multi.values() for l in valid), "key_label_unknown")
        sets[name] = {"name": name, "world": world, "cases": cases, "vectors": saved_vectors, "key": multi}
    return sets


def build_requests(sets):
    """For every observation and both settings: shortlist, Clef payload and reranker request."""
    requests = {}
    for s in sets.values():
        world = s["world"]
        for c in sorted(s["cases"]):
            case = s["cases"][c]
            vector = e18.unit(s["vectors"][c])
            one, _ = e18.ranked_gallery(vector, case["section"], world)
            both, _ = ranked_gallery_both(vector, world)
            requests[f"{s['name']}|{c}"] = {
                "one": {"shortlist": one[:e18.SHORTLIST], "reranker": e18.reranker_request(case, world["labels"]),
                        "clef": e18.clef_payload(case, one, world)},
                "both": {"shortlist": both[:e18.SHORTLIST], "reranker": reranker_request_both(case, world["labels"]),
                         "clef": clef_payload_both(case, both, world)}}
    return requests


def saved_rows():
    """One-section answers already saved by Experiments 18 and 20."""
    raw18, raw20 = read_json(E18_DIR / "output/raw.json"), read_json(E20_DIR / "output/raw.json")
    return {"clef_one": {**{f"exp18|{c}": r for c, r in raw18["clef"].items()},
                         **{f"exp20|{c}": r for c, r in raw20.items()}},
            "reranker_one": {f"exp18|{c}": r for c, r in raw18["reranker"].items()}}


def request_of(requests, kind, key):
    method, setting = kind.split("_")
    return requests[key][setting][method]


def new_jobs(requests):
    """Calls this experiment makes: reranker one-section for Experiment 20, then both sections for all."""
    return {"reranker_one": [k for k in requests if k.startswith("exp20|")],
            "reranker_both": list(requests), "clef_both": list(requests)}


def merged_rows(saved, raw):
    return {"clef_one": saved["clef_one"], "reranker_one": {**saved["reranker_one"], **raw["reranker_one"]},
            "reranker_both": raw["reranker_both"], "clef_both": raw["clef_both"]}


def count_mismatches(requests, rows):
    """Per row kind: rows checked and rows whose saved request_sha256 differs from the rebuilt request."""
    require(all(set(saved) <= set(requests) for saved in rows.values()), "row_without_request")
    return {kind: {"checked": len(saved),
                   "mismatched": sum(row.get("request_sha256") != digest(request_of(requests, kind, k))
                                     for k, row in saved.items())}
            for kind, saved in rows.items()}


# --- Tags and scoring -----------------------------------------------------------------------


def combine(clef, cosine, reranker, n=3):
    """Round robin by rank: Clef, cosine, reranker at rank 1, then rank 2, and so on; skip repeats."""
    chosen = []
    for rank in range(n):
        for tags in (clef, cosine, reranker):
            if rank < len(tags) and tags[rank] not in chosen:
                chosen.append(tags[rank])
    return chosen[:n]


def method_tags(request, clef_row, reranker_row, gallery):
    """Up to three tags per method for one observation in one setting. A failed call gives no tags."""
    cosine = e18.first_labels(request["shortlist"], gallery)
    reranker = ([request["reranker"]["doc_labels"][i] for i in e17.order_by(reranker_row["scores"])[:3]]
                if reranker_row["status"] == "ok" else [])
    clef = e20.clef_top(clef_row["probabilities"]) if clef_row["status"] == "ok" else []
    return {"cosine": cosine, "reranker": reranker, "clef": clef, "combination": combine(clef, cosine, reranker)}


def make_records(sets, requests, rows):
    records = []
    for s in sets.values():
        labels = s["world"]["labels"]
        for c in sorted(s["cases"]):
            key, case, valid = f"{s['name']}|{c}", s["cases"][c], s["key"][c]
            own = {l for l in labels if labels[l]["section"] == case["section"]}
            record = {"set": s["name"], "id": c, "valid": valid, "own_valid": bool(set(valid) & own),
                      "old": s["world"]["reference"][c], "arms": {}, "ok": {}, "clef_choice": {}, "seconds": {}}
            for setting in SETTINGS:
                clef_row, rerank_row = rows[f"clef_{setting}"][key], rows[f"reranker_{setting}"][key]
                tags = method_tags(requests[key][setting], clef_row, rerank_row, s["world"]["gallery"])
                clef_ok, rerank_ok = clef_row["status"] == "ok", rerank_row["status"] == "ok"
                for method, value in tags.items():
                    record["arms"][f"{method}|{setting}"] = value
                record["ok"].update({f"cosine|{setting}": True, f"reranker|{setting}": rerank_ok,
                                     f"clef|{setting}": clef_ok, f"combination|{setting}": clef_ok and rerank_ok})
                record["clef_choice"][setting] = clef_row.get("choice") if clef_ok else None
                record["seconds"][setting] = {"cosine": 0.0, "reranker": rerank_row.get("duration_seconds", 0.0),
                                              "clef": clef_row.get("duration_seconds", 0.0)}
            records.append(record)
    return records


def is_hit(tags, valid):
    return any(t in valid for t in tags)


def scored(records):
    return [r for r in records if r["valid"]]


def paired(records, a, b):
    """Observations with a valid label where arm a hits and b misses (wins), and the reverse (losses)."""
    pool = scored(records)
    wins = sum(is_hit(r["arms"][a], r["valid"]) and not is_hit(r["arms"][b], r["valid"]) for r in pool)
    losses = sum(is_hit(r["arms"][b], r["valid"]) and not is_hit(r["arms"][a], r["valid"]) for r in pool)
    return {"wins": wins, "losses": losses, "n": len(pool), "p": e18.sign_test(wins, losses)}


def arm_row(records, arm):
    pool = scored(records)
    hits = sum(is_hit(r["arms"][arm], r["valid"]) for r in pool)
    first = sum(bool(r["arms"][arm]) and r["arms"][arm][0] in r["valid"] for r in pool)
    tags = sum(len(r["arms"][arm]) for r in records)
    wrong = sum(sum(t not in r["valid"] for t in r["arms"][arm]) for r in records)
    return {"hits": hits, "n": len(pool), "rate": hits / len(pool) if pool else None,
            "ci95": e18.interval(hits, len(pool)), "first_pick_hits": first, "tags": tags, "wrong_tags": wrong,
            "tag_precision": (tags - wrong) / tags if tags else None,
            "tags_per_item": tags / len(records) if records else None}


def holm(ps):
    """Holm-adjusted p-values in the original order."""
    adjusted, running = [None] * len(ps), 0.0
    for rank, i in enumerate(sorted(range(len(ps)), key=lambda i: ps[i])):
        running = max(running, min(1.0, (len(ps) - rank) * ps[i]))
        adjusted[i] = running
    return adjusted


def judge_h1(records):
    """Clef both minus Clef one, pooled: gain at least the frozen minimum and exact McNemar below alpha."""
    pair = paired(records, "clef|both", "clef|one")
    n, gain = pair["n"], pair["wins"] - pair["losses"]
    holds = bool(n) and Fraction(gain, n) >= threshold("H1_min_gain") and pair["p"] < threshold("H1_alpha")
    return {**pair, "gain": gain / n if n else None, "min_gain": FROZEN["thresholds"]["H1_min_gain"],
            "alpha": FROZEN["thresholds"]["H1_alpha"], "holds": holds}


def judge_h2(records):
    """On observations with a valid label in their own section, Clef both loses at most the frozen margin."""
    pool = [r for r in scored(records) if r["own_valid"]]
    one = sum(is_hit(r["arms"]["clef|one"], r["valid"]) for r in pool)
    both = sum(is_hit(r["arms"]["clef|both"], r["valid"]) for r in pool)
    n = len(pool)
    return {"n": n, "hits_one": one, "hits_both": both, "rate_one": one / n if n else None,
            "rate_both": both / n if n else None, "max_loss": FROZEN["thresholds"]["H2_max_loss"],
            "holds": bool(n) and Fraction(one - both, n) <= threshold("H2_max_loss")}


def judge_h3(records):
    """Clef against each other method with both sections; Holm correction over the three tests."""
    others = [m for m in METHODS if m != "clef"]
    pairs = {m: paired(records, "clef|both", f"{m}|both") for m in others}
    adjusted = holm([pairs[m]["p"] for m in others])
    alpha = threshold("H3_alpha")
    for m, p_holm in zip(others, adjusted):
        pair = pairs[m]
        pair["p_holm"] = p_holm
        pair["significant"] = p_holm < alpha
        pair["direction"] = ("clef better" if pair["wins"] > pair["losses"] else
                             "clef worse" if pair["wins"] < pair["losses"] else "tie")
    return {"tests": {f"clef_vs_{m}": pairs[m] for m in others}, "alpha": FROZEN["thresholds"]["H3_alpha"],
            "any_significant": any(pairs[m]["significant"] for m in others)}


def choose_method(hits, n):
    """Best hit rate; the cheapest method within the frozen margin of it wins. hits maps method to count."""
    best = max(hits.values())
    return next(m for m in METHODS if Fraction(best - hits[m], n) <= threshold("method_equivalence"))


def decide(h1, h2, hits_by_setting, n):
    """Section setting from H1 and H2; method from the hit rates in each setting."""
    if h1["holds"] and h2["holds"]:
        setting = "both"
    elif h1["holds"]:
        setting = "operator decides"
    else:
        setting = "one"
    methods = {s: choose_method(hits_by_setting[s], n) for s in SETTINGS}
    return {"section_setting": setting, "method_if_one": methods["one"], "method_if_both": methods["both"],
            "method": methods["both"] if setting == "both" else methods["one"] if setting == "one" else None}


def status_of(gates_pass, h1, h2):
    if not gates_pass:
        return "INCONCLUSIVE"
    return "PASS" if h1["holds"] and h2["holds"] else "MIXED" if h1["holds"] else "FAIL"


def mean_seconds(records, method, setting):
    def per_item(r):
        s = r["seconds"][setting]
        return s["clef"] + s["reranker"] if method == "combination" else s[method]
    return sum(per_item(r) for r in records) / len(records)


def summarise(records, gates):
    """gates: the G2 and G3 results recomputed from the saved rows; G4 is added here."""
    arms = [f"{m}|{s}" for s in SETTINGS for m in METHODS]
    scopes = {"pooled": records, "exp18": [r for r in records if r["set"] == "exp18"],
              "exp20": [r for r in records if r["set"] == "exp20"]}
    pool = scored(records)
    h1, h2, h3 = judge_h1(records), judge_h2(records), judge_h3(records)
    table = {scope: {arm: arm_row(rs, arm) for arm in arms} for scope, rs in scopes.items()}
    hits = {s: {m: table["pooled"][f"{m}|{s}"]["hits"] for m in METHODS} for s in SETTINGS}
    answers = {arm: sum(r["ok"][arm] for r in records) for arm in arms}
    g4 = {"valid_answers": answers, "expected": len(records), "pass": all(v == len(records) for v in answers.values())}
    no_label = [r for r in records if not r["valid"]]
    other_only = [r for r in pool if not r["own_valid"]]
    old_hits = lambda rs, arm: sum(r["old"] in r["arms"][arm] for r in rs)
    decision = decide(h1, h2, hits, len(pool))
    cost = {m: {s: mean_seconds(records, m, s) for s in SETTINGS} for m in METHODS}
    return e12.normalised({
        "counts": {"observations": len(records), "with_valid_label": len(pool),
                   "no_valid_label": len(no_label), "valid_only_in_other_section": len(other_only),
                   "own_section_valid": len(pool) - len(other_only),
                   "by_set": {k: {"observations": len(v), "with_valid_label": len(scored(v))}
                              for k, v in scopes.items() if k != "pooled"}},
        "gates": {**gates, "G4_completeness": g4},
        "H1": h1, "H2": h2, "H3": h3, "decision": decision,
        "status": status_of(all(g["pass"] for g in (*gates.values(), g4)), h1, h2),
        "arms": table,
        "exploratory": {
            "both_vs_one_by_method": {m: paired(records, f"{m}|both", f"{m}|one") for m in METHODS},
            "clef_both_vs_one_by_set": {k: paired(v, "clef|both", "clef|one") for k, v in scopes.items()},
            "valid_only_in_other_section": {arm: {"hits": sum(is_hit(r["arms"][arm], r["valid"]) for r in other_only),
                                                  "n": len(other_only)} for arm in arms},
            "clef_none_fit_on_no_valid_label": {s: {"said_none_fit": sum(r["clef_choice"][s] == "none_fit"
                                                                          for r in no_label), "n": len(no_label)}
                                                for s in SETTINGS},
            "seconds_per_item": cost,
            "decision_cost_seconds_per_memory": {"one": cost[decision["method_if_one"]]["one"],
                                                 "both": cost[decision["method_if_both"]]["both"]},
            "old_single_label_key": {scope: {"labelled": len([r for r in rs if r["old"] not in NO_LABEL]),
                                             "hits": {arm: old_hits([r for r in rs if r["old"] not in NO_LABEL], arm)
                                                      for arm in arms}} for scope, rs in scopes.items()},
        }})


# --- Gates ----------------------------------------------------------------------------------

RELIABLE_RESIDUAL = 20  # the token model counts as reliable only if it explains saved usage within this many tokens


def check_inputs():
    """G1: every pinned input, the Experiment 12 pins, the reranker file and the Clef runtime."""
    def passes(check, *args):
        try:
            check(*args)
            return True
        except ValueError:
            return False

    drifted = [k for k, expected in INPUTS.items() if file_hash(ROOT / k) != expected]
    result = {"inputs": len(INPUTS), "drifted": drifted, "experiment12_pins": passes(e12.check_pins),
              "reranker_gguf": passes(e17.verify_gguf) and e17.GGUF_SHA256 == FROZEN["models"]["reranker_gguf_sha256"],
              "clef_runtime": passes(e15.verify_clef_runtime, e15.clef_model())}
    result["pass"] = not drifted and all(v for k, v in result.items() if k not in ("inputs", "drifted"))
    return result


def baseline_gate(requests, saved):
    """G2: every rebuilt one-section request matches the request_sha256 saved by Experiments 18 and 20."""
    found = count_mismatches(requests, saved)
    expected = {"clef_one": len(requests), "reranker_one": sum(k.startswith("exp18|") for k in requests)}
    return {"checked": {k: v["checked"] for k, v in found.items()},
            "mismatched": {k: v["mismatched"] for k, v in found.items()},
            "pass": all(v["mismatched"] == 0 and v["checked"] == expected[k] for k, v in found.items())}


def run_gates(requests, saved, rows):
    """G2 and G3 from saved rows only, so that verify can recompute them without a server."""
    g2 = baseline_gate(requests, saved)
    every_row = count_mismatches(requests, rows)
    g2["all_rows_mismatched"] = sum(v["mismatched"] for v in every_row.values())
    g2["pass"] = g2["pass"] and g2["all_rows_mismatched"] == 0
    used = [r["usage"]["input_tokens"] for r in rows["clef_both"].values() if r["status"] == "ok"]
    refused = sum(r["status"] != "ok" and "invalid_usage" in r.get("error_code", "") for r in rows["clef_both"].values())
    return {"G2_baseline_match": g2,
            "G3_fit": {"max_input_tokens": max(used, default=None), "answered": len(used), "limit": MAX_INPUT_TOKENS,
                       "refused_for_length": refused, "pass": bool(used) and max(used) <= MAX_INPUT_TOKENS and not refused}}


def tokenize(text):
    """Token count of a text from the owned Clef server's own tokenizer."""
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    request = urllib.request.Request(f"http://127.0.0.1:{e15.CLEF_PORT}/tokenize",
                                     data=json.dumps({"content": text, "add_special": False}).encode(),
                                     headers={"Content-Type": "application/json"})
    with opener.open(request, timeout=120) as response:
        return len(json.loads(response.read().decode())["tokens"])


def token_features(payload):
    """Constant, description, option names, option texts (each tokenised) and the option count."""
    criteria = payload["questions"]["decision"]["criteria"]
    return [1.0, tokenize(payload["state"]["description"]), tokenize("\n".join(criteria)),
            tokenize("\n".join(criteria.values())), float(len(criteria))]


def least_squares(x, y):
    """Normal equations, solved by Gauss-Jordan elimination with partial pivoting."""
    k = len(x[0])
    a = [[sum(r[i] * r[j] for r in x) for j in range(k)] + [sum(r[i] * t for r, t in zip(x, y))] for i in range(k)]
    for col in range(k):
        pivot = max(range(col, k), key=lambda r: abs(a[r][col]))
        a[col], a[pivot] = a[pivot], a[col]
        for r in range(k):
            if r != col:
                factor = a[r][col] / a[col][col]
                a[r] = [v - factor * w for v, w in zip(a[r], a[col])]
    return [a[i][k] / a[i][i] for i in range(k)]


def predict(coefficients, features):
    return sum(c * f for c, f in zip(coefficients, features))


def token_gate(requests, saved):
    """G3: estimate every both-section Clef request's input tokens. Needs the owned Clef server running.

    The server builds its own prompt, so a plain tokenizer count is 250 to 385 tokens short. The estimate
    fits the 600 saved one-section usage counts on the tokenised pieces plus the option count, then applies
    that fit to the both-section requests. A second fit on Experiment 18 alone gives a stricter bound.
    """
    keys = sorted(saved["clef_one"])
    x = [token_features(requests[k]["one"]["clef"]) for k in keys]
    y = [float(saved["clef_one"][k]["usage"]["input_tokens"]) for k in keys]
    coefficients = least_squares(x, y)
    residuals = [t - predict(coefficients, f) for t, f in zip(y, x)]
    early = [i for i, k in enumerate(keys) if k.startswith("exp18|")]
    late = [i for i, k in enumerate(keys) if k.startswith("exp20|")]
    early_fit = least_squares([x[i] for i in early], [y[i] for i in early])
    held_out = [y[i] - predict(early_fit, x[i]) for i in late]
    both = [token_features(requests[k]["both"]["clef"]) for k in sorted(requests)]
    estimates = [predict(coefficients, f) for f in both]
    strict = [max(predict(coefficients, f), predict(early_fit, f)) + max(residuals) for f in both]
    over = sum(e > MAX_INPUT_TOKENS for e in strict)
    reliable = max(abs(r) for r in residuals) <= RELIABLE_RESIDUAL
    return {"method": "server /tokenize on description, option names and option texts, plus option count, "
                      "fitted to the saved usage.input_tokens of the 600 one-section requests",
            "requests": len(both), "calibration_rows": len(keys), "coefficients": [round(c, 4) for c in coefficients],
            "residual_min": min(residuals), "residual_max": max(residuals), "reliable_within": RELIABLE_RESIDUAL,
            "held_out_exp18_fit_on_exp20_error_min": min(held_out), "held_out_exp18_fit_on_exp20_error_max": max(held_out),
            "options_max": int(max(f[4] for f in both)), "estimated_max_tokens": max(estimates),
            "strict_max_tokens": max(strict), "limit": MAX_INPUT_TOKENS, "over_limit": over,
            "reliable": reliable, "pass": reliable and over == 0}


# --- Phases ---------------------------------------------------------------------------------


def phase_check():
    """G1 to G3 with no Clef answers. Writes only output/check.json."""
    sets = load_sets()
    requests = build_requests(sets)
    saved = saved_rows()
    g1, g2 = check_inputs(), baseline_gate(requests, saved)
    g3 = None
    if g1["pass"]:
        model = e15.clef_model()
        with e15.OwnedServer(model):
            g3 = token_gate(requests, saved)
    jobs = new_jobs(requests)
    pool = [(s, c) for s in sets.values() for c in s["cases"] if s["key"][c]]
    result = {"phase": "check", "pass": bool(g1["pass"] and g2["pass"] and g3 and g3["pass"]),
              "G1_integrity": g1, "G2_baseline_match": g2, "G3_fit": g3,
              "counts": {"observations": len(requests), "with_valid_label": len(pool),
                         "options_one_max": max(len(r["one"]["clef"]["questions"]["decision"]["criteria"])
                                                for r in requests.values()),
                         "options_both": {s["name"]: len(s["world"]["labels"]) + 1 for s in sets.values()},
                         "new_calls": {k: len(v) for k, v in jobs.items()}}}
    atomic_json(OUT / "check.json", result)
    for name in ("pass", "G1_integrity", "G2_baseline_match", "G3_fit", "counts"):
        print(name, json.dumps(result[name]), flush=True)


def phase_run(resume):
    """New reranker answers first, then new Clef answers; one owned server at a time."""
    require(read_json(OUT / "check.json").get("pass") is True, "check_not_passed")
    require(check_inputs()["pass"], "input_hash_drift")
    sets = load_sets()
    requests, saved = build_requests(sets), saved_rows()
    require(baseline_gate(requests, saved)["pass"], "baseline_mismatch")
    raw_path = OUT / "raw.json"
    require(resume or not raw_path.exists(), "raw_exists_use_resume")
    raw = read_json(raw_path) if raw_path.exists() else {"reranker_one": {}, "reranker_both": {}, "clef_both": {}}
    jobs = new_jobs(requests)

    def pending(kind):
        return [k for k in jobs[kind]
                if not (k in raw[kind] and raw[kind][k].get("request_sha256") == digest(request_of(requests, kind, k))
                        and raw[kind][k]["status"] == "ok")]

    def answer(kind, call):
        todo = pending(kind)
        for index, key in enumerate(todo, 1):
            payload = request_of(requests, kind, key)
            raw[kind][key] = {**call(payload), "request_sha256": digest(payload)}
            if index % SAVE_EVERY == 0 or index == len(todo):
                atomic_json(raw_path, raw)
                print(f"{kind} {index}/{len(todo)}", flush=True)

    if pending("reranker_one") or pending("reranker_both"):
        e17.verify_gguf()
        with e17.OwnedServer():
            for kind in ("reranker_one", "reranker_both"):
                answer(kind, lambda p: e17.call({"query": p["query"], "documents": p["documents"]}))
        e17.verify_gguf()
    if pending("clef_both"):
        model = e15.clef_model()
        e15.verify_clef_runtime(model)
        with e15.OwnedServer(model) as server:
            server.preflight()
            answer("clef_both", e15.call)
        e15.verify_clef_runtime(model)
    atomic_json(raw_path, raw)
    rows = merged_rows(saved, raw)
    summary = summarise(make_records(sets, requests, rows), run_gates(requests, saved, rows))
    atomic_json(OUT / "summary.json", summary)
    after = check_inputs()
    atomic_json(OUT / "run-manifest.json", {
        "runner_sha256": file_hash(Path(__file__)), "inputs": INPUTS, "G1_after_run": after,
        "outputs": {n: file_hash(OUT / n) for n in ("check.json", "raw.json", "summary.json")}})
    require(after["pass"], "input_hash_drift")
    for key in ("counts", "gates", "H1", "H2", "decision", "status"):
        print(key, json.dumps(summary[key]), flush=True)


def phase_verify():
    """Rebuild every request, match every saved hash and recompute summary.json. No servers, no writes."""
    drifted = [k for k, expected in INPUTS.items() if file_hash(ROOT / k) != expected]
    require(not drifted, "input_hash_drift")
    e12.check_pins()
    sets = load_sets()
    requests, saved = build_requests(sets), saved_rows()
    rows = merged_rows(saved, read_json(OUT / "raw.json"))
    require(all(len(r) == len(requests) for r in rows.values()), "rows_incomplete")
    summary = summarise(make_records(sets, requests, rows), run_gates(requests, saved, rows))
    require(read_json(OUT / "summary.json") == summary, "summary_mismatch")
    for name, expected in read_json(OUT / "run-manifest.json")["outputs"].items():
        require(file_hash(OUT / name) == expected, "output_changed")
    print("Verified requests, hashes and summary; zero writes; no servers", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--phase", choices=("check", "run", "verify"), required=True)
    parser.add_argument("--resume", action="store_true")
    args = parser.parse_args()
    if args.phase == "check":
        phase_check()
    elif args.phase == "run":
        phase_run(args.resume)
    else:
        phase_verify()


if __name__ == "__main__":
    main()
