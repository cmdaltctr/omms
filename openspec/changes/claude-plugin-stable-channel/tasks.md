# Tasks

## 1. Channel script

- [ ] 1.1 Write `tests/claude-plugin-channel.test.ts`. Each case builds a temporary repository with a bare `origin`, release tags, and a `stable` branch, then runs the script with `OMMS_NPM_LATEST` set. Cases: moves `stable` to the commit tagged `v<latest>`; does nothing when `stable` is already there; moves `stable` back to an older tag (rollback); fails, names the tag, and leaves `stable` alone when the tag is missing; refuses a prerelease and any non-SemVer text; creates `stable` when it does not exist; pushes no ref other than `refs/heads/stable`; leaves `stable` alone and exits 0 when the registry read fails. Verify: every case fails before 1.2, because the script does not exist.
- [ ] 1.2 Write `scripts/sync-claude-plugin-channel.sh` as design decision 3 describes. Plain `git`, `curl` and `node`, no package install. Verify: `bun test tests/claude-plugin-channel.test.ts` passes, and each case fails when its guard is removed from a scratch copy of the script.

## 2. Workflow

- [ ] 2.1 Add `.github/workflows/claude-plugin-channel.yml`: `schedule` every hour and `workflow_dispatch`; one `ubuntu-latest` job with `contents: write` only; checkout with `fetch-depth: 0` and tags; run the script. Verify: the YAML parses, and `bun run check` passes.

## 3. Marketplace entry

- [ ] 3.1 Change `tests/claude-plugin-assets.test.ts` to require the entry `{ "source": "github", "repo": "cmdaltctr/omms", "ref": "stable" }` and no relative source. Verify: it fails before 3.2.
- [ ] 3.2 Change `.claude-plugin/marketplace.json` to that entry. Verify: 3.1 passes, and `claude plugin validate .` passes.
- [ ] 3.3 Check that Claude Code installs from the `stable` ref: copy the marketplace to a scratch folder with the entry's `ref` set to an existing tag (`v4.4.1`), add it as a local marketplace under a scratch `CLAUDE_CONFIG_DIR`, install the plugin, and read the installed version and commit. Verify: version 4.4.1 at the commit tagged `v4.4.1`. Record the result here.

## 4. Docs and release steps

- [ ] 4.1 Update `docs/claude-code-adapter.md`, `UPDATES.md` and `docs/upgrading.md`: Claude Code installs only versions approved on npm, through the `stable` branch, within an hour of approval or at once after dispatch. Local plugin testing uses `claude --plugin-dir`. Verify: `bun run check` passes.
- [ ] 4.2 Update `docs/ci.md`: the new workflow in the overview table and the workflow list, and a step in the release runbook after approval: `gh workflow run claude-plugin-channel.yml`. Verify: `bun run check` passes.
- [ ] 4.3 Add an ADR for the decision and its index row. Add the post-approval dispatch to step 6 of the `s-omms-npm-release` skill (`~/.agents/skills/s-omms-npm-release/SKILL.md`). Verify: the ADR index lists it, and the skill names the command.

## 5. Gate and rollout

- [ ] 5.1 Run `bun run ci:local`. Verify: exit 0.
- [ ] 5.2 Before the pull request merges, ask the maintainer to approve creating `stable` at the commit tagged `v4.4.1`, then create it: `gh api -X POST repos/cmdaltctr/omms/git/refs -f ref=refs/heads/stable -f sha=<sha>`. Verify: `gh api repos/cmdaltctr/omms/branches/stable` returns that commit.
- [ ] 5.3 After merge, dispatch the workflow once. Verify: the run passes and reports `stable` already at `v4.4.1`. Then run `claude plugin marketplace update omms` and `claude plugin list`. Verify: `omms@omms` shows 4.4.1.
