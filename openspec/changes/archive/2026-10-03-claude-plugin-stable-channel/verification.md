# Verification: claude-plugin-stable-channel

## Status

| Dimension    | Result                                                                                       |
| ------------ | -------------------------------------------------------------------------------------------- |
| Completeness | 11/11 implementation tasks complete. Separate post-merge rollout remains pending.            |
| Correctness  | The implementation covers the requirement and its six scenarios. Live rollout is unverified. |
| Coherence    | Script, workflow, marketplace and guides follow the design.                                  |

The implementation was verified and archived. The maintainer approved tracking
post-merge checks separately in the rollout checklist in `docs/ci.md`.
Live deployment remains unverified.

## Checks run

- `bun test tests/claude-plugin-channel.test.ts`: all original 16 cases failed before the script existed; all 18 final cases passed.
- Nine scratch mutations triggered failures: missing branch move, no-op guard, version guard, tag guard, wrong destination ref, missing rollback force, unsafe force, registry failure exit and missing-version handling.
- `bun test tests/claude-plugin-assets.test.ts`: the changed marketplace assertion failed with the relative source; all eight cases passed with the GitHub source.
- `claude plugin validate .`: passed.
- Scratch install with Claude Code 2.1.288: `omms@omms` installed version 4.4.1 at `addd17848f13b52d531e1e4f392787f79d07ce7f`, matching `v4.4.1^{commit}`. The scratch source used a tag because the remote `stable` branch had not been created at the time of that check.
- Ruby YAML parse: passed. The workflow has one Ubuntu job, hourly and manual triggers, full history and tags, job-only `contents: write`, and explicit credentials for its push.
- `bun run check`: passed after workflow, guide and release-step edits.
- `bun run ci:local`: passed three times, including after archive and pulling the latest `main`. The final pre-push run built the package and web app and ran 247 test files in isolated processes. Exit 0. Log: `/tmp/omms-stable-channel-pre-push-ci.log`.
- Aikido scanned the script, both changed test files and the workflow. After job-scoped permissions and explicit checkout credentials, the rescan returned zero findings.
- `openspec validate claude-plugin-stable-channel --strict`: passed before archive.
- `openspec validate --specs --strict`: all 26 specs passed. The synced requirement and all six scenarios match the delta.
- `git diff --check`: passed.
- `graphify update .`: rebuilt the code graph successfully.

Checks ran locally on macOS. The GitHub `stable` branch was created after maintainer approval. At archive time, no workflow had been dispatched and no implementation commit or branch push had been made.
The global release skill edit was separately authorised and lives outside this repository.

## Requirement evidence

| Scenario                   | Evidence                                                                                                                    |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Failed publish             | The script reads npm `latest`, independently of the checkout version. Existing-release no-op tests leave refs unchanged.    |
| Approved release           | Registry-read and branch-move tests select the release tag. Workflow and runbook provide hourly/manual updates.             |
| Staged, unapproved release | Existing-release no-op tests preserve the branch while a newer release tag exists.                                          |
| Missing tag                | The script fails and names the tag; the regression test checks every remote ref remains unchanged.                          |
| Registry unavailable       | HTTP failure, missing version and malformed JSON tests exit 0, warn and leave all refs unchanged.                           |
| npm rollback               | The rollback test moves the branch to the older release. Explicit leases also reject concurrent changes and creation races. |

The marketplace assertion requires the exact GitHub source on `stable`. The
scratch Claude install confirms that the host honours a plugin source ref.

## Remaining actions

### Completed: task 5.2

The maintainer approved the rollout sequence. Created `refs/heads/stable` at
`addd17848f13b52d531e1e4f392787f79d07ce7f` through the GitHub API.
`gh api repos/cmdaltctr/omms/branches/stable` verified that commit. Both npm
`latest` and the GitHub tag name 4.4.1.

### Follow-up: former task 5.3

The new workflow is unmerged, so its live behaviour remains unverified.

1. After merge, dispatch `claude-plugin-channel.yml` with maintainer approval.
2. Verify the run passes and reports `stable` already at `v4.4.1`.
3. Update the maintainer's Claude marketplace and confirm installed version 4.4.1.

### Resolved: archive and pull request order

The maintainer approved moving former task 5.3 into the separate post-merge
rollout checklist in `docs/ci.md`. The proposal, design and tasks now record
that split. The behaviour requirement and its six scenarios remain unchanged.
All implementation tasks are complete; deployment checks remain unchecked.
No critical implementation findings remain.

### Approved PR review follow-up

The maintainer approved three fixes before merge:

- Clarify that npm approval is followed by manual workflow dispatch.
- Scope both copies of the release requirement to the npm `latest` value observed at the most recent successful channel sync.
- Guard the write-enabled job with `github.ref == 'refs/heads/main'` and pin checkout to `main`.

Two workflow regression tests failed against the previous workflow. After the
fix, all 20 tests in `tests/claude-plugin-channel.test.ts` passed. The first full
gate stopped on ESLint's `no-regex-spaces` rule in those tests. Counted spaces
fixed it, and the full gate passed over 247 isolated test files. Exit 0. Log:
`/tmp/omms-stable-review-ci-final.log`.

The workflow YAML parses. All 26 main specs validate strictly. Aikido rescanned
the workflow and test file and returned zero findings. The code graph was
updated. Repository rulesets remain a separate control over who can write
`stable`; the job guard and checkout pin do not replace those protections.

### Warning: Bun diagnostic during web tests

Bun 1.4.2 printed internal directory-mismatch diagnostics involving
`web/tsconfig.app.json`. The affected assertions passed and the full gate exited 0.
To investigate separately, reproduce with:

```bash
bun test --tsconfig-override web/tsconfig.app.json web/tests/web-app-version.spec.tsx
```
