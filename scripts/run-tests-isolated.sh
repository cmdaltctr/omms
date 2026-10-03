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

# Run every file, then list each one that failed. Stopping at the first failure hid the
# later ones, so a Windows-only problem took one smoke run per failing file to find.
failed=()

for test_file in tests/*.test.ts; do
  echo ">>> $test_file"
  if ! bun test ${timeout_args[@]+"${timeout_args[@]}"} "$test_file"; then
    failed+=("$test_file")
  fi
done

# Web page specs. Bun does not follow the tsconfig references in web/tsconfig.json,
# so the `$lib` and `$shared` aliases only resolve with the app tsconfig.
for spec_file in web/tests/*.spec.ts web/tests/*.spec.tsx; do
  echo ">>> $spec_file"
  if ! bun test --tsconfig-override web/tsconfig.app.json ${timeout_args[@]+"${timeout_args[@]}"} "$spec_file"; then
    failed+=("$spec_file")
  fi
done

# macOS bash 3.2 treats an empty array as unbound under `set -u`, so guard each use.
if [[ ${#failed[@]} -gt 0 ]]; then
  echo
  echo "${#failed[@]} test file(s) failed:"
  for file in ${failed[@]+"${failed[@]}"}; do
    echo "  $file"
    # GitHub shows each one as an annotation on the job.
    if [[ -n "${GITHUB_ACTIONS:-}" ]]; then echo "::error file=$file::$file failed"; fi
  done
  exit 1
fi
