"""Optional local model pins, with explicit blocked-arm metadata."""

import re


def omitted_models():
    """Keep unconfigured arms visible in manifests and reports."""
    return {
        "OpenJev": {"status": "blocked", "reason": "No repository, revision, backend or weights approved."},
        "P4": {"status": "blocked", "reason": "Julia-1 was not requested; downloads and a yes/no backend remain unapproved."},
        "P5": {"status": "blocked", "reason": "Needle revision, weights and local enum backend remain unapproved."},
    }


def validate_openjev(pins):
    """Require a repository, local backend, revision and weight checksum."""
    if not pins.get("repository") or not pins.get("backend"):
        raise ValueError("complete optional pins required")
    if not re.fullmatch(r"[0-9a-f]{40}", pins.get("revision", "")) or not re.fullmatch(r"[0-9a-f]{64}", pins.get("weights_sha256", "")):
        raise ValueError("complete optional pins required")


def validate_needle(pins, environment):
    """Refuse Needle unless both telemetry switches disable tracking."""
    if environment.get("NEEDLE_TELEMETRY") != "0" or environment.get("DO_NOT_TRACK") != "1":
        raise ValueError("Needle telemetry must be disabled")
    validate_openjev(pins)
    if pins["repository"] != "cactus-compute/needle" or pins["backend"] != "local":
        raise ValueError("Needle local pins required")
