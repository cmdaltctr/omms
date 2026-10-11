"""Focused checks for the frozen Quick experiment contract."""

import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location("experiment05", Path(__file__).with_name("run_eval.py"))
r = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(r)


def fixture(n=140, correct=19, wrong=0):
    cases = [{"id": str(i), "expected": ["a" if i < correct else "none_fit"]} for i in range(n)]
    rows = {c["id"]: {"case_id": c["id"], "status": "ok",
            "choice": "a" if i < correct+wrong else "none_fit", "duration_seconds": i+1}
            for i, c in enumerate(cases)}
    return cases, rows


class RunnerTests(unittest.TestCase):
    def test_frozen_inputs(self):
        cases, candidates, labels, clef, preserved = r.load_inputs()
        self.assertEqual((len(cases), len(clef), preserved["original_files"]), (140, 140, 97))
        self.assertEqual(r.metrics(cases, clef)["wrong_existing"], 69)
        bad = dict(r.PINS, **{"corpus/catalogue.json": "bad"})
        with self.assertRaisesRegex(ValueError, "input_hash_drift"):
            r.load_inputs(pins=bad)
        with self.assertRaisesRegex(ValueError, "manifest_drift"):
            r.load_inputs(manifest_hash="bad")

    def test_prompt_and_no_reference_leak(self):
        case = {"description": "text", "section": "preferences", "expected": ["SECRET_REFERENCE"],
                "reason": "SECRET_REASON", "group": "SECRET_GROUP"}
        p = r.payload(case, ["b", "a", "none_fit"], {"a": {"definition": "A"}, "b": {"definition": "B"}})
        self.assertNotIn("SECRET", json.dumps(p))
        self.assertEqual(p["messages"][0]["content"], r.QUESTION +
                         " Return JSON only, with one field named choice containing a candidate ID.")
        self.assertEqual(list(json.loads(p["messages"][1]["content"])["options"]), ["b", "a", "none_fit"])
        self.assertEqual(p["chat_template_kwargs"], {"enable_thinking": False})
        self.assertEqual((p["temperature"], p["seed"], p["max_tokens"]), (0, 20261010, 128))
        self.assertFalse(p["response_format"]["json_schema"]["schema"]["additionalProperties"])

    def test_reply_contract(self):
        response = {"model": r.ALIAS, "choices": [{"finish_reason": "stop",
                    "message": {"content": '{"choice":"a"}'}}]}
        self.assertEqual(r.parse_answer(response, ["a", "none_fit"]), "a")
        for content in ['{"choice":"x"}', '{"choice":"a","extra":1}',
                        '{"choice":"a","choice":"none_fit"}', 'NaN', '[]']:
            bad = copy.deepcopy(response)
            bad["choices"][0]["message"]["content"] = content
            with self.assertRaises(ValueError):
                r.parse_answer(bad, ["a", "none_fit"])
        for key, value in [("finish_reason", "length"), ("model", "other")]:
            bad = copy.deepcopy(response)
            (bad if key == "model" else bad["choices"][0])[key] = value
            with self.assertRaises(ValueError):
                r.parse_answer(bad, ["a"])
        response["choices"][0]["message"]["reasoning_content"] = "thinking"
        with self.assertRaisesRegex(ValueError, "thinking_not_disabled"):
            r.parse_answer(response, ["a"])

    def test_gates_and_errors(self):
        cases, rows = fixture()
        self.assertEqual(r.metrics(cases, rows)["functional_result"], "PASS")
        for correct, wrong in [(18, 0), (49, 1), (0, 0)]:
            cases, rows = fixture(correct=correct, wrong=wrong)
            self.assertEqual(r.metrics(cases, rows)["functional_result"], "FAIL")
        cases, rows = fixture(correct=50, wrong=1)
        self.assertTrue(r.metrics(cases, rows)["gates"]["wrong_reuse_below_2_percent"])
        rows["139"] = {"status": "error", "duration_seconds": 1}
        result = r.metrics(cases, rows)
        self.assertEqual(result["correct_none_fit"], 88)
        self.assertEqual(result["errors_or_missing"], 1)
        self.assertEqual(result["functional_result"], "FAIL")
        cases, rows = fixture(correct=0)
        self.assertIsNone(r.metrics(cases, rows)["wrong_reuse"])

    def test_latency(self):
        cases, rows = fixture()
        result = r.metrics(cases, rows)
        self.assertEqual((result["mean_seconds"], result["p95_seconds"], result["total_request_seconds"]),
                         (70.5, 133, 9870))
        rows["0"]["duration_seconds"] = float("nan")
        with self.assertRaisesRegex(ValueError, "invalid_latency"):
            r.metrics(cases, rows)

    def test_atomic_interruption(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as folder:
            path = Path(folder) / "checkpoint.json"
            r.atomic_json(path, {"previous": 1})
            with patch.object(Path, "replace", side_effect=OSError("interrupted")):
                with self.assertRaises(OSError):
                    r.atomic_json(path, {"next": 2})
            self.assertEqual(r.read_json(path), {"previous": 1})
            r.atomic_json(path, {"next": 2})
            self.assertEqual(r.read_json(path), {"next": 2})

    def test_resume_no_automatic_retry(self):
        cases = [{"id": "a", "description": "data", "section": "preferences", "expected": ["none_fit"]}]
        candidates = {"a": {"ids": ["none_fit"]}}
        saved = {"manifest_digest": "pin", "records": {"a": {"case_id": "a", "status": "error"}}}
        r.validate_saved(saved, "pin", cases, candidates)
        with patch.object(r, "http", side_effect=AssertionError("unexpected HTTP")):
            r.checkpoint_cases(cases, candidates, {}, saved, lambda x: self.fail("unexpected write"), 1)
        with self.assertRaisesRegex(ValueError, "resume_fingerprint_mismatch"):
            r.validate_saved(saved, "changed", cases, candidates)
        saved["records"]["a"] = {"case_id": "a", "status": "ok", "choice": "unknown"}
        with self.assertRaisesRegex(ValueError, "invalid_saved_choice"):
            r.validate_saved(saved, "pin", cases, candidates)

    def test_http_and_private_boundaries(self):
        with self.assertRaisesRegex(ValueError, "endpoint_refused"):
            r.http("https://external.invalid")
        with self.assertRaisesRegex(ValueError, "redirect_refused"):
            r.NoRedirect().redirect_request(None, None, 302, "", {}, "https://external.invalid")
        self.assertEqual(r.private_safe("public <private>hidden</private> tail"), "public [REDACTED] tail")
        for text in ["<private>unclosed", "sk-" + "x"*20]:
            with self.assertRaises(ValueError):
                r.private_safe(text)

    def test_error_metadata(self):
        with patch.object(r, "http", side_effect=OSError("SECRET_REPLY")):
            row = r.infer({}, ["none_fit"])
        self.assertEqual(row["status"], "error")
        self.assertNotIn("SECRET", json.dumps(row))
        self.assertNotIn("choice", row)

    def test_read_only_verification(self):
        cases, candidates, labels, clef, preserved = r.load_inputs()
        manifest = {"test": 1}
        saved = {"manifest_digest": r.digest(manifest), "records": clef, "sessions": []}
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as folder:
            here = Path(folder)
            out = here / "output"
            out.mkdir()
            for name, data in [("run-manifest", manifest), ("eval_results", saved),
                               ("summary", r.summarise(cases, clef, saved)),
                               ("verification", {"cases": 140, "preservation": preserved,
                                                 "manifest_digest": r.digest(manifest)})]:
                r.atomic_json(out / (name + ".json"), data)
            before = {p.name: p.read_bytes() for p in out.iterdir()}
            with patch.object(r, "HERE", here), patch.object(r, "manifest_for", return_value=manifest), \
                 patch.object(r, "http", side_effect=AssertionError("HTTP in verification")), \
                 patch.object(r, "atomic_json", side_effect=AssertionError("write in verification")), \
                 patch.object(r.OwnedServer, "__enter__", side_effect=AssertionError("server in verification")):
                r.execute(verify=True)
            self.assertEqual(before, {p.name: p.read_bytes() for p in out.iterdir()})


if __name__ == "__main__":
    unittest.main()
