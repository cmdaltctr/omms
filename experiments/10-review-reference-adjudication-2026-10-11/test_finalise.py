"""Focused contract tests, also runnable against disposable fault copies."""

import copy
import json
import os
import subprocess
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
r = types.ModuleType("experiment10")
r.__file__ = str(HERE / "finalise_reference.py")
source = Path(os.environ.get("EXPERIMENT10_FAULT_COPY", r.__file__)).read_text()
exec(compile(source, r.__file__, "exec"), r.__dict__)
page = types.ModuleType("experiment10page")
page.__file__ = str(HERE / "build_page.py")
page_source = Path(os.environ.get("EXPERIMENT10_PAGE_FAULT_COPY", page.__file__)).read_text()
exec(compile(page_source, page.__file__, "exec"), page.__dict__)


def decisions_fixture(cases, labels):
    """One decision per case: the AI expected label, plus three guaranteed edits."""
    answers = [{"key": case["id"], "label": case["expected"][0], "note": ""}
               for case in cases]
    answers[0]["label"] = "uncertain"
    answers[1]["label"] = "none_fit"
    wrong = next(l["id"] for l in labels.values()
                 if l["section"] == cases[2]["section"] and l["id"] != cases[2]["expected"][0])
    answers[2]["label"] = wrong
    return {"answers": answers}


class FinaliseTests(unittest.TestCase):

    def test_pins_and_inputs(self):
        cases, labels, saved = r.load_inputs()
        self.assertEqual((len(cases), len(labels), len(saved)), (140, 41, 140))
        with patch.dict(r.CORPUS_PINS, {"corpus/ground-truth.json": "0" * 64}):
            with self.assertRaisesRegex(ValueError, "input_hash_drift"):
                r.check_pins()
        r.check_pins()

    def test_decisions_validation(self):
        cases, labels, saved = r.load_inputs()
        payload = decisions_fixture(cases, labels)
        decisions = r.validate_decisions(cases, labels, payload)
        self.assertEqual(len(decisions), 140)
        self.assertEqual(decisions[cases[0]["id"]]["label"], "uncertain")
        for mutate in ("missing", "unknown", "cross_section", "null_label", "duplicate", "long_note"):
            bad = copy.deepcopy(payload)
            if mutate == "missing":
                bad["answers"] = bad["answers"][:-1]
            elif mutate == "unknown":
                bad["answers"][2]["key"] = "not-a-case"
            elif mutate == "cross_section":
                other = next(l["id"] for l in labels.values()
                             if l["section"] != cases[3]["section"])
                bad["answers"][3]["label"] = other
            elif mutate == "null_label":
                bad["answers"][4]["label"] = None
            elif mutate == "duplicate":
                bad["answers"][5]["key"] = bad["answers"][6]["key"]
            else:
                bad["answers"][7]["note"] = "x" * 501
            with self.assertRaisesRegex(ValueError, "decisions_incomplete|invalid_choice"
                                        "|decisions_shape|duplicate_case|invalid_note"):
                r.validate_decisions(cases, labels, bad)

    def test_agreement_math(self):
        cases, labels, saved = r.load_inputs()
        payload = decisions_fixture(cases, labels)
        decisions = r.validate_decisions(cases, labels, payload)
        result = r.agreement(cases, decisions)
        self.assertEqual((result["n"], result["uncertain"]), (140, 1))
        expected_disagree = sum(1 for c in cases if decisions[c["id"]]["label"] != "uncertain"
                                and decisions[c["id"]]["label"] not in c["expected"])
        self.assertGreaterEqual(expected_disagree, 1)
        self.assertEqual(result["disagree"], expected_disagree)
        self.assertEqual(result["agree"] + result["disagree"] + result["uncertain"], 140)
        self.assertEqual(len(result["special_cases"]), 6)

    def test_rescore(self):
        cases, labels, saved = r.load_inputs()
        payload = decisions_fixture(cases, labels)
        decisions = r.validate_decisions(cases, labels, payload)
        result = r.rescore(cases, saved, decisions)
        rated = [c for c in cases if decisions[c["id"]]["label"] != "uncertain"]
        expected_existing = sum(1 for c in rated if saved[c["id"]]["choice"] != "none_fit")
        expected_correct = sum(1 for c in rated if saved[c["id"]]["choice"] != "none_fit"
                               and saved[c["id"]]["choice"] == decisions[c["id"]]["label"])
        self.assertEqual(result["rated_cases"] + result["uncertain_excluded"], 140)
        self.assertEqual(result["uncertain_excluded"], 1)
        self.assertEqual((result["existing"], result["correct_existing"]),
                         (expected_existing, expected_correct))
        self.assertEqual(result["ai_reference_comparison"],
                         {"existing": 71, "correct_existing": 23, "wrong_existing": 48})
        self.assertFalse(result["wrong_reuse_below_2_percent"])
        perfect = copy.deepcopy(payload)
        for entry in perfect["answers"]:
            entry["label"] = saved[entry["key"]]["choice"]
        decisions2 = r.validate_decisions(cases, labels, perfect)
        result2 = r.rescore(cases, saved, decisions2)
        self.assertEqual((result2["correct_existing"], result2["wrong_existing"]), (71, 0))
        self.assertTrue(result2["wrong_reuse_below_2_percent"])

    def test_blindness(self):
        data = page.page_data()
        serialised = json.dumps(data)
        self.assertEqual(len(data), 140)
        for key in ("expected", "reference", "choice", "answer", "baseline", "classifier"):
            self.assertNotIn(f'"{key}"', serialised)
        for case in data:
            self.assertEqual(sorted(case.keys()), ["description", "id", "options", "section"])
        with tempfile.TemporaryDirectory(dir=HERE):
            faulty = page_source.replace(
                'blind.append({"id": case["id"], "description": case["description"],\n'
                '                      "section": case["section"], "options": options})',
                'blind.append({"id": case["id"], "description": case["description"],\n'
                '                      "section": case["section"], "options": options,\n'
                '                      "expected": case["expected"]})')
            self.assertNotEqual(faulty, page_source)
            broken = types.ModuleType("broken")
            broken.__file__ = str(HERE / "build_page.py")
            exec(compile(faulty, broken.__file__, "exec"), broken.__dict__)
            with self.assertRaisesRegex(ValueError, "blindness_leak"):
                broken.build()

    def test_draft_validation(self):
        data = page.page_data()
        with tempfile.TemporaryDirectory(dir=HERE) as folder:
            root = Path(folder)
            (root / "corpus").mkdir()
            with patch.object(page, "HERE", root):
                self.assertEqual(page.draft_data(data), {})
                target = root / "corpus/agent-draft-decisions.json"
                good = {"answers": [{"key": c["id"], "label": c["options"][0]["id"], "note": "n"}
                                    for c in data]}
                target.write_text(json.dumps(good))
                self.assertEqual(len(page.draft_data(data)), 140)
                bad = json.loads(json.dumps(good))
                bad["answers"][3]["label"] = "not_a_label"
                target.write_text(json.dumps(bad))
                with self.assertRaisesRegex(ValueError, "draft_invalid_choice"):
                    page.draft_data(data)
                bad = json.loads(json.dumps(good))
                bad["answers"] = bad["answers"][:-1]
                target.write_text(json.dumps(bad))
                with self.assertRaisesRegex(ValueError, "draft_shape"):
                    page.draft_data(data)
        real = page.draft_data(data)
        self.assertIn(len(real), (0, 140))

    def test_consensus(self):
        data = page.page_data()
        verdicts = {c["id"]: {"judge": c["options"][0]["id"], "agree": True} for c in data}
        first = data[0]["id"]
        verdicts[first] = {"judge": "none_fit", "agree": False}
        second = data[1]["id"]
        verdicts[second] = {"judge": "uncertain", "agree": False}
        draft = {c["id"]: {"label": c["options"][0]["id"], "note": ""} for c in data}
        responses = {first: {"final": "none_fit", "position": "concede", "note": ""},
                     second: {"final": draft[second]["label"], "position": "keep", "note": ""}}
        result = page.consensus(data, draft, verdicts, responses)
        self.assertEqual(result[first], {"label": "none_fit", "status": "settled"})
        self.assertEqual(result[second], {"label": draft[second]["label"], "status": "disputed"})
        self.assertEqual(result[data[2]["id"]], {"label": draft[data[2]["id"]]["label"],
                                                 "status": "agreed"})
        bad = dict(verdicts)
        bad[data[5]["id"]] = {"judge": "not_a_label", "agree": True}
        with self.assertRaisesRegex(ValueError, "verdicts_invalid_choice"):
            page.consensus(data, draft, bad, responses)
        missing = dict(verdicts)
        missing[data[7]["id"]] = {"judge": "none_fit", "agree": False}
        with self.assertRaisesRegex(ValueError, "missing_response_for_disputed_case"):
            page.consensus(data, draft, missing, responses)
        inconsistent = dict(verdicts)
        inconsistent[data[9]["id"]] = {"judge": "none_fit", "agree": True}
        with self.assertRaisesRegex(ValueError, "verdict_flag_inconsistent"):
            page.consensus(data, draft, inconsistent, responses)
        false_disagree = dict(verdicts)
        false_disagree[data[11]["id"]] = {"judge": draft[data[11]["id"]]["label"], "agree": False}
        with self.assertRaisesRegex(ValueError, "verdict_flag_inconsistent"):
            page.consensus(data, draft, false_disagree, responses)

    def test_verify_read_only(self):
        cases, labels, saved = r.load_inputs()
        payload = decisions_fixture(cases, labels)
        decisions = r.validate_decisions(cases, labels, payload)
        with tempfile.TemporaryDirectory(dir=HERE) as folder:
            root = Path(folder)
            (root / "corpus").mkdir()
            (root / "output").mkdir()
            (root / "corpus/adjudication-decisions.json").write_text(json.dumps(payload))
            real_draft = HERE / "corpus/agent-draft-decisions.json"
            if real_draft.exists():
                (root / "corpus/agent-draft-decisions.json").write_text(real_draft.read_text())
            for extra in ("agent-judge-verdicts.json", "agent-draft-response.json"):
                source = HERE / "corpus" / extra
                if source.exists():
                    (root / "corpus" / extra).write_text(source.read_text())
            manifest = r.manifest_for(root / "corpus/adjudication-decisions.json")
            reference = {"manifest_digest": r.b.digest(manifest), "decisions": decisions}
            summary = r.summarise(cases, labels, saved, decisions)
            summary["manifest_digest"] = r.b.digest(manifest)
            (root / "corpus/adjudicated-reference.json").write_text(json.dumps(reference))
            (root / "output/summary.json").write_text(json.dumps(summary))
            plan_pin = {"frozen": {"adjudication": {
                "reference_sha256": r.b.file_hash(root / "corpus/adjudicated-reference.json")}}}
            (root / "plan.json").write_text(json.dumps(plan_pin))
            before = {p.name: p.read_bytes() for p in root.rglob("*") if p.is_file()}
            with patch.object(r, "HERE", root), \
                 patch.object(r.b, "atomic_json", side_effect=AssertionError("write during verify")):
                r.execute(verify=True)
            self.assertEqual(before, {p.name: p.read_bytes() for p in root.rglob("*")
                                      if p.is_file()})
            tampered = json.loads(json.dumps(summary))
            tampered["agreement"]["disagree"] += 5
            (root / "output/summary.json").write_text(json.dumps(tampered))
            with patch.object(r, "HERE", root):
                with self.assertRaisesRegex(ValueError, "summary_mismatch"):
                    r.execute(verify=True)
            (root / "output/summary.json").write_text(json.dumps(summary))
            retampered = json.loads(json.dumps(reference))
            retampered["mode"] = "blind solo human adjudication"
            (root / "corpus/adjudicated-reference.json").write_text(json.dumps(retampered))
            with patch.object(r, "HERE", root):
                with self.assertRaisesRegex(ValueError, "reference_pin_mismatch"):
                    r.execute(verify=True)

    def test_page_confirm_script_has_no_undeclared_draft(self):
        page.build()
        html = (HERE / "output/adjudication.html").read_text()
        script = html.split("<script>", 1)[1].split("</script>", 1)[0]
        for pattern in ("(draft ?", "draft.label", ") || (draft", "draft,"):
            self.assertNotIn(pattern, script)
        self.assertIn("(DRAFT[c.id] ? DRAFT[c.id].label : null)", script)


FAULTS = [
    ("test_pins_and_inputs", "finalise",
     'b.require(b.file_hash(b.path_in(b.SOURCE, name)) == expected, "input_hash_drift")',
     "pass  # fault: accept any input hash"),
    ("test_decisions_validation", "finalise",
     'b.require(set(by_key) == {c["id"] for c in cases}, "decisions_incomplete")',
     "pass  # fault: accept incomplete decisions"),
    ("test_decisions_validation", "finalise",
     'b.require(isinstance(label, str) and label in valid_choices(case, labels), "invalid_choice")',
     "pass  # fault: accept any label"),
    ("test_agreement_math", "finalise",
     'counts["disagree"] += 1',
     "pass  # fault: never disagree"),
    ("test_rescore", "finalise",
     'correct += choice == decisions[case["id"]]["label"]',
     "correct += 1  # fault: every pick counts correct"),
    ("test_draft_validation", "page",
     'b.require(item["label"] in valid, "draft_invalid_choice")',
     "pass  # fault: accept any draft label"),
    ("test_consensus", "page",
     'settled = response["final"] == verdict["judge"]',
     'settled = True  # fault: everything counts settled'),
    ("test_verify_read_only", "finalise",
     'b.require(b.read_json(summary_path) == expected_summary, "summary_mismatch")',
     "pass  # fault: skip summary comparison"),
    ("test_verify_read_only", "finalise",
     'b.require(pinned is not None and b.file_hash(reference_path) == pinned, "reference_pin_mismatch")',
     "pass  # fault: skip the reference pin"),
    ("test_consensus", "page",
     'b.require(verdict["agree"] == labels_agree, "verdict_flag_inconsistent")',
     "pass  # fault: trust the agree flag"),
]


def prove_faults():
    """Run each test against a disposable faulty copy and record the outcome."""
    output = HERE / "output"
    (output / "fault-copies").mkdir(parents=True, exist_ok=True)
    results = []
    for test_id, target, old, new in FAULTS:
        base = source if target == "finalise" else page_source
        assert base.count(old) == 1, f"anchor not unique: {test_id}"
        faulty = base.replace(old, new)
        copy_path = output / "fault-copies" / f"{test_id}-{target}.py"
        copy_path.write_text(faulty)
        variable = ("EXPERIMENT10_FAULT_COPY" if target == "finalise"
                    else "EXPERIMENT10_PAGE_FAULT_COPY")
        environment = dict(os.environ, **{variable: str(copy_path)})
        completed = subprocess.run(
            [sys.executable, "-m", "pytest", "-q",
             f"{Path(__file__).name}::FinaliseTests::{test_id}"],
            cwd=HERE, env=environment, capture_output=True, text=True, timeout=600)
        evidence = output / f"{test_id}-fault.txt"
        evidence.write_text(completed.stdout + completed.stderr)
        results.append({"test": test_id, "target": target, "fault": new,
                        "detected": completed.returncode != 0,
                        "exit_code": completed.returncode, "evidence": evidence.name,
                        "copy": str(copy_path.relative_to(HERE))})
        print(f"{test_id} ({target}): fault detected = {completed.returncode != 0}", flush=True)
    report = {"focused_tests": 9, "faults": results,
              "all_detected": all(item["detected"] for item in results)}
    (output / "test-proof.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"all_detected": report["all_detected"]}), flush=True)
    raise SystemExit(0 if report["all_detected"] else 1)


if __name__ == "__main__":
    if "--prove-faults" in sys.argv:
        prove_faults()
    unittest.main()
