"""Pair-decision metrics and conservative pilot gate verdicts."""

import math
import random
import statistics


DEFAULT_GATES = {"false_merge_upper_bound": 0.05, "agreement_tolerance": 0.03, "speedup_factor": 5, "fallback_limit": 0.3}


def upper95(errors, count):
    """Return the upper end of a two-sided 95% Wilson interval."""
    if count == 0:
        return None
    z = 1.959963984540054
    rate = errors / count
    return (rate + z*z/(2*count) + z*math.sqrt(rate*(1-rate)/count + z*z/(4*count*count))) / (1 + z*z/count)


def metrics(pairs, truth, records, arm):
    """Count missing and invalid answers as wrong on decided reviewed pairs."""
    repeats = 2 if arm == "P1" else 1
    expected = {(pair["id"], repeat) for pair in pairs for repeat in range(1, repeats + 1)}
    selected = [record for record in records if record["arm"] == arm]
    by_key = {(record["pair_id"], record["repeat"]): record for record in selected}
    complete = bool(pairs) and set(by_key) == expected and len(by_key) == len(selected)
    positive = "same" if pairs and pairs[0]["decision"] == "duplicate" else "contradict"
    negative = "different" if positive == "same" else "compatible"
    correct = decided = yes = wrong = uncertain_yes = errors = missed = 0
    times, correctness = [], {}
    for pair in pairs:
        label = truth.get(pair["id"], {})
        outcome = label.get("outcome")
        if outcome not in (positive, negative, "uncertain") or not label.get("reason"):
            complete = False
        for repeat in range(1, repeats + 1):
            record = by_key.get((pair["id"], repeat), {})
            valid = record.get("status") == "ok" and type(record.get("answer")) is bool
            accepted = valid and record["answer"]
            if not valid:
                errors += 1
            if outcome in (positive, negative):
                decided += 1
                right = valid and record["answer"] == (outcome == positive)
                correct += int(right)
                correctness.setdefault(pair["id"], []).append(int(right))
                missed += int(valid and not record["answer"] and outcome == positive)
            yes += int(accepted)
            wrong += int(accepted and outcome == negative)
            uncertain_yes += int(accepted and outcome not in (positive, negative))
            duration = record.get("duration_seconds")
            if type(duration) in (float, int) and math.isfinite(duration) and duration >= 0:
                times.append(duration)
            else:
                complete = False
    mean = statistics.fmean(times) if times else None
    fallbacks = sum(record.get("fallback") is True for record in selected)
    return {"complete": complete, "agreement": correct / decided if decided else None, "accepted_yes": yes, "wrong_merges": wrong, "false_merge_rate": wrong / yes if yes else None, "false_merge_upper95": upper95(wrong, yes), "uncertain_accepted": uncertain_yes, "errors": errors, "missed_merges": missed, "mean_seconds": mean, "p95_seconds": sorted(times)[math.ceil(0.95*len(times))-1] if times else None, "seconds_per_60": mean*60 if mean is not None else None, "fallback_rate": fallbacks / len(expected) if expected else None, "correctness": {key: statistics.fmean(values) for key, values in correctness.items()}}


def paired_interval(pairs, candidate, control, *, seed=42):
    """Resample entry groups for a paired agreement difference interval."""
    groups = {}
    for pair in pairs:
        key = pair["id"]
        if key in candidate["correctness"] and key in control["correctness"]:
            groups.setdefault(pair["group"], []).append(candidate["correctness"][key] - control["correctness"][key])
    if not groups:
        return None
    values = list(groups.values())
    rng = random.Random(seed)
    samples = []
    for _ in range(1000):
        chosen = [rng.choice(values) for _ in values]
        samples.append(sum(sum(group) for group in chosen) / sum(len(group) for group in chosen))
    samples.sort()
    return [samples[24], samples[974]]


def summarise(pairs, truth, records, *, gates=None, production_writes=0):
    """Judge every arm and decision without discarding failed records."""
    limits = {**DEFAULT_GATES, **(gates or {})}
    output = {}
    for decision in ("duplicate", "conflict"):
        subset = [pair for pair in pairs if pair["decision"] == decision and pair["split"] == "test"]
        results = [record for record in records if record["decision"] == decision and record.get("split") == "test" and not record.get("swapped")]
        all_metrics = {arm: metrics(subset, truth, results, arm) for arm in ("P0", "P1", "P2", "P3")}
        baseline = all_metrics["P1"]
        complete = all(item["complete"] for item in all_metrics.values())
        contradictions = sum(truth.get(pair["id"], {}).get("outcome") == "contradict" for pair in subset)
        output[decision] = {}
        for arm, item in all_metrics.items():
            checks = {"P-G1": "INCONCLUSIVE", "P-G2": "INCONCLUSIVE", "P-G3": "INCONCLUSIVE", "P-G4": "PASS", "P-G5": "PASS" if complete else "INCONCLUSIVE", "P-G6": "PASS" if production_writes == 0 else "FAIL"}
            rate, reference_rate = item["false_merge_rate"], baseline["false_merge_rate"]
            if rate is not None and reference_rate is not None:
                if rate > reference_rate:
                    checks["P-G1"] = "FAIL"
                elif not item["uncertain_accepted"] and item["false_merge_upper95"] < limits["false_merge_upper_bound"]:
                    checks["P-G1"] = "PASS"
                elif rate >= limits["false_merge_upper_bound"]:
                    checks["P-G1"] = "FAIL"
            if item["agreement"] is not None and baseline["agreement"] is not None:
                checks["P-G2"] = "PASS" if item["agreement"] + limits["agreement_tolerance"] >= baseline["agreement"] else "FAIL"
            if item["mean_seconds"] and baseline["mean_seconds"]:
                checks["P-G3"] = "PASS" if baseline["mean_seconds"] / item["mean_seconds"] >= limits["speedup_factor"] - 1e-12 else "FAIL"
            if arm == "P3" and item["fallback_rate"] is not None:
                checks["P-G4"] = "PASS" if item["fallback_rate"] <= limits["fallback_limit"] else "FAIL"
            few_contradictions = decision == "conflict" and contradictions < 30
            if not complete or few_contradictions or item["uncertain_accepted"]:
                verdict = "INCONCLUSIVE"
            elif "FAIL" in checks.values():
                verdict = "FAIL"
            elif "INCONCLUSIVE" in checks.values():
                verdict = "INCONCLUSIVE"
            else:
                verdict = "PASS"
            if production_writes:
                verdict = "FAIL"
            if arm == "P1" and production_writes == 0:
                verdict = "INCONCLUSIVE"
            difference_ci = paired_interval(subset, item, baseline)
            public_metrics = {key: value for key, value in item.items() if key != "correctness"}
            output[decision][arm] = {"verdict": verdict, "gates": checks, "metrics": public_metrics, "paired_agreement_difference95": difference_ci, "reference_control": arm == "P1", "reviewed_contradictions": contradictions}
    return output
