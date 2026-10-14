"""Local preparation commands. This module makes no model calls."""

import argparse
import json
from pathlib import Path

from checkpoint import Checkpoint
from manifest import digest, validate
from safety import snapshot


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    copy = commands.add_parser("snapshot")
    copy.add_argument("--source", type=Path, required=True)
    copy.add_argument("--target", type=Path, required=True)
    copy.add_argument("--root", type=Path, required=True)
    copy.add_argument("--snapshot-approved", action="store_true")
    probe = commands.add_parser("resume-probe")
    probe.add_argument("--root", type=Path, required=True)
    probe.add_argument("--resume", action="store_true")
    check = commands.add_parser("validate")
    check.add_argument("--manifest", type=Path, required=True)
    check.add_argument("--hosted-arm", action="append", default=[])
    args = parser.parse_args()
    try:
        if args.command == "snapshot":
            snapshot(args.source, args.target, args.root, approved=args.snapshot_approved)
            print(json.dumps({"status": "copied"}), flush=True)
        elif args.command == "resume-probe":
            saved = Checkpoint(args.root / "probe.json", args.root, digest({"probe": 1}), resume=args.resume)
            needed = saved.should_run("synthetic/P0")
            if needed:
                saved.record("synthetic/P0", {"status": "ok", "answer": False})
            print(json.dumps({"written": int(needed)}), flush=True)
        else:
            value = json.loads(args.manifest.read_text())
            fingerprint = validate(value, args.manifest.parent, hosted_arms=args.hosted_arm)
            print(json.dumps({"fingerprint": fingerprint}), flush=True)
    except (ValueError, OSError, KeyError, TypeError):
        parser.exit(1, "experiment prerequisite failed\n")


if __name__ == "__main__":
    main()
