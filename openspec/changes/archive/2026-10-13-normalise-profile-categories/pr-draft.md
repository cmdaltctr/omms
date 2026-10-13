# Local pull request draft

This is a draft only. No pull request has been opened, and no commit or push is authorised by this file.

## Proposed title

fix: preserve workflows and normalise profile categories

## Changes

This branch combines the finished workflow fix (`1b0a6a3`) with the category change.

- Keep unrelated workflows separate, preserve longer step lists, and share the minimum-step prompt rule across hosts.
- Warm embeddings before terminal imports and profile catch-up runs.
- Match preference and pattern categories by a hidden spelling key.
- Store one visible label per key. Prefer an existing label without underscores or hyphens before comparing item counts.
- Preserve capitals in acronyms and proper names. Keep meaningful hyphens when no plain spelling exists.
- Apply the same category rules through creation, learning, manual edits and cleanup saves.
- Share a bounded category list across profile prompts: item counts, most used first, 40 labels per type.
- Add the preview-first `profile-normalise-categories` command with confirmation, dry-run and no-op checks.

Workflow category behaviour, the special `explicit` check and host boundaries stay unchanged. Manual edits to another spelling of an existing key use the selected visible label.

## Verification already run

| Check                               | Observed result                                                  |
| ----------------------------------- | ---------------------------------------------------------------- |
| Focused category and workflow tests | 46 passed                                                        |
| Latest local CI before the import   | Real exit code 0                                                 |
| Package checks                      | Passed                                                           |
| OpenSpec strict validation          | Passed                                                           |
| Live category repair                | 582 items renamed; item order, counts and other fields preserved |
| Web API verification                | Passed; one Communication style label per type, no underscores   |
| Second confirmed repair             | 0 changes; database and changelog unchanged                      |
| Bounded option 2 source check       | No findings within its scope                                     |

The repair retained the pre-repair snapshot. One new changelog entry was added; the configured retention limit expired the oldest entry.

## Measurement awaiting the import

| Stage                                     | Preferences: categories / items | Patterns: categories / items |
| ----------------------------------------- | ------------------------------- | ---------------------------- |
| Before live repair                        | 816 / 822                       | 831 / 838                    |
| After live repair                         | 727 / 822                       | 766 / 838                    |
| After forced OpenCode profile-only import | In progress                     | In progress                  |

The approved import runs with warm embeddings and the saved external model. It preserves project memories. Final results require the real exit code, completed run report and measured counts. No decision-model experiment has started.

## Remaining before submission

- Finish task 7.5 and record the post-import measurement in TDR-042.
- Fix the reserved `explicit` label defect reported by static verification, with failing regressions before implementation. See `verification-notes.md`.
- Finish assessing the implementation/spec verification findings after the import.
- Finish OpenSpec verification and archive only when its checks pass.
- Run the required local CI gate before a separately authorised push, after every import has stopped.
- Obtain explicit approval for commits, push and pull request creation.

The user requested no further security scans. Existing repo-wide scanner findings remain in `risks.md`; this draft does not declare them resolved or claim a complete security audit.
