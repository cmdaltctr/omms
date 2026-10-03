#!/usr/bin/env bash

# Runs the Claude Code status line mod tests with `claude plugin test`.
# That command runs every *.test.ts under one plugin folder, and the repository
# root holds hundreds of Bun tests. So this script builds a small plugin folder
# from the real module and its test, and runs the command there.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
work="$(mktemp -d "${TMPDIR:-/tmp}/omms-claude-mod.XXXXXX")"
trap 'rm -rf "$work"' EXIT

mkdir -p "$work/hooks" "$work/.claude-plugin"
cp "$root/hooks/omms-status.js" "$root/hooks/omms-status.test.ts" "$work/hooks/"
echo '{ "modules": ["./omms-status.js"] }' > "$work/hooks/hooks.json"
echo '{ "name": "omms", "version": "0.0.0", "description": "OMMS status line mod test" }' \
  > "$work/.claude-plugin/plugin.json"

claude plugin test "$work"
