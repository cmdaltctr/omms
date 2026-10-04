#!/usr/bin/env bash
set -euo pipefail

if [[ ${OMMS_NPM_LATEST+x} ]]; then
  version=$OMMS_NPM_LATEST
else
  if ! version=$(curl --fail --silent --show-error --connect-timeout 10 --max-time 30 \
    https://registry.npmjs.org/om-memory-system/latest | node -e '
      let body = "";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", chunk => body += chunk);
      process.stdin.on("end", () => {
        try {
          const { version } = JSON.parse(body);
          if (typeof version !== "string" || !version) process.exit(1);
          process.stdout.write(version);
        } catch { process.exit(1); }
      });
    '); then
    echo "Warning: npm latest could not be read; stable is unchanged." >&2
    exit 0
  fi
fi

if [[ ! $version =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Invalid stable version from npm latest." >&2
  exit 1
fi

tag="v$version"
if ! target=$(git rev-parse --verify "refs/tags/$tag^{commit}" 2>/dev/null); then
  echo "Missing release tag: $tag" >&2
  exit 1
fi

old=$(git rev-parse --verify refs/remotes/origin/stable 2>/dev/null || true)
if [[ $old == "$target" ]]; then
  echo "stable already at $tag ($target)."
  exit 0
fi

# An explicit empty lease also protects first creation from a concurrent push.
git push --force-with-lease="refs/heads/stable:$old" origin "$target:refs/heads/stable"
echo "stable moved to $tag ($target)."
