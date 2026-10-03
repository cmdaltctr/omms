# Design

## Context

See proposal.md, Why. The facts the design rests on come from the Claude Code plugin docs (marketplace reference, plugin loading, host a marketplace):

- A plugin entry's `source` can be a relative path, or a `github`, `url`, `git-subdir`, `npm`, `archive`, or `command` source. `github` takes `repo`, `ref` (a branch or tag) and `sha`.
- `claude plugin marketplace update` moves a pinned branch or tag ref to the latest commit of that ref.
- Claude Code installs a new copy only when the plugin's version changes. The version comes from `plugin.json` at the fetched commit. A ref that moves without a version change leaves users on their cached copy.
- An `npm` plugin source does not install dependencies unless the package ships a lockfile. The OMMS package ships none.
- A marketplace added from a git repository is cloned whole, so `marketplace.json` itself still comes from `main`. Only the plugin entry's source changes.

release-please creates lightweight tags, `v<version>`, on the release commit. At proposal time, the repository had no `stable` branch.

## Goals / Non-Goals

**Goals:**

- The plugin version Claude Code installs always equals a version on npm `latest`.
- An approved release reaches Claude Code users with no extra release or commit to `main`.
- The move can be tested without GitHub.

**Non-Goals:**

- Release channels such as a `next` track for Claude Code.
- Changing how Pi, OpenCode, or the global install update.
- A launcher fallback when `npx` fails. This change removes the case that needs it.

## Decisions

### 1. A `github` source on a moving `stable` branch

`marketplace.json` lists `{ "source": "github", "repo": "cmdaltctr/omms", "ref": "stable" }`. The entry never changes again. Releases move the branch.

| Alternative                                     | Rejected because                                                                                                                                         |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pin `ref` to `v<version>` in `marketplace.json` | Each approval needs a commit to `main`. `main` is protected, so that is a pull request per release.                                                      |
| `npm` source                                    | No dependencies are installed. The plugin folder holds `dist/` with no `node_modules`, the launcher sees a runnable copy, and the copy crashes on start. |
| A moving tag                                    | Git clients cache tags and do not expect them to move. A branch is meant to move.                                                                        |
| A second marketplace for the stable track       | Every user would have to remove one marketplace and add another.                                                                                         |

### 2. npm `latest` is the source of truth

The script reads `https://registry.npmjs.org/om-memory-system/latest` and takes its `version`. That is exactly the set of versions users can install. A staged version is not on `latest`, so it never moves the branch. A rollback of `latest` moves the branch back.

### 3. The logic lives in a script, the workflow only runs it

`scripts/sync-claude-plugin-channel.sh` does the whole move with plain `git`:

1. Read the version: from `OMMS_NPM_LATEST` if set (tests), otherwise from the registry with `curl`, parsed with `node`.
2. Accept only a stable SemVer version: `^[0-9]+\.[0-9]+\.[0-9]+$`. A prerelease or any other text stops the run.
3. Resolve `refs/tags/v<version>^{commit}`. A missing tag fails the run and names the tag.
4. Compare it with `refs/remotes/origin/stable`. Equal means nothing to do.
5. Push the commit to `refs/heads/stable` with `--force-with-lease` on the old value. Force is needed for a rollback. The lease stops a push over a change made since the fetch.

It pushes no other ref. A test drives it against a temporary repository with a bare `origin`.

When npm cannot be reached, the script prints a warning and exits 0, so a registry outage does not mail a failure every hour. The branch does not move. A missing tag or a bad version exits 1, because a person must look.

### 4. Hourly, on dispatch, and after approval

Approval happens on npmjs.com with 2FA, outside GitHub, so no workflow event fires. The workflow runs on `schedule` every hour and on `workflow_dispatch`. The release runbook and the `s-omms-npm-release` skill dispatch it straight after approval, so the hour is only a safety net.

The job has `contents: write` and nothing else. It checks out with full history and tags, keeping the checkout credentials only because this job pushes. It runs no package install, so no third-party code runs with that token.

### 5. Order of rollout

`stable` must exist before `main` names it. Otherwise every install and update fails. So the maintainer creates `stable` at the commit tagged `v4.4.1` before the pull request merges. When it merges, an existing install at 4.4.0 sees version 4.4.1 at `stable` and updates. That is the version npm already serves.

The implementation and branch prerequisite are verified before archiving and
opening the pull request. With maintainer approval, post-merge checks live in
the separate rollout checklist in `docs/ci.md`. After merge, dispatch the
workflow, verify it passes and reports `stable` already at `v4.4.1`, then update
the Claude marketplace and verify plugin 4.4.1. These checks stay pending until
merge; moving them does not change the release requirement.

### 6. Local plugin testing

A marketplace added from a local folder now installs from GitHub `stable`, because the entry is no longer a relative path. Plugin development uses `claude --plugin-dir <checkout>`, which loads files in place. The docs say so.

## Risks / Trade-offs

- [Up to one hour between approval and Claude Code seeing the release] → The release steps dispatch the workflow at once. The hourly run covers a missed dispatch.
- [Anyone with write access can push `stable`] → Recommend a ruleset that limits updates of `stable` to GitHub Actions. That is a repository setting the maintainer applies.
- [A release commit with a broken plugin reaches users once approved] → Same as today for npm users. The six-platform smoke and the approval gate both come first.
- [The pull request lands on `main` before `stable` exists] → Task order creates `stable` first and checks it with `gh api` before merge.
- [Claude Code changes how a moved ref is read] → `claude plugin validate` and a manual `claude plugin marketplace update omms` check after merge show it.
- [The marketplace change is user-visible without an npm release] → It takes effect when it reaches `main`. A `fix:` commit also opens a 4.4.2 release pull request with no runtime change. The maintainer may hold that release until other changes join it.
