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
on_npm() {
  # --prefer-online keeps npm's cache from hiding a newly approved release.
  [[ $(npm view "$package" version --prefer-online 2>/dev/null) == "$version" ]]
}

remote="https://github.com/$repo.git"
stable_at_tag() {
  # A lightweight tag lists its commit; an annotated tag lists the commit last (^{}).
  tag_commit=$(git ls-remote "$remote" "refs/tags/v$version" "refs/tags/v$version^{}" | tail -1 | cut -f1)
  stable=$(git ls-remote "$remote" refs/heads/stable | cut -f1)
  [[ -n $tag_commit && $stable == "$tag_commit" ]]
}

if on_npm; then
  # Approved another way, or an earlier run stopped before the channel. Never
  # approve twice, but still move and check the channel.
  if stable_at_tag; then
    echo "$package@$version is on npm and Claude plugin stable is at v$version. Nothing to do."
    exit 0
  fi
  echo "$package@$version is already on npm. Skipping the approval and moving the channel."
else
  stage_id=${1:-}
  if [[ -z $stage_id ]]; then
    stage_id=$(gh release view "$tag" --repo "$repo" --json body --jq .body |
      grep -Eo "npm stage approve $uuid" | tail -1 | cut -d' ' -f4 || true)
  fi
  if [[ ! $stage_id =~ ^$uuid$ ]]; then
    echo "No stage ID in $tag release note. Run 'npm stage list $package', then pass the ID." >&2
    exit 1
  fi

  echo "Approving $package@$version (stage $stage_id)."
  npm stage view "$stage_id"
  if ! npm stage approve "$stage_id"; then
    echo "Approval failed. If npm says you are not logged in, run 'npm login', then try again." >&2
    exit 1
  fi

  for _ in $(seq 1 30); do
    on_npm && break
    sleep "$poll_seconds"
  done
  if ! on_npm; then
    echo "npm latest is not $version yet. Wait a few minutes, then run 'bun run release:approve' again. It does not approve twice, and it moves the channel." >&2
    exit 1
  fi
  echo "npm latest is $version."
fi

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
  echo "The channel run did not start. Run 'bun run release:approve' again, or run 'gh workflow run claude-plugin-channel.yml --ref main'." >&2
  exit 1
fi
gh run watch "$run" --repo "$repo" --exit-status

if ! stable_at_tag; then
  echo "stable ($stable) is not at v$version ($tag_commit)." >&2
  exit 1
fi
echo "Released $package@$version. Claude plugin stable is at v$version."
