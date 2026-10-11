"""Focused contract tests, also runnable against disposable fault copies."""

import copy
import os
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
r = types.ModuleType("experiment06")
r.__file__ = str(HERE / "run_eval.py")
source = Path(os.environ.get("EXPERIMENT06_FAULT_COPY", r.__file__)).read_text()
exec(compile(source, r.__file__, "exec"), r.__dict__)


def fixture(correct=19, wrong=0):
    cases = [{"id": str(i), "expected": ["a" if i < correct else "none_fit"]} for i in range(140)]
    rows = {c["id"]: {"case_id": c["id"], "status": "ok", "choice": "a" if i < correct + wrong else "none_fit"}
            for i, c in enumerate(cases)}
    return cases, rows


class RunnerTests(unittest.TestCase):
    def test_pins(self):
        cases, candidates, labels, baseline, _ = r.load_inputs()
        self.assertEqual((len(cases), len(baseline)), (140, 140))
        self.assertEqual((r.metrics(cases, baseline)["correct_existing"], r.metrics(cases, baseline)["wrong_existing"]), (21, 44))
        with tempfile.TemporaryDirectory(dir=HERE) as folder:
            path = Path(folder) / "input.json"
            path.write_text("original")
            pins = {path.name: r.file_hash(path)}
            r.check_pins(path.parent, pins)
            path.write_text("changed")
            with self.assertRaisesRegex(ValueError, "input_hash_drift"):
                r.check_pins(path.parent, pins)

    def test_id_join(self):
        cases, rows = fixture()
        candidates = {c["id"]: {"ids": ["a", "none_fit"]} for c in cases}
        saved = {"manifest_digest": "pin", "records": rows}
        self.assertEqual(r.validate_baseline(cases, candidates, saved), rows)
        rows["0"]["case_id"] = "1"
        with self.assertRaisesRegex(ValueError, "invalid_saved_record"):
            r.validate_baseline(cases, candidates, saved)

    def test_candidates_and_prompt(self):
        cases, candidates, labels, _, _ = r.load_inputs()
        requests = r.validate_requests(cases, candidates, labels)
        self.assertEqual(len(requests), 140)
        for case, request in zip(cases, requests):
            old = r.b.payload(case, candidates[case["id"]]["ids"], labels)
            self.assertEqual(request["messages"][1], old["messages"][1])
            self.assertEqual(request["response_format"], old["response_format"])
            self.assertEqual(request["messages"][0]["content"], r.SYSTEM)
        bad = copy.deepcopy(requests[0])
        bad["response_format"]["json_schema"]["schema"]["properties"]["choice"]["enum"].reverse()
        with patch.object(r, "payload", return_value=bad):
            with self.assertRaisesRegex(ValueError, "request_variant"):
                r.validate_requests(cases[:1], candidates, labels)
        bad = copy.deepcopy(requests[0])
        bad["messages"][0]["content"] += " Extra example."
        with patch.object(r, "payload", return_value=bad):
            with self.assertRaisesRegex(ValueError, "request_variant"):
                r.validate_requests(cases[:1], candidates, labels)

    def test_reply(self):
        response = {"model": r.b.ALIAS, "choices": [{"finish_reason": "stop", "message": {"content": '{"choice":"a"}'}}]}
        self.assertEqual(r.parse_answer(response, ["a", "none_fit"]), "a")
        for content in ['{"choice":"x"}', '{"choice":"a","choice":"none_fit"}', '{"choice":"a","extra":1}', '[]', 'NaN']:
            bad = copy.deepcopy(response)
            bad["choices"][0]["message"]["content"] = content
            with self.assertRaises(ValueError):
                r.parse_answer(bad, ["a", "none_fit"])
        for field, value in (("finish_reason", "length"), ("model", "wrong")):
            bad = copy.deepcopy(response)
            (bad if field == "model" else bad["choices"][0])[field] = value
            with self.assertRaises(ValueError):
                r.parse_answer(bad, ["a"])
        response["choices"][0]["message"]["reasoning_content"] = "unwanted"
        with self.assertRaises(ValueError):
            r.parse_answer(response, ["a"])

    def test_exact_gates_and_errors(self):
        for correct, wrong, verdict in ((19, 0, "PASS"), (18, 0, "FAIL"), (49, 1, "FAIL"), (50, 1, "PASS"), (0, 0, "FAIL")):
            cases, rows = fixture(correct, wrong)
            self.assertEqual(r.metrics(cases, rows)["functional_result"], verdict)
        cases, rows = fixture()
        rows["139"] = {"case_id": "139", "status": "error"}
        result = r.metrics(cases, rows)
        self.assertEqual((result["n"], result["errors_or_missing"], result["correct_none_fit"], result["functional_result"]), (140, 1, 120, "FAIL"))
        del rows["139"]
        self.assertEqual(r.metrics(cases, rows)["functional_result"], "INCONCLUSIVE")

    def test_subgroups_and_pairs(self):
        cases, candidates, labels, baseline, _ = r.load_inputs()
        saved = {"records": baseline, "sessions": [], "manifest_digest": "pin"}
        result = r.summarise(cases, baseline, saved)
        self.assertEqual((result["paired"]["wins"], result["paired"]["losses"], result["paired"]["ties"]), (0, 0, 140))
        self.assertEqual(result["paired"]["baseline_correct_existing_intersection"], 21)
        self.assertEqual([result["subgroups"][g]["baseline"]["n"] for g in ("omitted_candidates", "other_cases", "ambiguous_boundaries")], [3, 137, 3])
        self.assertEqual(result["baseline"]["n"], 140)
        self.assertEqual(len(result["diagnostic_cases"]), 6)

    def test_resume(self):
        cases, rows = fixture()
        candidates = {c["id"]: {"ids": ["a", "none_fit"]} for c in cases}
        rows["0"] = {"case_id": "0", "status": "error"}
        saved = {"records": rows, "manifest_digest": "pin"}
        r.validate_saved(saved, "pin", cases, candidates)
        with self.assertRaisesRegex(ValueError, "resume_fingerprint_mismatch"):
            r.validate_saved(saved, "changed", cases, candidates)
        with patch.object(r.b, "http", side_effect=AssertionError("unexpected HTTP")):
            r.checkpoint_cases(cases, candidates, {}, saved, lambda _: self.fail("unexpected checkpoint"), 1)

    def test_checkpoint_and_error_metadata(self):
        cases = [{"id": "a", "description": "data", "section": "preferences", "expected": ["none_fit"]}]
        saved = {"records": {}}
        def http(path, value=None):
            if path == "/apply-template":
                return {"prompt": "synthetic"}
            if path == "/tokenize":
                return {"tokens": [1]}
            raise OSError("SECRET_REPLY")
        writes = []
        with patch.object(r.b, "http", side_effect=http), patch.object(r.b, "rss", return_value=1):
            r.checkpoint_cases(cases, {"a": {"ids": ["none_fit"]}}, {}, saved, lambda data: writes.append(copy.deepcopy(data)), 1)
        self.assertEqual(len(writes), 1)
        self.assertEqual(writes[0]["records"]["a"]["status"], "error")
        self.assertNotIn("SECRET", str(writes))
        self.assertNotIn("choice", writes[0]["records"]["a"])
        with tempfile.TemporaryDirectory(dir=HERE) as folder:
            path = Path(folder) / "checkpoint.json"
            r.b.atomic_json(path, {"old": 1})
            with patch.object(Path, "replace", side_effect=OSError("interrupted")):
                with self.assertRaises(OSError):
                    r.b.atomic_json(path, {"new": 1})
            self.assertEqual(r.b.read_json(path), {"old": 1})

    def test_preservation(self):
        hashes = r.earlier_hashes()
        self.assertGreater(len(hashes), 97)
        self.assertEqual(hashes["05-retrieval-qwen-label-decisions-2026-10-10/run_eval.py"], r.BASE_PINS["run_eval.py"])
        self.assertFalse(any(name.startswith("06-") or name.startswith("07-") for name in hashes))

    def test_read_only_verify(self):
        cases, candidates, labels, baseline, preserved = r.load_inputs()
        manifest = {"earlier_file_sha256": {"pinned": "hash"}}
        saved = {"records": baseline, "sessions": [], "manifest_digest": r.b.digest(manifest)}
        with tempfile.TemporaryDirectory(dir=HERE) as folder:
            root = Path(folder)
            out = root / "output"
            out.mkdir()
            for name, value in (("run-manifest", manifest), ("eval_results", saved),
                                ("summary", r.summarise(cases, baseline, saved)),
                                ("verification", {"cases": 140, "manifest_digest": r.b.digest(manifest), "earlier_file_sha256": manifest["earlier_file_sha256"]})):
                r.b.atomic_json(out / (name + ".json"), value)
            before = {p.name: p.read_bytes() for p in out.iterdir()}
            with patch.object(r, "HERE", root), patch.object(r, "manifest_for", return_value=manifest), \
                 patch.object(r.b, "http", side_effect=AssertionError("HTTP during verify")), \
                 patch.object(r.b, "atomic_json", side_effect=AssertionError("write during verify")), \
                 patch.object(r.OwnedServer, "__enter__", side_effect=AssertionError("server during verify")):
                r.execute(verify=True)
            self.assertEqual(before, {p.name: p.read_bytes() for p in out.iterdir()})


if __name__ == "__main__":
    unittest.main()
