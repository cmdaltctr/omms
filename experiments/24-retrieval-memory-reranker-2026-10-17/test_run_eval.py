import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import run_eval as r  # noqa: E402


def test_hybrid_score_matches_production_weights():
    assert r.hybrid_score(1.0, 0.0, 0.0) == 0.6
    assert r.hybrid_score(0.0, 0.2, 1.0) == 0.4  # boost beats low tag similarity


def test_match_boost_counts_words_in_tags():
    assert r.match_boost("fix the retrieval bug", "retrieval, tests") == 0.25
    assert r.match_boost("a b", "x") == 0.0  # one-letter words ignored


def test_match_boost_empty_tag_matches_every_word_like_production():
    assert r.match_boost("alpha beta", "") == 1.0


def test_rank_candidates_breaks_ties_by_id():
    scores = [{"id": "b", "score": 0.5}, {"id": "a", "score": 0.5}, {"id": "c", "score": 0.9}]
    assert [s["id"] for s in r.rank_candidates(scores, 2)] == ["c", "a"]


def test_recall_and_precision():
    assert r.recall_at_k(["a", "b"], {"a", "c"}) == 0.5
    assert r.recall_at_k(["a"], set()) is None
    assert r.precision_at_k(["a", "b"], {"a"}) == 0.5
    assert r.precision_at_k([], {"a"}) is None


def test_cosine_clamps_and_handles_zero():
    assert r.cosine_similarity([1.0, 0.0], [1.0, 0.0]) == 1.0
    assert r.cosine_similarity([1.0, 0.0], [-1.0, 0.0]) == 0.0
    assert r.cosine_similarity([0.0, 0.0], [1.0, 0.0]) == 0.0


def test_redact_removes_key_like_strings():
    assert "sk-" not in r.redact("token sk-abcdefghijklmnop1234 end")
