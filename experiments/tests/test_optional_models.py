"""Keep optional model omissions explicit and Needle telemetry disabled."""

import importlib
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def module():
    assert (Path(__file__).resolve().parents[1] / "optional_models.py").is_file(), "Optional pins required"
    return importlib.import_module("optional_models")


def test_omitted_arms_have_blocked_reasons():
    result = module().omitted_models()
    assert {"OpenJev", "P4", "P5"} == set(result)
    assert all(value["status"] == "blocked" and value["reason"] for value in result.values())


def test_needle_requires_pins_and_both_telemetry_switches():
    pins = {"repository": "cactus-compute/needle", "revision": "a" * 40, "weights_sha256": "b" * 64, "backend": "local"}
    for environment in ({}, {"NEEDLE_TELEMETRY": "0"}, {"NEEDLE_TELEMETRY": "0", "DO_NOT_TRACK": "0"}):
        with pytest.raises(ValueError, match="telemetry"):
            module().validate_needle(pins, environment)
    environment = {"NEEDLE_TELEMETRY": "0", "DO_NOT_TRACK": "1"}
    module().validate_needle(pins, environment)
    del pins["weights_sha256"]
    with pytest.raises(ValueError, match="pins"):
        module().validate_needle(pins, environment)


def test_openjev_requires_repository_backend_revision_and_weights():
    with pytest.raises(ValueError, match="pins"):
        module().validate_openjev({"repository": "unselected"})
    module().validate_openjev({"repository": "synthetic/repo", "revision": "a" * 40, "weights_sha256": "b" * 64, "backend": "local"})
