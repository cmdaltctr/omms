"""Atomic checkpoints with explicit resume and failed-record retries."""

import json
import os
from pathlib import Path

from safety import output_path, require_redacted


def atomic_json(path: Path, root: Path, value) -> None:
    """Replace a JSON file only after a complete temporary file is flushed."""
    path = output_path(path, root)
    temporary = output_path(path.with_suffix(path.suffix + ".tmp"), root)
    data = json.dumps(value, sort_keys=True, indent=2, allow_nan=False) + "\n"
    require_redacted(data)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    flags = os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW
    with os.fdopen(os.open(temporary, flags, 0o600), "w") as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())
    temporary.replace(path)


class Checkpoint:
    """Keep completed records stable, retaining errors until explicit retry."""

    def __init__(self, path: Path, root: Path, fingerprint: str, *, resume=False):
        self.path = output_path(path, root)
        self.root = root
        self.fingerprint = fingerprint
        self.records = {}
        if not self.path.exists():
            if resume:
                raise ValueError("resume checkpoint missing")
            return
        if not resume:
            raise ValueError("existing checkpoint requires --resume")
        saved = json.loads(self.path.read_text())
        if saved.get("fingerprint") != fingerprint:
            raise ValueError("resume fingerprint changed")
        if not isinstance(saved.get("records"), dict):
            raise ValueError("invalid checkpoint records")
        self.records = saved["records"]

    def should_run(self, key: str, *, retry_failed=False) -> bool:
        """Select missing work, or failed work only when explicitly requested."""
        previous = self.records.get(key)
        return previous is None or (retry_failed and previous["status"] == "error")

    def record(self, key: str, value: dict, *, retry_failed=False) -> None:
        """Persist one arm result before updating the in-memory checkpoint."""
        if value.get("status") not in ("ok", "error"):
            raise ValueError("invalid result status")
        if not self.should_run(key, retry_failed=retry_failed):
            raise ValueError("completed record cannot be replaced")
        updated = {**self.records, key: value}
        atomic_json(self.path, self.root, {"fingerprint": self.fingerprint, "records": updated})
        self.records = updated
