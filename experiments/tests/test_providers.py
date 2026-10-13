"""Test provider contracts without hosted calls or real credentials."""

import importlib
import json
import sys
from urllib.error import HTTPError
from pathlib import Path

import pytest
from test_manifest import manifest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def module():
    assert (Path(__file__).resolve().parents[1] / "providers.py").is_file(), "Provider adapter required"
    return importlib.import_module("providers")


def test_production_prompt_and_parameters():
    payload = module().deepseek_payload("duplicate", "A text", "B text")
    assert payload["model"] == "deepseek-flash"
    assert payload["temperature"] == 0
    assert payload["response_format"] == {"type": "json_object"}
    assert payload["messages"][0]["content"] == "You are a semantic duplicate detector. Output valid JSON."
    assert payload["messages"][1]["content"] == 'Do these two descriptions refer to the same user behavior, preference, or pattern? Answer only whether they are semantically equivalent (same meaning, different wording).\n\nA: "A text"\nB: "B text"\n\nAnswer JSON only: { "duplicate": true|false, "reason": "one sentence explanation" }'
    conflict = module().deepseek_payload("conflict", "A text", "B text")
    assert conflict["messages"][0]["content"] == "You are a preference contradiction detector. Output valid JSON."
    assert conflict["messages"][1]["content"].startswith("Are these two user preferences contradictory (opposing, incompatible)?")


def test_deepseek_scores_are_not_probabilities():
    data = {"model": "deepseek-flash", "choices": [{"message": {"content": json.dumps({"duplicate": False, "score": 0.7})}}]}
    result = module().parse_deepseek(data, "duplicate", "deepseek-flash")
    assert result["answer"] is False
    assert result["provider_score"] == 0.7
    assert result["probability"] is None
    assert "reason" not in result


@pytest.mark.parametrize("answer", ["yes", 1, None, {}, []])
def test_invalid_deepseek_answer_refused(answer):
    data = {"model": "deepseek-flash", "choices": [{"message": {"content": json.dumps({"duplicate": answer})}}]}
    with pytest.raises(ValueError):
        module().parse_deepseek(data, "duplicate", "deepseek-flash")


def test_jev_noul_and_choice_contracts():
    payload = module().jev_payload({"A": "one", "B": "two"}, "same meaning?", kind="noul")
    assert payload["model"] == "jev-1.13.0"
    assert payload["questions"]["decision"]["type"] == "noul"
    result = module().parse_jev({"model": "jev-1.13.0", "answers": {"decision": {"type": "noul", "noul": 0.9}}, "usage": {"input_tokens": 300, "output_tokens": 10}}, payload)
    assert result["probability"] == 0.9
    assert result["provider_confidence"] is None
    choice = module().jev_payload("synthetic", "choose", kind="choice", candidates={"a": None, "b": None})
    parsed = module().parse_jev({"model": "jev-1.13.0", "answers": {"decision": {"type": "choice", "choice": "a", "confidence": 0.8, "probabilities": {"a": 0.9, "b": 0.1}}}, "usage": {"input_tokens": 300, "output_tokens": 10}}, choice)
    assert parsed["choice"] == "a"
    assert parsed["provider_confidence"] == 0.8
    assert parsed["probabilities"] == {"a": 0.9, "b": 0.1}


@pytest.mark.parametrize("probability", [-0.1, 1.1, float("nan"), float("inf"), True, "0.9"])
def test_invalid_jev_probability_refused(probability):
    payload = module().jev_payload("synthetic", "question", kind="noul")
    with pytest.raises(ValueError):
        module().parse_jev({"model": "jev-1.13.0", "answers": {"decision": {"type": "noul", "noul": probability}}, "usage": {"input_tokens": 1, "output_tokens": 1}}, payload)


def test_jev_wrong_model_and_choice_refused():
    payload = module().jev_payload("synthetic", "choose", kind="choice", candidates={"a": None, "b": None})
    data = {"model": "other", "answers": {"decision": {"type": "choice", "choice": "c", "confidence": 0.8, "probabilities": {"a": 0.9, "b": 0.1}}}, "usage": {"input_tokens": 1, "output_tokens": 1}}
    with pytest.raises(ValueError, match="model"):
        module().parse_jev(data, payload)
    data["model"] = "jev-1.13.0"
    with pytest.raises(ValueError, match="candidate"):
        module().parse_jev(data, payload)


@pytest.mark.parametrize("error,code", [(TimeoutError("secret"), "timeout"), (ValueError("secret"), "invalid-answer")])
def test_call_errors_are_metadata_only(manifest, error, code):
    value, root = manifest
    def transport():
        raise error
    result = module().guarded_call(value, root, "P1", transport, lambda data: data)
    assert result["status"] == "error"
    assert result["code"] == code
    assert "secret" not in json.dumps(result)


def test_unapproved_call_never_reaches_transport(manifest):
    value, root = manifest
    value["approvals"]["transfer"] = {}
    calls = []
    with pytest.raises(ValueError):
        module().guarded_call(value, root, "P1", lambda: calls.append(1), lambda data: data)
    assert calls == []


def test_rate_limit_remains_an_error_without_implicit_retry(manifest):
    value, root = manifest
    calls = []
    def transport():
        calls.append(1)
        raise HTTPError("https://synthetic", 429, "sk-" + "a" * 24, {}, None)
    result = module().guarded_call(value, root, "P1", transport, lambda data: data)
    assert calls == [1]
    assert result["code"] == "rate-limit"
    assert result["http_status"] == 429
    assert "sk-" not in json.dumps(result)


def test_jev_reserves_before_transport_and_records_usage(manifest, monkeypatch):
    value, root = manifest
    providers = module()
    assert hasattr(providers, "run_jev"), "Accounted Jev call required"
    from spending import Budget
    from manifest import spending_fingerprint
    value["models"]["P2"] = {"status": "ready", "provider": "typesafe", "model": "jev-1.13.0", "parameters": {}}
    value["approvals"]["transfer"]["P2"] = value["files"]["corpus"]["sha256"]
    budget = Budget(root / "spending.json", root, spending_fingerprint(value, root, hosted_arms=["P2"]), 0.01)
    def transport(url, payload, credential_env):
        assert budget.used > 0
        assert credential_env == "TYPESAFE_API_KEY"
        return {"model": "jev-1.13.0", "answers": {"decision": {"type": "noul", "noul": 0.9}}, "usage": {"input_tokens": 300, "output_tokens": 10}}
    monkeypatch.setattr(providers, "http_json", transport)
    payload = providers.jev_payload("synthetic", "question", kind="noul")
    result = providers.run_jev(value, root, payload, budget)
    assert result["status"] == "ok"
    assert budget.used == pytest.approx(300 * 0.042 / 1_000_000)


def test_jev_budget_must_match_approved_manifest(manifest, monkeypatch):
    value, root = manifest
    providers = module()
    from spending import Budget
    value["models"]["P2"] = {"status": "ready", "provider": "typesafe", "model": "jev-1.13.0", "parameters": {}}
    value["approvals"]["transfer"]["P2"] = value["files"]["corpus"]["sha256"]
    budget = Budget(root / "spending.json", root, "a" * 64, 1.0)
    calls = []
    def transport(*args):
        calls.append(1)
        return {"model": "jev-1.13.0", "answers": {"decision": {"type": "noul", "noul": 0.9}}, "usage": {"input_tokens": 300, "output_tokens": 10}}
    monkeypatch.setattr(providers, "http_json", transport)
    payload = providers.jev_payload("synthetic", "question", kind="noul")
    with pytest.raises(ValueError, match="budget"):
        providers.run_jev(value, root, payload, budget)
    assert calls == []


def test_jev_budget_is_shared_across_development_threshold_changes(manifest, monkeypatch):
    value, root = manifest
    providers = module()
    from spending import Budget
    from manifest import spending_fingerprint, digest
    value["models"]["P2"] = {"status": "ready", "provider": "typesafe", "model": "jev-1.13.0", "parameters": {}}
    value["approvals"]["transfer"]["P2"] = value["files"]["corpus"]["sha256"]
    budget = Budget(root / "spending.json", root, spending_fingerprint(value, root, hosted_arms=["P2"]), 0.01)
    monkeypatch.setattr(providers, "http_json", lambda *args: {"model": "jev-1.13.0", "answers": {"decision": {"type": "noul", "noul": 0.9}}, "usage": {"input_tokens": 300, "output_tokens": 10}})
    payload = providers.jev_payload("synthetic", "question", kind="noul")
    providers.run_jev(value, root, payload, budget)
    value["settings"]["threshold"] = 0.6
    value["settings_sha256"] = digest(value["settings"])
    result = providers.run_jev(value, root, payload, budget)
    assert result["status"] == "ok"
    assert budget.used == pytest.approx(600 * 0.042 / 1_000_000)
