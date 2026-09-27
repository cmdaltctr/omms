#!/usr/bin/env bash

# Runs each test file in its own Bun process. The suite shares module and
# storage state across files in a single process, which makes cross-file
# order dependencies fail non-deterministically. One process per file is
# deterministic. See docs/ci.md.
set -euo pipefail

shopt -s nullglob

# Give this run its own log and traces directory. A real environment variable
# takes precedence over the fallback in .env.test, and every test process and
# its children inherit it, so concurrent runs never share log output.
if [[ -z "${OMMS_LOG_FILE:-}" ]]; then
  export OMMS_LOG_FILE="$(mktemp -d "${TMPDIR:-/tmp}/omms-test-logs.XXXXXX")/omms.log"
fi

for test_file in tests/*.test.ts; do
  echo ">>> $test_file"
  bun test "$test_file"
done
