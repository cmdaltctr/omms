#!/usr/bin/env bash
# Approve the staged npm release with 2FA, then move the Claude plugin channel.
# Usage: bun run release:approve [<stage-id>]
# Without a stage ID, the script reads it from the newest GitHub Release note,
# where the Release workflow writes it.
set -euo pipefail

repo=${OMMS_REPO:-cmdaltctr/omms}
package=om-memory-system
poll_seconds=${OMMS_RELEASE_POLL_SECONDS:-5}
uuid='[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'

tag=$(gh release view --repo "$repo" --json tagName --jq .tagName)
version=${tag#v}
if [[ ! $version =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Cannot read the version from release $tag." >&2
  exit 1
fi
if [[ $(npm view "$package" version 2>/dev/null) == "$version" ]]; then
  echo "$package@$version is already on npm. Nothing is waiting for approval." >&2
  exit 1
fi

stage_id=${1:-}
if [[ -z $stage_id ]]; then
  stage_id=$(gh release view "$tag" --repo "$repo" --json body --jq .body |
    grep -Eo "npm stage approve $uuid" | tail -1 | cut -d' ' -f4 || true)
fi
if [[ ! $stage_id =~ ^$uuid$ ]]; then
  echo "No stage ID in the $tag release note. Run 'npm stage list $package', then pass the ID." >&2
  exit 1
fi

echo "Approving $package@$version (stage $stage_id)."
npm stage view "$stage_id"
if ! npm stage approve "$stage_id"; then
  echo "Approval failed. If npm says you are not logged in, run 'npm login', then try again." >&2
  exit 1
fi

for _ in $(seq 1 30); do
  [[ $(npm view "$package" version 2>/dev/null) == "$version" ]] && break
  sleep "$poll_seconds"
done
if [[ $(npm view "$package" version 2>/dev/null) != "$version" ]]; then
  echo "npm latest is not $version yet. The hourly channel run finishes the rest." >&2
  exit 1
fi
echo "npm latest is $version."

latest_run() {
  gh run list --repo "$repo" --workflow claude-plugin-channel.yml --event workflow_dispatch \
    --limit 1 --json databaseId --jq '.[0].databaseId // 0'
}
before=$(latest_run)
gh workflow run claude-plugin-channel.yml --repo "$repo" --ref main
run=$before
for _ in $(seq 1 30); do
  run=$(latest_run)
  [[ $run != "$before" ]] && break
  sleep "$poll_seconds"
done
if [[ $run == "$before" ]]; then
  echo "The channel run did not start. The hourly run finishes the rest." >&2
  exit 1
fi
gh run watch "$run" --repo "$repo" --exit-status

# A lightweight tag lists its commit; an annotated tag lists the commit last (^{}).
remote="https://github.com/$repo.git"
tag_commit=$(git ls-remote "$remote" "refs/tags/v$version" "refs/tags/v$version^{}" | tail -1 | cut -f1)
stable=$(git ls-remote "$remote" refs/heads/stable | cut -f1)
if [[ -z $tag_commit || $stable != "$tag_commit" ]]; then
  echo "stable ($stable) is not at v$version ($tag_commit)." >&2
  exit 1
fi
echo "Released $package@$version. Claude plugin stable is at v$version."
