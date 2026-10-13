"""Tests for Experiment 23 run_eval.py. Synthetic data only; no servers, no observation text."""

import math
import sys
from pathlib import Path

import pytest

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
import run_eval as r  # noqa: E402

e15, e18 = r.e15, r.e18


# --- Synthetic world ------------------------------------------------------------------------


def unit_at(degrees):
    angle = math.radians(degrees)
    return [math.cos(angle), math.sin(angle)]


LABELS = {"pref_a": "preferences", "pref_b": "preferences", "pat_a": "patterns", "pat_b": "patterns"}
# member id: (label, section, angle from the query vector in degrees)
MEMBERS = {"g1": ("pref_a", "preferences", 5), "g2": ("pat_a", "patterns", 10), "g3": ("pref_a", "preferences", 15),
           "g4": ("pat_b", "patterns", 20), "g5": ("none_fit", "preferences", 25), "g6": ("pref_b", "preferences", 30),
           "g7": ("none_fit", "patterns", 35), "g8": ("none_fit", "patterns", 40), "g9": ("none_fit", "patterns", 45),
           "g10": ("pat_a", "patterns", 50), "g11": ("pref_b", "preferences", 55), "g12": ("pat_a", "patterns", 60)}
CASE = {"description": "A synthetic observation.", "section": "preferences"}


def toy_world(single_section=False):
    labels = {l: {"id": l, "section": "preferences" if single_section else s, "definition": f"Definition of {l}."}
              for l, s in LABELS.items()}
    members = {g: (lab, "preferences" if single_section else sec, deg) for g, (lab, sec, deg) in MEMBERS.items()}
    return {"gallery": {g: {"label": lab, "section": sec} for g, (lab, sec, _) in members.items()},
            "gallery_vectors": {g: unit_at(deg) for g, (_, _, deg) in members.items()},
            "texts": {g: f"Text of {g}." for g in members}, "labels": labels}


QUERY = [1.0, 0.0]


# --- The "both sections" variants drop only the section filter --------------------------------


def test_ranked_gallery_both_ranks_every_member_by_similarity():
    world = toy_world()
    ranked, _ = r.ranked_gallery_both(QUERY, world)
    assert ranked == [f"g{i}" for i in range(1, 13)]


def test_ranked_gallery_both_restricted_to_a_section_equals_experiment_18():
    world = toy_world()
    ranked, _ = r.ranked_gallery_both(QUERY, world)
    for section in ("preferences", "patterns"):
        kept = [g for g in ranked if world["gallery"][g]["section"] == section]
        assert kept == e18.ranked_gallery(QUERY, section, world)[0]


def test_ranked_gallery_both_breaks_ties_by_id():
    world = toy_world()
    world["gallery_vectors"]["g2"] = unit_at(5)
    ranked, _ = r.ranked_gallery_both(QUERY, world)
    assert ranked[:2] == ["g1", "g2"]


def test_with_a_single_section_every_variant_equals_experiment_18_exactly():
    world = toy_world(single_section=True)
    ranked_one, _ = e18.ranked_gallery(QUERY, "preferences", world)
    ranked_both, _ = r.ranked_gallery_both(QUERY, world)
    assert ranked_both == ranked_one
    assert e18.digest(r.clef_payload_both(CASE, ranked_both, world)) == e18.digest(e18.clef_payload(CASE, ranked_one, world))
    assert r.reranker_request_both(CASE, world["labels"]) == e18.reranker_request(CASE, world["labels"])


def test_clef_options_are_every_label_sorted_then_none_fit():
    world = toy_world()
    ranked, _ = r.ranked_gallery_both(QUERY, world)
    payload = r.clef_payload_both(CASE, ranked, world)
    assert list(payload["questions"]["decision"]["criteria"]) == ["pat_a", "pat_b", "pref_a", "pref_b", "none_fit"]
    one = e18.clef_payload(CASE, e18.ranked_gallery(QUERY, "preferences", world)[0], world)
    assert list(one["questions"]["decision"]["criteria"]) == ["pref_a", "pref_b", "none_fit"]


def test_clef_payload_keeps_shape_question_and_state():
    world = toy_world()
    ranked, _ = r.ranked_gallery_both(QUERY, world)
    both = r.clef_payload_both(CASE, ranked, world)
    one = e18.clef_payload(CASE, e18.ranked_gallery(QUERY, "preferences", world)[0], world)
    assert both["model"] == one["model"] == "clef-flash"
    assert both["state"] == one["state"] == {"description": CASE["description"], "section": "preferences"}
    assert both["questions"]["decision"]["type"] == one["questions"]["decision"]["type"]
    assert both["questions"]["decision"]["instructions"] == e15.QUESTION
    assert set(both) == set(one) and set(both["questions"]["decision"]) == set(one["questions"]["decision"])


def test_clef_examples_come_from_both_sections_two_per_label_three_for_none_fit():
    world = toy_world()
    ranked, _ = r.ranked_gallery_both(QUERY, world)
    criteria = r.clef_payload_both(CASE, ranked, world)["questions"]["decision"]["criteria"]
    # pat_a has three gallery members (g2, g10, g12): only the two nearest are listed.
    assert "Text of g2." in criteria["pat_a"] and "Text of g10." in criteria["pat_a"]
    assert "Text of g12." not in criteria["pat_a"]
    # none_fit has four members (g5, g7, g8, g9): the three nearest, drawn from both sections.
    assert all(f"Text of {g}." in criteria["none_fit"] for g in ("g5", "g7", "g8"))
    assert "Text of g9." not in criteria["none_fit"]
    # pref_a has two members: both are listed.
    assert "Text of g1." in criteria["pref_a"] and "Text of g3." in criteria["pref_a"]


def test_reranker_documents_are_every_label_definition_sorted():
    world = toy_world()
    request = r.reranker_request_both(CASE, world["labels"])
    assert request["doc_labels"] == ["pat_a", "pat_b", "pref_a", "pref_b"]
    assert request["documents"] == [f"Definition of {l}." for l in request["doc_labels"]]
    assert request["query"] == CASE["description"]
    assert e18.reranker_request(CASE, world["labels"])["doc_labels"] == ["pref_a", "pref_b"]


def test_build_requests_one_section_is_experiment_18_unchanged_and_both_differs():
    world = toy_world()
    sets = {"toy": {"name": "toy", "world": world, "cases": {"c1": CASE}, "vectors": {"c1": [3.0, 0.0]},
                    "key": {"c1": ["pat_a"]}}}
    built = r.build_requests(sets)["toy|c1"]
    ranked_one, _ = e18.ranked_gallery(QUERY, "preferences", world)
    assert built["one"]["clef"] == e18.clef_payload(CASE, ranked_one, world)
    assert built["one"]["reranker"] == e18.reranker_request(CASE, world["labels"])
    assert built["one"]["shortlist"] == ranked_one[:10]
    assert built["both"]["shortlist"] == [f"g{i}" for i in range(1, 11)]
    assert built["both"]["clef"] != built["one"]["clef"]


# --- Tags and the combination -----------------------------------------------------------------


def test_combination_is_round_robin_by_rank_in_the_order_clef_cosine_reranker():
    assert r.combine(["a", "b", "c"], ["d", "e", "f"], ["g", "h", "i"]) == ["a", "d", "g"]
    assert r.combine(["a", "b"], ["c", "d"], ["e", "f"]) == ["a", "c", "e"]


def test_combination_skips_duplicates_and_keeps_three():
    assert r.combine(["a", "b", "c"], ["a", "d"], ["e", "a", "b"]) == ["a", "e", "b"]
    assert r.combine(["a", "b", "c"], ["a", "b", "c"], ["a", "b", "c"]) == ["a", "b", "c"]


def test_combination_copes_with_short_and_empty_methods():
    assert r.combine([], ["x"], []) == ["x"]
    assert r.combine([], [], []) == []
    assert r.combine(["a"], [], ["b", "c", "d"]) == ["a", "b", "c"]


def rows(clef_probs=None, scores=None):
    clef = ({"status": "ok", "choice": "x", "probabilities": clef_probs} if clef_probs
            else {"status": "error", "error_code": "OSError"})
    rerank = {"status": "ok", "scores": scores} if scores else {"status": "error", "error_code": "OSError"}
    return clef, rerank


def test_method_tags_clef_excludes_none_fit_and_orders_by_probability():
    request = {"shortlist": ["g1", "g2", "g3"], "reranker": {"doc_labels": ["pref_a", "pref_b", "pat_a", "pat_b"]}}
    clef, rerank = rows({"none_fit": 0.5, "pref_a": 0.2, "pref_b": 0.15, "pat_a": 0.1, "pat_b": 0.05},
                        [0.1, 0.9, 0.5, 0.3])
    tags = r.method_tags(request, clef, rerank, toy_world()["gallery"])
    assert tags["clef"] == ["pref_a", "pref_b", "pat_a"]
    assert tags["reranker"] == ["pref_b", "pat_a", "pat_b"]
    assert tags["cosine"] == ["pref_a", "pat_a"]
    assert tags["combination"] == ["pref_a", "pref_b", "pat_a"]


def test_a_failed_call_gives_no_tags_and_counts_as_a_miss():
    request = {"shortlist": ["g1"], "reranker": {"doc_labels": ["pref_a"]}}
    clef, rerank = rows()
    tags = r.method_tags(request, clef, rerank, toy_world()["gallery"])
    assert tags["clef"] == [] and tags["reranker"] == [] and tags["cosine"] == ["pref_a"]
    assert tags["combination"] == ["pref_a"]
    assert not r.is_hit(tags["clef"], ["pref_a"])


# --- hit@3 against a multi-label key ------------------------------------------------------------


def record(valid, arms, own_valid=True, set_name="exp18", old="none_fit"):
    return {"set": set_name, "id": "x", "valid": valid, "own_valid": own_valid, "old": old, "arms": arms,
            "ok": {a: True for a in arms}, "clef_choice": {"one": None, "both": None},
            "seconds": {s: {"cosine": 0.0, "reranker": 0.5, "clef": 4.0} for s in r.SETTINGS}}


def test_a_hit_needs_any_one_of_the_three_tags_to_be_valid():
    assert r.is_hit(["a", "b", "c"], ["c"])
    assert r.is_hit(["a"], ["x", "a", "y"])
    assert not r.is_hit(["a", "b", "c"], ["d"])
    assert not r.is_hit([], ["a"])


def test_hit_rate_counts_only_observations_with_a_valid_label():
    records = [record(["a"], {"m": ["a", "x", "y"]}), record(["b", "c"], {"m": ["x", "c"]}),
               record(["d"], {"m": ["x"]}), record([], {"m": ["x", "y"]})]
    row = r.arm_row(records, "m")
    assert (row["hits"], row["n"]) == (2, 3)
    assert row["rate"] == pytest.approx(2 / 3)


def test_tag_precision_counts_every_tag_including_items_with_no_valid_label():
    records = [record(["a"], {"m": ["a", "x", "y"]}), record([], {"m": ["x", "y"]})]
    row = r.arm_row(records, "m")
    assert (row["tags"], row["wrong_tags"]) == (5, 4)
    assert row["tag_precision"] == pytest.approx(1 / 5)


def test_first_pick_hit_uses_only_the_first_tag():
    records = [record(["a"], {"m": ["a", "x"]}), record(["a"], {"m": ["x", "a"]}), record(["a"], {"m": []})]
    assert r.arm_row(records, "m")["first_pick_hits"] == 1


# --- Hypotheses and the decision rule -----------------------------------------------------------


def clef_pair_records(n, wins, losses):
    """n valid observations; Clef both hits and one misses on `wins`, the reverse on `losses`."""
    out = []
    for i in range(n):
        one_hit, both_hit = (i >= wins and i < wins + losses), i < wins
        out.append(record(["v"], {"clef|one": ["v"] if one_hit else ["x"], "clef|both": ["v"] if both_hit else ["x"]}))
    return out


def test_h1_holds_at_a_gain_of_exactly_ten_points_with_a_small_p():
    result = r.judge_h1(clef_pair_records(100, 15, 5))
    assert (result["wins"], result["losses"]) == (15, 5)
    assert result["gain"] == pytest.approx(0.10) and result["p"] < 0.05
    assert result["holds"]


def test_h1_fails_below_ten_points_even_when_p_is_small():
    result = r.judge_h1(clef_pair_records(100, 12, 3))
    assert result["gain"] == pytest.approx(0.09) and result["p"] < 0.05 and not result["holds"]


def test_h1_fails_when_p_is_not_small_even_at_ten_points():
    result = r.judge_h1(clef_pair_records(100, 25, 15))
    assert result["gain"] == pytest.approx(0.10) and result["p"] >= 0.05 and not result["holds"]


def h2_records(n, hits_one, hits_both):
    return [record(["v"], {"clef|one": ["v"] if i < hits_one else ["x"], "clef|both": ["v"] if i < hits_both else ["x"]})
            for i in range(n)]


def test_h2_allows_a_loss_of_exactly_three_points():
    assert r.judge_h2(h2_records(100, 80, 77))["holds"]
    assert not r.judge_h2(h2_records(1000, 800, 769))["holds"]
    assert r.judge_h2(h2_records(1000, 800, 770))["holds"]


def test_h2_uses_only_observations_with_a_valid_label_in_their_own_section():
    own, other = h2_records(100, 80, 80), h2_records(100, 0, 0)
    for rec in other:
        rec["own_valid"] = False
    result = r.judge_h2(own + other)
    assert result["n"] == 100 and result["holds"]
    assert not r.judge_h2(other)["holds"]


def test_holm_correction_is_monotone_and_capped():
    assert r.holm([0.01, 0.02, 0.04]) == pytest.approx([0.03, 0.04, 0.04])
    assert r.holm([0.02, 0.021, 0.5]) == pytest.approx([0.06, 0.06, 0.5])
    assert r.holm([0.4, 0.9, 0.7]) == pytest.approx([1.0, 1.0, 1.0])
    assert r.holm([0.03, 0.001, 0.2]) == pytest.approx([0.06, 0.003, 0.2])


def test_h3_runs_three_tests_against_clef_and_marks_direction():
    arms = lambda c, k, p, m: {"clef|both": c, "cosine|both": k, "reranker|both": p, "combination|both": m}
    records = ([record(["v"], arms(["v"], ["x"], ["x"], ["v"])) for _ in range(40)]
               + [record(["v"], arms(["v"], ["v"], ["x"], ["v"])) for _ in range(10)])
    result = r.judge_h3(records)["tests"]
    assert set(result) == {"clef_vs_cosine", "clef_vs_reranker", "clef_vs_combination"}
    assert result["clef_vs_cosine"]["wins"] == 40 and result["clef_vs_cosine"]["direction"] == "clef better"
    assert result["clef_vs_cosine"]["significant"] and result["clef_vs_reranker"]["significant"]
    assert result["clef_vs_combination"]["direction"] == "tie" and not result["clef_vs_combination"]["significant"]


def test_section_setting_follows_h1_and_h2():
    hits = {s: {"cosine": 50, "reranker": 50, "clef": 90, "combination": 90} for s in r.SETTINGS}
    yes, no = {"holds": True}, {"holds": False}
    assert r.decide(yes, yes, hits, 100)["section_setting"] == "both"
    assert r.decide(yes, no, hits, 100)["section_setting"] == "operator decides"
    assert r.decide(yes, no, hits, 100)["method"] is None
    assert r.decide(no, yes, hits, 100)["section_setting"] == "one"
    assert r.decide(no, no, hits, 100)["section_setting"] == "one"
    assert r.decide(no, no, hits, 100)["method"] == "clef"


def test_a_cheaper_method_within_three_points_wins():
    pick = lambda **h: r.choose_method({"cosine": 0, "reranker": 0, "clef": 0, "combination": 0, **h}, 1000)
    assert pick(clef=800, combination=800) == "clef"
    assert pick(combination=800, clef=790) == "clef"
    assert pick(combination=800, clef=770) == "clef"
    assert pick(combination=800, clef=769) == "combination"
    assert pick(clef=800, reranker=770) == "reranker"
    assert pick(clef=800, reranker=769) == "clef"
    assert pick(clef=800, cosine=770, reranker=770) == "cosine"


def test_status_follows_gates_h1_and_h2():
    yes, no = {"holds": True}, {"holds": False}
    assert r.status_of(True, yes, yes) == "PASS"
    assert r.status_of(True, yes, no) == "MIXED"
    assert r.status_of(True, no, yes) == "FAIL"
    assert r.status_of(False, yes, yes) == "INCONCLUSIVE"


# --- Whole-summary behaviour --------------------------------------------------------------------


def full_record(valid, hit_tags, set_name="exp18", own_valid=True):
    arms = {f"{m}|{s}": list(hit_tags) for s in r.SETTINGS for m in r.METHODS}
    rec = record(valid, arms, own_valid=own_valid, set_name=set_name)
    rec["ok"] = {a: True for a in arms}
    return rec


def test_summary_counts_and_flags_a_failed_answer_through_g4():
    records = [full_record(["a"], ["a"]), full_record(["a"], ["x"], own_valid=False), full_record([], ["x"], "exp20")]
    gates = {"G2_baseline_match": {"pass": True}, "G3_fit": {"pass": True}}
    summary = r.summarise(records, gates)
    assert summary["counts"]["with_valid_label"] == 2 and summary["counts"]["valid_only_in_other_section"] == 1
    assert summary["counts"]["no_valid_label"] == 1
    assert summary["gates"]["G4_completeness"]["pass"] and summary["status"] != "INCONCLUSIVE"
    records[0]["ok"]["clef|both"] = False
    assert not r.summarise(records, gates)["gates"]["G4_completeness"]["pass"]
    assert r.summarise(records, gates)["status"] == "INCONCLUSIVE"


def test_a_changed_request_is_counted_as_a_mismatch():
    request = {"a|1": {"one": {"clef": {"q": 1}, "reranker": {"r": 1}}}}
    good = {"clef_one": {"a|1": {"request_sha256": r.digest({"q": 1})}}}
    assert r.count_mismatches(request, good)["clef_one"] == {"checked": 1, "mismatched": 0}
    bad = {"clef_one": {"a|1": {"request_sha256": r.digest({"q": 2})}}}
    assert r.count_mismatches(request, bad)["clef_one"]["mismatched"] == 1


def test_least_squares_recovers_a_known_line():
    x = [[1.0, float(t), float(t % 3)] for t in range(20)]
    y = [5.0 + 2.0 * row[1] + 3.0 * row[2] for row in x]
    assert r.least_squares(x, y) == pytest.approx([5.0, 2.0, 3.0], abs=1e-6)
