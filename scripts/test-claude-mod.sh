#!/usr/bin/env bash

# Runs the Claude Code module tests with `claude plugin test`.
# That command runs every *.test.ts under one plugin folder, and the repository
# root holds hundreds of Bun tests. So this script builds a small plugin folder
# from the real module files and their tests, and runs the command there.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
work="$(mktemp -d "${TMPDIR:-/tmp}/omms-claude-mod.XXXXXX")"
trap 'rm -rf "$work"' EXIT

mkdir -p "$work/hooks" "$work/.claude-plugin"
# The entry imports the other module files, so copy them all with their tests.
shopt -s nullglob
cp "$root"/hooks/*.jsx "$root"/hooks/*.js "$root"/hooks/*.test.ts "$work/hooks/"
echo '{ "modules": ["./omms.jsx"] }' > "$work/hooks/hooks.json"
echo '{ "name": "omms", "version": "0.0.0", "description": "OMMS module test" }' \
  > "$work/.claude-plugin/plugin.json"

claude plugin test "$work"
