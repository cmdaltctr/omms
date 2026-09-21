#!/usr/bin/env bash

# Runs each test file in its own Bun process. The suite shares module and
# storage state across files in a single process, which makes cross-file
# order dependencies fail non-deterministically. One process per file is
# deterministic. See docs/ci.md.
set -euo pipefail

shopt -s nullglob
for test_file in tests/*.test.ts; do
  echo ">>> $test_file"
  bun test "$test_file"
done
