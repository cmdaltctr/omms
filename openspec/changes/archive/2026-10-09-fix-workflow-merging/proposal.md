# Proposal

## Why

A profile rebuilt from about 5,300 prompts holds 5 workflows. One of them has a frequency of 518 and a description that reads as a personality summary. It absorbs almost every new workflow. Of 119 workflow matches in one day, 117 went to that entry. Workflows exist to record repeatable step sequences, so the profile loses them.

## What Changes

- The profile analysis prompt defines a workflow as a repeatable sequence of concrete steps. It asks for at least 3 steps and forbids personality or style summaries.
- A workflow with fewer than 3 steps is dropped before it reaches the profile.
- Workflow matching uses the strong similarity band only. A weak match creates a new workflow.
- A new workflow does not absorb other existing workflows.
- A match never shortens the steps of an existing workflow. It replaces them only with a longer list.
- The description rewrite step does not run for workflows. Preferences and patterns keep it.
- The terminal history import and the terminal `profile-catch-up` run warm the embedding service before they start. Without this, a profile-only run held back most findings in the cold buffer (capped at 50 per type) and dropped the rest.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `profile-learning`: adds the rules for how workflows are extracted, matched, and kept.

## Impact

- `src/core/extraction.ts`: shared workflow rules and the step-count check.
- `src/core/profile-analysis.ts` and `src/adapters/opencode/profile-learning.ts`: prompt wording (three prompts).
- `src/cli/index.ts` and `src/cli/profile-catch-up-command.ts`: embedding warm-up before a terminal run.
- `src/services/user-profile/user-profile-manager.ts`: step-count filter, workflow matching, neighbour merging, step replacement, and description rewrite.
- Tests for the profile manager and the analysis prompt.
- `docs/` profile guide and a TDR for the finding.
- Existing stored profiles keep their entries. The inflated entry is removed once, by hand, after this change ships (see `tasks.md`, group 5).
- Hosts: the code is shared, so Pi, OpenCode, and Claude Code behave the same.
