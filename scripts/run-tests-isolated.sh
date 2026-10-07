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

# Give this run an empty home folder. Bun reads the home folder once at process
# start, so a test that changes HOME at run time still opens the developer's real
# ~/.omms store and ~/.config/omms config. One test deleted every row in the real
# user-prompts.db that way. The embedding model cache stays outside the run, so
# the model downloads once per machine, not once per run.
real_home="$HOME"
# tests/preload.ts refuses a test process whose home folder is this one.
export OMMS_REAL_HOME="$real_home"
export OMMS_TEST_HOME="$(cd "$(mktemp -d "${TMPDIR:-/tmp}/omms-test-home.XXXXXX")" && pwd -P)"
# Remove the empty home on every exit. rm does not follow the model cache link.
trap 'rm -rf "$OMMS_TEST_HOME"' EXIT
model_cache="${XDG_CACHE_HOME:-$real_home/.cache}/omms-test-models"
mkdir -p "$OMMS_TEST_HOME/.omms/data" "$model_cache"
ln -s "$model_cache" "$OMMS_TEST_HOME/.omms/data/.cache"
export HOME="$OMMS_TEST_HOME"
export USERPROFILE="$OMMS_TEST_HOME"
# Keep Bun's own install cache and git identity, which tests need from the real home.
export BUN_INSTALL_CACHE_DIR="${BUN_INSTALL_CACHE_DIR:-$real_home/.bun/install/cache}"
if [[ -f "$real_home/.gitconfig" ]]; then cp "$real_home/.gitconfig" "$OMMS_TEST_HOME/.gitconfig"; fi

# Windows runners start processes slowly, so allow 30 seconds per test there.
# Other platforms keep Bun's default, and explicit per-test timeouts still apply.
timeout_args=()
case "${OSTYPE:-}" in
  msys* | cygwin* | win32*) timeout_args=(--timeout 30000) ;;
esac

# Run every file, then list each one that failed. Stopping at the first failure hid the
# later ones, so a Windows-only problem took one smoke run per failing file to find.
failed=()

# With file arguments, run only those files. Otherwise run every test file and web spec.
if [[ $# -gt 0 ]]; then
  test_files=()
  spec_files=()
  for file in "$@"; do
    case "$file" in
      *.spec.ts | *.spec.tsx) spec_files+=("$file") ;;
      *) test_files+=("$file") ;;
    esac
  done
else
  test_files=(tests/*.test.ts)
  spec_files=(web/tests/*.spec.ts web/tests/*.spec.tsx)
fi

for test_file in ${test_files[@]+"${test_files[@]}"}; do
  echo ">>> $test_file"
  if ! bun test ${timeout_args[@]+"${timeout_args[@]}"} "$test_file"; then
    failed+=("$test_file")
  fi
done

# Web page specs. Bun does not follow the tsconfig references in web/tsconfig.json,
# so the `$lib` and `$shared` aliases only resolve with the app tsconfig.
for spec_file in ${spec_files[@]+"${spec_files[@]}"}; do
  echo ">>> $spec_file"
  if ! bun test --tsconfig-override web/tsconfig.app.json ${timeout_args[@]+"${timeout_args[@]}"} "$spec_file"; then
    failed+=("$spec_file")
  fi
done

# With OMMS_TEST_RETRY=1, run each failed file once more. The release smoke sets it
# on Windows, where a stalled runner times out tests that pass on a second run.
# A file that fails twice still fails the run. See ADR-024.
if [[ "${OMMS_TEST_RETRY:-}" == "1" && ${#failed[@]} -gt 0 ]]; then
  still_failed=()
  for file in ${failed[@]+"${failed[@]}"}; do
    echo ">>> retry $file"
    tsconfig_args=()
    case "$file" in
      *.spec.ts | *.spec.tsx) tsconfig_args=(--tsconfig-override web/tsconfig.app.json) ;;
    esac
    if bun test ${tsconfig_args[@]+"${tsconfig_args[@]}"} ${timeout_args[@]+"${timeout_args[@]}"} "$file"; then
      echo "$file passed on retry"
      if [[ -n "${GITHUB_ACTIONS:-}" ]]; then echo "::warning file=$file::$file passed on retry"; fi
    else
      still_failed+=("$file")
    fi
  done
  failed=(${still_failed[@]+"${still_failed[@]}"})
fi

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
