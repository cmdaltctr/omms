"""Read-only snapshot and text safeguards for local experiments."""

import os
import re
import subprocess
from pathlib import Path


REDACTED = "[REDACTED]"
PRIVATE_TAG = re.compile(r"<(\/?)private\s*>", re.IGNORECASE)
SECRET_PATTERNS = [
    r"-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)",
    r"\bsk-ant-[A-Za-z0-9_-]{10,}",
    r"\bsk-[A-Za-z0-9_-]{16,}",
    r"\bgithub_pat_[A-Za-z0-9_]{20,}",
    r"\bgh[pousr]_[A-Za-z0-9]{20,}",
    r"\bAKIA[0-9A-Z]{16}\b",
    r"\bxox[abprs]-[A-Za-z0-9-]{10,}",
    r"\bAIza[0-9A-Za-z_-]{35}",
    r"\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}",
    r"\bBearer\s+[A-Za-z0-9._~+/=-]{16,}",
]


def reject_symlinks(path: Path) -> Path:
    """Reject symlinks in every path component before resolving a path."""
    absolute = Path(os.path.abspath(path))
    if any(part.is_symlink() for part in (absolute, *absolute.parents)):
        raise ValueError("symlink path refused")
    return absolute


def output_path(path: Path, root: Path) -> Path:
    """Allow writes only within a non-live experiment root."""
    path = reject_symlinks(path)
    root = reject_symlinks(root)
    if ".omms" in path.parts or ".omms" in root.parts:
        raise ValueError("live output path refused")
    if not path.is_relative_to(root) or path == root:
        raise ValueError("output outside experiment root")
    return path


def snapshot(source: Path, target: Path, root: Path, *, approved: bool) -> Path:
    """Take a sqlite3 read-only .backup without replacing an existing file.

    The Unix VFS opens shared memory read-only with readonly_shm=1. Missing
    shared memory fails closed, without creating a source sidecar. Keep normal
    locking: immutable=1 is unsafe when another connection can change a file.
    """
    if approved is not True:
        raise ValueError("snapshot approval required")
    if os.name != "posix" or os.geteuid() == 0:
        raise ValueError("snapshot requires an unprivileged Unix process")
    source = reject_symlinks(source)
    target = output_path(target, root)
    if not source.is_file():
        raise ValueError("source file required")
    if target.exists():
        raise ValueError("snapshot exists")
    for suffix in ("-wal", "-shm", "-journal"):
        reject_symlinks(Path(str(source) + suffix))
    with source.open("rb") as db:
        if db.read(16) != b"SQLite format 3\x00":
            raise ValueError("SQLite database header required")
    shm = Path(str(source) + "-shm")
    # SQLite's robust_open can chmod an empty SHM even with O_RDONLY.
    if shm.exists() and shm.stat().st_size == 0:
        raise ValueError("uninitialised shared memory refused")
    if "'" in str(target) or "\n" in str(target) or "\r" in str(target):
        raise ValueError("invalid backup path")
    target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd = os.open(target, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    os.close(fd)
    result = subprocess.run(
        [
            "sqlite3", "-batch", "-init", "/dev/null", "-readonly",
            source.as_uri() + "?mode=ro&readonly_shm=1&vfs=unix",
            f".backup '{target}'",
        ],
        capture_output=True, text=True, check=False, timeout=30,
    )
    if result.returncode:
        # Keep failed copies for inspection. Never expose SQLite's path output.
        raise ValueError("snapshot failed")
    return target


def redact(text: str, *, secrets: tuple[str, ...] = ()) -> str:
    """Remove private regions and known secrets, preserving other wording."""
    chunks = []
    depth = 0
    cursor = 0
    for match in PRIVATE_TAG.finditer(text):
        closing = bool(match.group(1))
        if depth == 0:
            chunks.append(text[cursor:match.start()])
        if not closing:
            depth += 1
        elif depth:
            depth -= 1
            if depth == 0:
                chunks.append(REDACTED)
        cursor = match.end()
    chunks.append(REDACTED if depth else text[cursor:])
    result = "".join(chunks)
    for secret in secrets:
        if secret:
            result = result.replace(secret, REDACTED)
    for pattern in SECRET_PATTERNS:
        result = re.sub(pattern, REDACTED, result, flags=re.IGNORECASE)
    return result


def require_redacted(text: str, *, secrets: tuple[str, ...] = ()) -> None:
    """Refuse corpus text that still contains detectable private data."""
    if redact(text, secrets=secrets) != text:
        raise ValueError("redaction required")
