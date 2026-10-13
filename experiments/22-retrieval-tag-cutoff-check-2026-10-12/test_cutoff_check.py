import cutoff_check as cc

PROBS = {"none_fit": 0.25, "a": 0.40, "b": 0.20, "c": 0.09, "d": 0.06}


def test_tags_take_top_three_without_none_fit():
    assert cc.tags(PROBS, "baseline", None) == ["a", "b", "c"]


def test_label_cutoff_drops_low_labels():
    assert cc.tags(PROBS, "label_cutoff", 0.10) == ["a", "b"]


def test_nofit_block_tags_nothing_above_value():
    assert cc.tags(PROBS, "nofit_block", 0.20) == []
    assert cc.tags(PROBS, "nofit_block", 0.30) == ["a", "b", "c"]


def test_score_multi_counts_hits_and_wrong_tags():
    raw = {"x": {"probabilities": PROBS}, "y": {"probabilities": PROBS}}
    key = {"x": ["b", "z"], "y": []}
    s = cc.score_multi(raw, key, "baseline", None)
    assert (s["hits"], s["items_with_valid_label"], s["tags"], s["wrong_tags"]) == (1, 1, 6, 5)


def test_passes_needs_both_conditions():
    base = {"wrong_tags": 10, "hit_rate": 0.90}
    assert cc.passes(base, {"wrong_tags": 7, "hit_rate": 0.87})
    assert not cc.passes(base, {"wrong_tags": 8, "hit_rate": 0.90})
    assert not cc.passes(base, {"wrong_tags": 5, "hit_rate": 0.86})


def test_choose_prefers_fewest_tags():
    results = {
        "baseline": {"wrong_tags": 10, "hit_rate": 0.9, "tags": 30},
        "r1": {"wrong_tags": 6, "hit_rate": 0.9, "tags": 25},
        "r2": {"wrong_tags": 5, "hit_rate": 0.88, "tags": 20},
    }
    assert cc.choose(results) == "r2"
