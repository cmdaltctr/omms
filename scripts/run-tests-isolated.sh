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

# Windows runners start processes slowly, so allow 30 seconds per test there.
# Other platforms keep Bun's default, and explicit per-test timeouts still apply.
timeout_args=()
case "${OSTYPE:-}" in
  msys* | cygwin* | win32*) timeout_args=(--timeout 30000) ;;
esac

for test_file in tests/*.test.ts; do
  echo ">>> $test_file"
  bun test ${timeout_args[@]+"${timeout_args[@]}"} "$test_file"
done

# Web page specs. Bun does not follow the tsconfig references in web/tsconfig.json,
# so the `$lib` and `$shared` aliases only resolve with the app tsconfig.
for spec_file in web/tests/*.spec.ts web/tests/*.spec.tsx; do
  echo ">>> $spec_file"
  bun test --tsconfig-override web/tsconfig.app.json ${timeout_args[@]+"${timeout_args[@]}"} "$spec_file"
done
