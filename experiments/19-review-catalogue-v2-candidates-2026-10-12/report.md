# Experiment 19: catalogue version 2 candidates from observations that fit no label

- **ID**: `19-review-catalogue-v2-candidates-2026-10-12`
- **Category**: review
- **Size**: Quick
- **Status**: FAIL on the frozen count rule, by one label; coverage passes (2026-10-12)
- **Operator**: Dr Muhammad Aizat Md Hawari, with an agent session
- **Related**: [Experiment 18 report](../18-retrieval-fresh-confirmation-all-methods-2026-10-12/report.md); [ADR-024](../../docs/adr/024-review-first-label-assignment.md)

## Answer

- **Question**: Do the 195 no-label observations from Experiment 18 group into a small set of coherent new labels?
- **Answer**: Mostly yes. 147 of 195 (75%) group into 26 candidate labels; 48 stay unassigned. The frozen rule allowed at most 25 labels, so the status is FAIL by one label. Coverage passes its 60% mark. Source: `output/summary.json`.
- **Decision**: The operator accepts or rejects each candidate. Recommended: accept the 15 distinct labels marked Accept, and hold the 11 that are thin or overlap an existing label.
- **How sure**: Medium. One AI agent did the grouping. Several candidates sit close to existing labels, which is the same near-neighbour problem that hurt Experiments 05 to 11.
- **Next step**: Test catalogue version 2 on fresh observations outside Experiment 18's 400 (1,236 remain).
- **Operator decision (2026-10-12)**: accept the 15 recommended labels and hold 11. Catalogue version 2 has 56 labels: `output/catalogue-v2.json`. Experiment 20 tests it.

## Plan (written before the run)

In Experiment 18, 195 of 400 fresh observations fit none of the 41 labels. The labelling agents proposed 204 different new label names for them, many of them near-synonyms. This experiment groups them into a short list of candidate labels for the operator to accept or reject.

- **Question**: Do the 195 no-label observations group into a small set of coherent new labels?
- **Decision**: which new labels join catalogue version 2.
- **Input**: Experiment 18's frozen reference, fresh cases, catalogue and both labelling passes (pins below). Only the 195 cases whose final reference is `none_fit`.
- **Method**: one AI agent session groups the 195 by the user intent each one expresses, using the proposed names as hints. Each candidate label gets an id, a section, a 1 to 2 sentence definition, an exclusion against its nearest existing label, aliases, and its member ids. A group needs at least 3 members. Observations that fit no group stay unassigned.
- **Rules for a candidate label**:
  - It describes a lasting preference or working pattern, not a one-off task or a single project fact.
  - It does not duplicate an existing label. If it overlaps one, the definition must say how they differ.
  - It stays within one section: preferences or patterns.
- **Pass when**: at least 60% of the 195 fall into candidate groups, with no more than 25 candidates in total. Otherwise the no-label observations are too scattered for new labels to help, and that is the finding.
- **Measures**: number of candidates per section; observations covered; group sizes; unassigned count.
- **Check**: `check_candidates.py` validates the agent's file (ids, sections, group size, no observation in two groups) and writes the counts. No model calls.
- **Privacy**: observation text stays in git-ignored `corpus/`. The tracked report holds only label names, definitions and counts.
- **Status rule**: the operator accepts or rejects each candidate. This experiment proposes; it does not change the catalogue. Any later test of catalogue version 2 must use observations outside Experiment 18's 400, because these 195 shaped the candidates.

Input pins (`../18-retrieval-fresh-confirmation-all-methods-2026-10-12/corpus/`):

| File                   | SHA-256                                                            |
| ---------------------- | ------------------------------------------------------------------ |
| `fresh-reference.json` | `906eb69719c245d7727e58ac7fa858f9bf3f083979e9c0c3a06c57d5d3749925` |
| `fresh-cases.json`     | `7d89a84610b5cd9b6ccc24b149c81a2a4e7cc6d9bc8c1b6b6b8d03def391e940` |
| `label-input.json`     | `a2b8f496fdc4c98c8ffcfeb4bb97a76a9572761c3e3e1b9f4a854bb0c670e96b` |
| `label-pass1.json`     | `097457906e455ca325d68a9be19a6501a2e05fdd88b96990328e6a2db965f99e` |
| `label-pass2.json`     | `d0a586a001dcb262e27bbc4b47b0b0d5b9a2f0fb310338350ffd40ff07ca8fc7` |

## Results

| Measure                            | Value                             |
| ---------------------------------- | --------------------------------- |
| No-label observations              | 195 (96 preferences, 99 patterns) |
| Grouped into candidates            | 147 (75.4%)                       |
| Candidate labels                   | 26 (13 preferences, 13 patterns)  |
| Unassigned                         | 48                                |
| Frozen rule: coverage at least 60% | pass                              |
| Frozen rule: at most 25 labels     | fail (26)                         |

Source: `output/summary.json`. The agent merged near-synonyms, for example two spellings of progress check-ins, and dropped two weak groups. Most unassigned observations describe a single project or form pairs.

| Candidate label                        | Members | Definition                                                                                                                                                                                                                                                                                                                         | Recommendation                                                             |
| -------------------------------------- | ------: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `pattern_claim_auditing`               |      11 | Challenge the assistant's claims, plans and earlier statements, and ask it to re-check supposedly finished work, contradictions or external review findings before accepting them. Excludes diagnosing a reported symptom (see pattern_diagnostic_iteration).                                                                      | Accept                                                                     |
| `pattern_blunt_corrections`            |       9 | Correct misread intent, wrong targets or stalled work immediately and bluntly, sometimes with capitals or profanity, then restate what was meant. Excludes short imperative directions for new actions (see pattern_brief_directives).                                                                                             | Accept                                                                     |
| `pattern_incremental_steering`         |       8 | Steer work through many short follow-ups that refine, clarify or reverse requirements and report issues one at a time from hands-on testing. Excludes restart-and-retest loops after configuration reloads (see pattern_restart_iteration).                                                                                        | Accept                                                                     |
| `pattern_gap_spotting`                 |       7 | Notice and report missing, inconsistent or unreliable behaviour in tools and products, such as missing notifications, empty imports, truncated displays or stale docs, and ask for a fix that helps all users. Excludes CI and test reliability (see pattern_ci_quality).                                                          | Accept                                                                     |
| `pattern_tooling_cleanup`              |       6 | Remove unused or superseded tools, clones, caches and agent folders promptly, checking what they hold or consume before deleting. Excludes the lasting preference for pruning obsolete configuration entries (see preference_configuration_hygiene).                                                                               | Accept                                                                     |
| `pattern_verified_evidence`            |       6 | Ask for explicit verified evidence such as fail-before and pass-after tests, measured comparisons, precise citations and per-item pass or fail verdicts, including honest reports of failures. Excludes the lasting preference for measured evidence in decisions (see preference_empirical_evidence).                             | Hold: overlaps preference_empirical_evidence                               |
| `pattern_advisor_consultation`         |       5 | Ask the assistant for its opinion or recommendation at decision points, then make the decision quickly and keep final direction, often answering several choices at once. Excludes questions that build understanding of a concept (see pattern_conceptual_learning).                                                              | Hold: overlaps preference_option_selection and pattern_conceptual_learning |
| `pattern_change_risk_probing`          |       5 | Probe a change or adoption for side effects and rare failure modes, including third-party interference, broken references after renames, dependency drift and local patches lost on update. Excludes bounding scope before work starts (see pattern_scope_management).                                                             | Accept                                                                     |
| `pattern_delegated_execution`          |       5 | Hand off a set plan with short approvals or acknowledgements and expect the assistant to complete the remaining steps without further confirmation. Excludes short imperatives that direct one immediate action (see pattern_brief_directives).                                                                                    | Hold: same intent as preference_autonomous_execution                       |
| `pattern_durable_records`              |       5 | Record decisions, task progress and shared context in durable places such as ADRs, tasks.md, external trackers and the active branch. Excludes handoff prompts for the next agent (see pattern_session_continuity).                                                                                                                | Accept                                                                     |
| `pattern_progress_check_ins`           |       5 | Check in on long-running or background work, asking whether it is finished, what is happening and why it is slow. Excludes the assistant reporting status at checkpoints (see preference_progress_reporting).                                                                                                                      | Hold: overlaps preference_progress_reporting                               |
| `pattern_reference_reuse`              |       4 | Reuse a proven setup from another of the user's projects as the reference baseline and carry patterns and ideas between related repositories. Excludes one canonical convention within a project (see preference_canonical_conventions).                                                                                           | Hold: only 4 members; overlaps preference_canonical_conventions            |
| `pattern_secret_protection`            |       3 | Handle credentials and live resources strictly: keep keys in protected files, never print or commit them, rotate exposed keys and state which resources must stay untouched. Excludes preservation of work and results before cleanup (see preference_data_preservation).                                                          | Hold: only 3 members; same theme as preference_secret_redaction            |
| `preference_git_commit_pr_conventions` |       9 | Make scoped Conventional Commits before moving on and land work through pull requests on the agreed target or integration branch, stacking pull requests and answering review threads as needed. Excludes the routine Git activity pattern (see pattern_git_operations) and release publication (see preference_release_workflow). | Accept                                                                     |
| `preference_precise_ui_requirements`   |       7 | Specify interface behaviour, layout, filters, colour values and theme or locale coverage precisely, and expect those exact requirements to be built and checked. Excludes following existing component patterns (see preference_consistent_ui) and hover explanations (see preference_explanatory_tooltips).                       | Accept                                                                     |
| `preference_automate_manual_steps`     |       6 | Replace repeated manual procedures with automation, reusable skills or commands, and features that run by default, keeping only unavoidable manual gates. Excludes reducing paid or computational cost (see preference_resource_economy).                                                                                          | Accept                                                                     |
| `preference_autonomous_execution`      |       6 | Have the assistant carry delegated or approved work through to completion itself, executing the steps rather than describing them and asking only when a real question blocks progress. Excludes keeping work inside explicit authorisation and agreed scope (see preference_operator_approval).                                   | Accept                                                                     |
| `preference_ci_merge_gates`            |       6 | Require passing CI checks and review before merging, with basic cross-platform coverage run in the CI environment, while allowing slow or blocking jobs to be weighed pragmatically. Excludes the recurring attention to CI reliability and test feedback (see pattern_ci_quality).                                                | Accept                                                                     |
| `preference_finish_within_change`      |       6 | Solve a problem properly and completely inside the current change instead of deferring fixes, applying stopgaps or spreading churn across later changes. Excludes scaling process to change size (see preference_proportionate_process).                                                                                           | Accept                                                                     |
| `preference_organised_project_layout`  |       6 | Keep files and tooling in organised, portable locations: dedicated folders for tests and assets, standard project scaffolding, central shared scripts and global tool installs. Excludes the single source of truth for project information (see preference_canonical_conventions).                                                | Accept                                                                     |
| `preference_quiet_agent_output`        |       5 | Keep agent and tool output compact: hide noisy command dumps, show status with short symbols, avoid truncating useful text, and expose raw detail through expandable views. Excludes general interface consistency with existing components (see preference_consistent_ui).                                                        | Accept                                                                     |
| `preference_direct_answers`            |       4 | Answer directly in the requested shape: clear yes or no, a single word when that is enough, action lists instead of paragraphs, and concrete links instead of directions. Excludes sentence-level prose style (see preference_plain_british_prose).                                                                                | Hold: overlaps preference_plain_british_prose                              |
| `preference_subagent_delegation`       |       4 | Delegate independent, non-overlapping work to narrowly scoped subagents to protect the main context, with controlled concurrency and read-only review lanes. Excludes the recurring coordination of implementation and verification roles (see pattern_agent_orchestration).                                                       | Hold: overlaps pattern_agent_orchestration                                 |
| `preference_established_defaults`      |       3 | Follow upstream or reference defaults and extend existing mechanisms with the simplest workable approach instead of inventing bespoke configuration. Excludes choosing a single canonical project convention (see preference_canonical_conventions).                                                                               | Hold: only 3 members; overlaps preference_canonical_conventions            |
| `preference_option_selection`          |       3 | Receive a candid recommendation with a set of offered options, then decide by picking an option, often the recommended one or by its number. Excludes obtaining explanations before an action is approved (see preference_understand_before_action).                                                                               | Hold: only 3 members; overlaps pattern_advisor_consultation                |
| `preference_secret_redaction`          |       3 | Keep credentials out of output, reports and leftover copies by passing them indirectly through the environment and purging stale plaintext copies. Excludes general preservation of work before deletion (see preference_data_preservation).                                                                                       | Hold: only 3 members; same theme as pattern_secret_protection              |

Recommendations are mine. They are not frozen rules. "Hold" means: keep the observations unassigned for now, and revisit when more examples exist.

## Limits

- One AI agent grouped the observations; nobody checked the groups independently.
- Groups of 3 or 4 members are thin evidence for a lasting label.
- Several candidates mirror each other across sections (for example secret handling as both a preference and a pattern). The preference/pattern split itself creates near-duplicates.
- Adding all 26 would grow the catalogue from 41 to 67 labels. More labels means more near neighbours to confuse.
- These 195 observations shaped the candidates, so they cannot test catalogue version 2.
