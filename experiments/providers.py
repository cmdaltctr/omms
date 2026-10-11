"""Experiment-only provider contracts. Production services are never imported."""

import json
import math
import os
import time
from http.client import IncompleteRead
from urllib.error import HTTPError, URLError
from urllib.request import HTTPRedirectHandler, Request, build_opener

from manifest import spending_fingerprint, validate
from safety import require_redacted


SOURCE_COMMIT = "89797366de144e51842b6cc373d1604edc50fff7"
DEEPSEEK_MODEL = "deepseek-flash"
DEEPSEEK_URL = "https://api.deepseek.com/chat/completions"
JEV_MODEL = "jev-1.13.0"
JEV_URL = "https://api.typesafe.ai/v1/systemone"
JEV_INPUT_USD_PER_TOKEN = 0.042 / 1_000_000

SYSTEMS = {
    "duplicate": "You are a semantic duplicate detector. Output valid JSON.",
    "conflict": "You are a preference contradiction detector. Output valid JSON.",
}
QUESTIONS = {
    "duplicate": "Do these two descriptions refer to the same user behavior, preference, or pattern? Answer only whether they are semantically equivalent (same meaning, different wording).",
    "conflict": "Are these two user preferences contradictory (opposing, incompatible)?",
}


def deepseek_payload(decision, a, b):
    """Copy the exact external production request from the pinned source."""
    require_redacted(a)
    require_redacted(b)
    prompt = QUESTIONS[decision] + f'\n\nA: "{a}"\nB: "{b}"\n\nAnswer JSON only: {{ "{decision}": true|false, "reason": "one sentence explanation" }}'
    return {"model": DEEPSEEK_MODEL, "messages": [{"role": "system", "content": SYSTEMS[decision]}, {"role": "user", "content": prompt}], "temperature": 0, "response_format": {"type": "json_object"}}


def parse_deepseek(data, decision, model):
    """Accept only a Boolean decision, without promoting a score to probability."""
    if data.get("model") != model:
        raise ValueError("returned model differs from pin")
    content = data["choices"][0]["message"]["content"]
    try:
        parsed = json.loads(content)
    except json.JSONDecodeError:
        if decision != "conflict":
            raise
        # Match the production conflict parser's Chinese quote repair.
        import re
        content = re.sub(r'([\u4e00-\u9fff\u3000-\u303f\uff00-\uffef])"([\u4e00-\u9fff\u3000-\u303f\uff00-\uffef])', r'\1\\"\2', content)
        content = re.sub(r'([\u4e00-\u9fff\u3000-\u303f\uff00-\uffef])"(?=\s*[,}\]])', r'\1\\"', content)
        parsed = json.loads(content)
    if type(parsed.get(decision)) is not bool:
        raise ValueError("Boolean decision required")
    score = parsed.get("score")
    if score is not None and (type(score) not in (int, float) or not math.isfinite(score)):
        raise ValueError("invalid provider score")
    return {"answer": parsed[decision], "probability": None, "provider_score": score, "returned_model": data["model"], "usage": data.get("usage", {})}


def jev_payload(state, question, *, kind, candidates=None):
    """Build one typed question over approved, redacted state."""
    require_redacted(json.dumps(state))
    require_redacted(question)
    if kind not in ("noul", "choice"):
        raise ValueError("unsupported Jev question")
    item = {"type": kind, "instructions": question}
    if kind == "choice":
        if not isinstance(candidates, dict) or not 2 <= len(candidates) <= 255:
            raise ValueError("Choice candidate IDs required")
        item["criteria"] = candidates
    return {"model": JEV_MODEL, "state": state, "questions": {"decision": item}}


def probability(value):
    """Validate a finite probability, rejecting Boolean and string values."""
    if type(value) not in (int, float) or not math.isfinite(value) or not 0 <= value <= 1:
        raise ValueError("invalid probability")
    return value


def parse_jev(data, payload):
    """Keep Noul probabilities and Choice confidence in separate fields."""
    if data.get("model") != payload["model"]:
        raise ValueError("returned model differs from pin")
    usage = data["usage"]
    if any(type(usage.get(key)) is not int or usage[key] < 0 for key in ("input_tokens", "output_tokens")):
        raise ValueError("invalid token usage")
    answer = data["answers"]["decision"]
    question = payload["questions"]["decision"]
    if answer["type"] != question["type"]:
        raise ValueError("wrong answer type")
    result = {"returned_model": data["model"], "usage": usage, "usage_cost_usd": usage["input_tokens"] * JEV_INPUT_USD_PER_TOKEN, "provider_confidence": None}
    if question["type"] == "noul":
        result["probability"] = probability(answer["noul"])
        return result
    candidates = question["criteria"]
    if answer["choice"] not in candidates or set(answer["probabilities"]) != set(candidates):
        raise ValueError("unexpected candidate ID")
    distribution = {key: probability(value) for key, value in answer["probabilities"].items()}
    if not math.isclose(sum(distribution.values()), 1.0, abs_tol=1e-6):
        raise ValueError("invalid probability distribution")
    result.update(choice=answer["choice"], probabilities=distribution, provider_confidence=probability(answer["confidence"]))
    return result


class NoRedirect(HTTPRedirectHandler):
    """Keep credentials and approved data on the pinned endpoint."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def http_json(url, payload, credential_env):
    """Send one request with a 30-second timeout and no implicit retry."""
    if url not in (DEEPSEEK_URL, JEV_URL):
        raise ValueError("unapproved endpoint")
    credential = os.environ.get(credential_env)
    if not credential:
        raise ValueError("credential unavailable")
    request = Request(url, data=json.dumps(payload).encode(), headers={"Authorization": "Bearer " + credential, "Content-Type": "application/json"}, method="POST")
    with build_opener(NoRedirect()).open(request, timeout=30) as response:
        try:
            return json.load(response)
        except IncompleteRead:
            raise URLError("incomplete-response") from None


def guarded_call(value, root, arm, transport, parser):
    """Validate before external I/O, retaining metadata-only failures."""
    validate(value, root, hosted_arms=[arm])
    start = time.monotonic()
    try:
        result = {"status": "ok", **parser(transport())}
    except HTTPError as error:
        result = {"status": "error", "code": "rate-limit" if error.code in (429, 529) else "http-error", "http_status": error.code}
    except TimeoutError:
        result = {"status": "error", "code": "timeout"}
    except URLError as error:
        result = {"status": "error", "code": "timeout" if isinstance(error.reason, TimeoutError) else "transport-error"}
    except (ValueError, KeyError, IndexError, TypeError):
        result = {"status": "error", "code": "invalid-answer"}
    result["duration_seconds"] = time.monotonic() - start
    return result


def run_jev(value, root, payload, budget):
    """Reserve the full context ceiling before one approved Jev request."""
    fingerprint = spending_fingerprint(value, root, hosted_arms=["P2"])
    if budget.state["fingerprint"] != fingerprint or budget.state["limit"] != value["approvals"]["spend_usd"]:
        raise ValueError("budget differs from approved manifest")
    if payload["model"] != value["models"]["P2"]["model"] or payload["model"] != JEV_MODEL:
        raise ValueError("Jev model differs from approved pin")
    ticket = budget.reserve(65536 * JEV_INPUT_USD_PER_TOKEN)
    result = guarded_call(value, root, "P2", lambda: http_json(JEV_URL, payload, "TYPESAFE_API_KEY"), lambda data: parse_jev(data, payload))
    if result["status"] == "ok":
        budget.settle(ticket, result["usage_cost_usd"])
    result["spending_ticket"] = ticket
    return result
