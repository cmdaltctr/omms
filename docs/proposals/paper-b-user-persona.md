# Does a learned user persona carry across projects, and what does it cost?

Status: draft for review. This is the research proposal for Paper B of two. It was split, with Paper A, from the combined proposal now archived at `docs/proposals/archive/agent-memory-study-combined-2026-11-04.md`. It is not an OpenSpec change. Section 11 lists the OMMS changes that need their own OpenSpec proposals. Paper A, the project-memory study, is at `docs/proposals/paper-a-project-memory.md`. Paper B reuses Paper A's harness, cost ledger, repository windows and runner.

Date: 2026-11-04

## 1. The paper in one page

**Question.** Does a persona learned from a user's corrections cut the preference violations a coding agent commits, after a project change where project memory resets? What does the persona cost in tokens?

**What is under test.** A user-level persona: a short, readable, editable file of preferences, each with a state and evidence, learned from what the user writes and injected into the agent's prompt. This is OMMS's design, implemented for the study. The claim covers review-first, file-based personas injected into coding agents.

**Arms.**

| Arm               | What it is                                                                                                                                             |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| N. No memory      | The harness with no memory system.                                                                                                                     |
| M. Project memory | OMMS as in Paper A's primary digest arm (reranker on), with no persona. Corrections may be captured as project memories. This is what OMMS does today. |
| P. Persona        | Arm M plus the persona.                                                                                                                                |
| O. Oracle         | No memory. All surviving preferences are stated in every task prompt. This is the upper bound on benefit, and the price of always stating everything.  |

**What is new in this paper.**

1. The first controlled, quantitative, cross-project evaluation of a learned user-preference file injected into coding agents, with a no-memory control, a project-memory control, an oracle arm, graded preference violations and cache-aware token cost. The wording matters: this is not the first system. VS Code Copilot "memories" already detects preferences during chat and writes them into user-level instruction files that apply across all projects. No evaluation of that mechanism exists, as far as our search shows (2026-11-04, section 13).
2. The persona-against-project-memory control separates the two claims that a combined system confuses: user memory helps where project memory cannot (crossing projects), and must match it where project memory can learn too (inside one project).
3. An oracle arm that prices preference adherence: what it costs to always state everything, against what the persona pays to learn it once.

**Honest label.** The runs are staged work with a scripted user, and the persona is synthetic. The paper must say so. Retirement on contradiction is untested, because the scripted user never changes their mind. Say that too.

## 2. What we borrow

**From TokenEconomizer (arXiv 2610.22732), the lifecycle rule.** Its micro-skills confirm after 3 tasks with non-overlapping edited files. The persona uses the same rule for preferences: a candidate becomes confirmed after support in 3 separate tasks that edit different files.

**From Paper A, the infrastructure.** The harness commands, the scratch-`HOME` isolation, the cache-aware cost ledger, the fixed gap between tasks, the repository windows (first 4 tasks of each of its 16-task windows) and the runner. Section 8 of Paper A is the reference; this document lists only the deltas.

**From SWE-Bench, the tasks.** The official grader gives the safety measure (pass rate per task by arm). Preference adherence is measured by rules over the patch and the final message, written before the pilot and hidden from the persona.

## 3. Hypotheses and tests

**RQ1, cross-project carry.** Does the persona cut preference violations after a project change, where project memory starts empty?
**RQ2, cost.** What does the persona add or save in tokens, counting the corrections, the injected persona text and the model calls that build the persona?

| Test | Comparison                                                           | Measure                                         | Role                            |
| ---- | -------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------- |
| H1   | P against M, in block 3 (the final block, after two project changes) | Preferences broken in the first answer per task | Primary                         |
| E1   | Net cost of P against M and O                                        | Paired change in total cost per task            | Estimate with interval, no test |
| E2   | P against M on tasks 3 and 4 of each block (inside one project)      | Preferences broken in the first answer per task | Secondary                       |
| E3   | Learning curve by task position                                      | Preferences broken and corrections sent         | Secondary                       |
| E4   | Share of the possible gain, (N minus P) / (N minus O)                | Per preference and in total                     | Secondary                       |
| E5   | Safety                                                               | Pass rate per task, by arm                      | Secondary                       |

**The rule for many comparisons.** H1 runs on each of two harnesses. Apply a Holm correction across the 2 tests. Everything else is an estimate with an interval, or is labelled exploratory.

**A point the paper must state.** M cannot carry across projects, by design. So P beating M in block 3 shows that the persona works and the agent follows it. It does not show that persona items are better memories than project items. E2, the inside-one-project comparison, speaks to that.

## 4. Tasks and protocol

**The scripted user.** The 10 preferences are fixed below, each with a rule that decides from the patch or final message whether the agent followed it.

| #   | Preference                                                    | Checked in    |
| --- | ------------------------------------------------------------- | ------------- |
| 1   | Adds a regression test                                        | Patch         |
| 2   | Adds no new dependency                                        | Patch         |
| 3   | Leaves no debug `print` lines                                 | Patch         |
| 4   | Adds no commented-out code                                    | Patch         |
| 5   | Adds no TODO or FIXME                                         | Patch         |
| 6   | Gives each new function a docstring                           | Patch         |
| 7   | Uses British spelling in new comments                         | Patch         |
| 8   | Changes at most 3 non-test files                              | Patch         |
| 9   | Ends the final message with a `Summary:` of at most 3 bullets | Final message |
| 10  | States the test command used, as `Tested with:`               | Final message |

In the pilot, run arm N and keep a preference only if the agent breaks it in at least half of the runs. Without that, there is nothing to learn. Gate: at least 5 of the 10 survive.

**Rule definitions, fixed before the pilot and released with the paper.**

- Preference 1 counts as followed when the patch adds lines to a test file. (Whether the test targets the fixed behaviour is the subject of the hand check in B-5.)
- Preference 6 uses an AST diff: every function or method defined in added lines must have a docstring.
- Preference 7 uses a fixed word list (for example: colour, behaviour, initialise, organise, optimise, analyse, licence, centre, modelling, travelling) checked against American spellings in added comment lines. The list is in the release.
- Preferences 3, 4 and 5 are regex checks over added lines.

**Corrections, exactly once per task.**

1. The agent answers the task prompt. The runner snapshots the patch and the final message of this first answer. The rules grade the snapshot, and only the snapshot.
2. If any preference is broken, the runner sends one bundled correction message, one plain sentence per broken preference, for example: "Please add a regression test. Please give each new function a docstring."
3. The agent answers again. No further corrections, whatever the second answer contains.
4. All turns, both answers and the correction, count toward cost.
5. The official grader sees the final patch, after corrections. The rules see the first answer only. Both facts are stated in the paper.

**Crossing projects.** One sequence is 12 tasks over 3 repositories: 4 tasks each from Django, scikit-learn and Sphinx, using the first 4 tasks of each Paper A window. Each repeat rotates the order, so that every repository appears in the final block:

| Repeat | Block 1 (tasks 1 to 4) | Block 2 (tasks 5 to 8) | Block 3 (tasks 9 to 12) |
| ------ | ---------------------- | ---------------------- | ----------------------- |
| 1      | Django                 | scikit-learn           | Sphinx                  |
| 2      | scikit-learn           | Sphinx                 | Django                  |
| 3      | Sphinx                 | Django                 | scikit-learn            |

OMMS keeps one memory store per project, so arm M starts empty at each new repository. The persona does not.

**Shared tasks with Paper A.** The tasks are the first 4 of Paper A's windows, so they also appear in Paper A under different arms. The analyses are separate and the papers say so. Reusing the windows keeps the harness, ledger and grading identical across both papers.

**Keeping the grading independent.** The persona learns only from the text of the conversation. It never sees the rules or their results. Check the rules against a hand reading of 20 patches before the main run, and report the agreement (pilot check B-5).

## 5. Arms and settings

**Fixed settings.** The same as Paper A section 5.2: Pi 1.4.0 and Claude Code 2.1.318, `claude-sonnet-5-5` at medium effort, profile learning and skill learning off, memory search tool off. Arm M is configured exactly as Paper A's arm D (digest, reranker on), so "project memory" means the same system in both papers.

**The persona.**

1. A new preference starts as a candidate. It comes from what the user writes, by the same model step OMMS uses for its profile. In this study the only user text is the corrections, so the persona learns from corrections alone.
2. It becomes confirmed after support in 3 separate tasks that edit different files.
3. A contradiction retires it. You can also retire or edit it by hand.
4. Only confirmed items are injected, under a token budget. Every injection logs its items and tokens to the ledger.

It lives in a file such as `user-persona.md`, readable, editable and deletable. This stays review-first: you can see and undo every item, unlike a hidden user model.

**Sequencing inside a block.** With 4 tasks per repository and a 3-task confirmation rule, a preference corrected in task 1 of block 1 can confirm during block 1 and inject from block 2 onward. That is the designed behaviour: block 3 measures the steady state, and the learning curve (E3) shows the ramp.

## 6. Runs, cost and schedule

12 tasks times 4 arms times 3 repeats is 144 runs per harness, so 288 in all. The persona pilot adds about 16 arm-N runs.

**Schedule.** Each sequence is 12 tasks with the same fixed cache gap as Paper A, so the gaps alone come to about 29 hours across the 24 sequences if run one at a time. Run sequences in parallel, as in Paper A.

**Sequencing against Paper A.** The build (section 11) depends on Paper A's cost ledger, so it starts after Paper A stage 0. It does not depend on Paper A's main run. The persona build and pilot can overlap Paper A stages 1 and 2; Paper B's main run can follow Paper A's.

Cost is runs times cost per run. Paper A's pilot measures the cost per run; this paper inherits it.

## 7. Measures and analysis

- **Primary (H1).** Preferences broken in the first answer per task, in block 3, P against M. Bootstrap over tasks and preferences.
- **Learning curve (E3).** Preferences broken and corrections sent, by task position. M should reset at each project change. P should not.
- **Inside one project (E2).** P against M on tasks 3 and 4 of each block. This is the harder comparison, because M can also learn here. Report it next to H1.
- **Share of the possible gain (E4).** (N minus P) divided by (N minus O).
- **Net cost (E1).** Total cost per task, including correction turns, persona tokens and the model calls that build the persona. No direction is assumed. Following a preference such as "add a test" usually costs tokens. The oracle shows what that costs when nothing has to be learned.
- **Safety (E5).** Pass rate per task, by arm. A persona that cuts violations but also cuts pass rates is a finding, reported plainly.

**Analysis.** The unit is one task on one harness, paired by task. Intervals by paired bootstrap over tasks, 10,000 draws. Tasks in one sequence share a memory store and a persona, so they are not independent; say so, and report H1 leaving out one repository at a time. Write the analysis plan down before the main run.

## 8. Setup on your Mac

Paper A section 8 is the reference: requirements, folder layout, scratch-`HOME` isolation, commands, GitHub blocking, grading. This section lists only what changes.

- **Runs folder.** `runs/paper-b/...` beside Paper A's, with its own scratch `HOME` per sequence.
- **Corrections runner.** After the first answer, the runner snapshots the patch (`git diff` in the working folder) and the final message, grades them with the rules, and sends the bundled correction. This needs a second turn in a headless run: session resume on Claude Code (`claude -p --resume`) or a continued session on Pi. Pilot check B-1 proves the mechanism on both harnesses before anything else.
- **Persona config.** `persona.mode: on` in the study config, everything else as Paper A section 8.3.
- **Ledger.** Correction events, persona items and injection tokens go to the same ledger format as Paper A (section 11).

## 9. Controls and threats to validity

| Threat                                           | Control                                                                                                    |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| Scripted user is artificial                      | Label it. State what it can and cannot show.                                                               |
| Grading rules may be wrong                       | Hand check of 20 patches (B-5). Rules hidden from the persona. Rule definitions released.                  |
| Persona learns the rules, not the user           | The persona sees only conversation text: corrections phrased as plain sentences, with no rule identifiers. |
| Correction delivery differs by harness           | One bundled message per task, same template on both harnesses. B-1 verifies both.                          |
| M cannot cross projects by design                | Stated as the design, with E2 (inside one project) as the fair comparison of memory quality.               |
| Preferences interact with pass rate              | E5 reports pass rate by arm.                                                                               |
| One round of corrections may understate real use | Stated limit. A real user may correct several times.                                                       |
| Run-to-run variation                             | Three repeats. Paired by task. Report spread.                                                              |
| Cache effects                                    | Same fixed gap as Paper A in every arm, including N and O.                                                 |
| Model has seen the tasks                         | Stated limit. Compare arms, not absolute pass rates.                                                       |
| Harness differences                              | Compare inside a harness. Same repositories on both.                                                       |
| Real data leaks into the study                   | Scratch `HOME`, backfill off, own port, as Paper A.                                                        |

## 10. Staged plan and gates

| Stage            | Content                                                                                                     | Runs     | Gate to the next stage                                                |
| ---------------- | ----------------------------------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------- |
| 0. Build persona | OMMS items 6 to 8, with tests, plus the corrections runner. Depends on Paper A's ledger (its items 1 to 3). | none     | Persona confirms and injects on a test sequence; ledger rows written. |
| 1. Persona pilot | Arm N on pilot tasks, to filter the 10 preferences; rules hand check                                        | about 16 | At least 5 preferences survive the filter. Rules agreement reported.  |
| 2. Main run      | Sections 4 to 7                                                                                             | 288      | Analysis plan frozen before this starts.                              |

### Pilot checks (answer each one before stage 2)

1. **B-1. Correction turn.** Can the runner send a second turn to a headless run on both harnesses (session resume), and does the ledger record its tokens? This is the load-bearing check: without it the protocol does not run.
2. **B-2. Candidate extraction.** Does the persona step create a candidate from a correction message, with evidence pointing at the turn?
3. **B-3. Confirmation.** Does an item confirm after support in 3 tasks editing different files, and stay candidate before that?
4. **B-4. Injection logging.** Does every injection log its items and tokens to the ledger?
5. **B-5. Rules agreement.** Do the 10 rules agree with a hand reading of 20 patches? Report the agreement; fix the rules before the main run if it is below 90 percent.
6. **B-6. Preference filter.** Do at least 5 of the 10 preferences survive arm N breaking them in at least half of pilot runs? If not, rewrite the preferences, not the filter.

## 11. Changes needed in OMMS

Each group needs an OpenSpec proposal before code. The ledger items (Paper A section 11, items 1 to 3) are a prerequisite: the persona logs to it.

| #   | Where                                                                                     | Change                                                                                                                                                   |
| --- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 6   | `src/services/user-profile/` (read first; `injectProfile`, `userProfileAnalysisInterval`) | Decide: extend the profile, or replace it with persona items that have a state and evidence.                                                             |
| 7   | New pure module, with `CONFIG` passed as an argument                                      | Lifecycle rules (section 5) and injection under a token budget. Config key `persona.mode`: `off` or `on`. Log the injected ids and tokens to the ledger. |
| 8   | New `user-persona.md` export                                                              | A readable, editable file with review and undo, like skill drafts. Correction events go to the ledger.                                                   |

Host parity (`AGENTS.md`) asks for OpenCode as well. The persona should reach OpenCode in the same change, even though the paper does not measure it.

**Study scripts** (corrections runner, persona config, analysis) join Paper A's experiment folder. The next free number is 29.

## 12. Not in this paper

- **Retirement on contradiction.** The scripted user never changes their mind. Later work.
- **Learning from patches as well as words.** Inferring preferences from the user's edits, not only their corrections. Later work.
- **Multi-user or team personas.** One persona per user is the unit here.
- **A field study.** The optional field note from the combined proposal (randomised weeks on your own sessions, persona on or off, release numbers only, reported as descriptive) stays optional and outside the paper's claims.
- **Interaction with skill learning.** Skill learning stays off, as in Paper A.

## 13. Related work and literature status

A researcher pass on 2026-11-04 covered personalisation and user models for coding agents (Scopus, arXiv, CrossRef, Semantic Scholar, web). Its conclusion, quoted from the report: "No published work implements the full design: a learned user-preference file with explicit states (candidate, confirmed, retired) and evidence, injected into coding-agent prompts under a token budget, and tested quantitatively across projects against a project-memory arm and an oracle." Re-check before submission; add each reference only after its DOI or arXiv record is resolved.

**The closest prior work, ranked.**

1. **Do Personalized Skills Help Coding Agents?** (arXiv 2608.10319): distils developer-specific skills from real interaction traces and evaluates by replaying sessions with a simulated developer. Finds personalised skills help mainly when preferences appear often and tasks stay related. This is the finding to engage: it predicts that a persona helps in block 3 (repeated preferences, related tasks) and warns against expecting gains on sparse or unrelated work. No state-tracked items, no cross-project transfer test, no project-memory control, no cost accounting.
2. **MultiSessionCollab** (arXiv 2601.02702): benchmark plus memory agents that learn preferences across sessions over coding, writing and problem-solving tasks, with a 19-participant user study. Free-form reflections rather than an editable preference file; no graded cross-repository transfer, no project-memory arm, no cost measure.
3. **CIPHER/PRELUDE** (arXiv 2404.15269; follow-up arXiv 2601.19055, NeurIPS 2025): infers a natural-language description of the user's latent preference from their edits and injects it, keeping it viewable and editable. The closest mechanism match: readable, learned, prompt-injected preference text. It covers summarisation and email writing, with simulated users; no coding agents, no cross-project test.
4. **PersonaAgent** (arXiv 2506.06254, ACL 2026): persona as a per-user system prompt over personalised episodic and semantic memory, for general personal-assistant tasks. No lifecycle states, no evidence trail, no coding tasks.
5. **Me-Agent** (arXiv 2601.20162): two-level user-habit learning for a mobile GUI agent, splitting user-level long-term memory from app-specific memory. The user-versus-app split mirrors persona-versus-project-memory directly. Not a coding agent.
6. **MPCoder** (DOI 10.18653/v1/2024.acl-long.207, ACL 2024): multi-user style adapters for code generation. Training-time personalisation from example code, not preferences learned from corrections and injected into an agent.

**Framing and surveys.** Personalization of Large Language Models: A Survey (arXiv 2411.00027, TMLR) frames the field. MemoryCD (arXiv 2603.25973) supplies cross-domain evidence that user memory should transfer. Model-level personalisation cluster: SpeCoder (DOI 10.1145/3627673.3679071, CIKM 2024), personalised code generation (DOI 10.1145/3540250.3558959, RecSys 2022), Personalised Distillation (DOI 10.18653/v1/2023.emnlp-main.417, EMNLP 2023).

**HCI strand.** Real-Time Personalization in Adaptive IDEs (DOI 10.1145/3314183.3324975, UMAP 2019 Adjunct); configurable AI coding assistants (DOI 10.1145/3803437.3806709); personalised web agents (DOI 10.1145/3696410.3714842, WWW 2025).

**Practice contrast.** VS Code Copilot "memories" documentation (code.visualstudio.com, learn.microsoft.com): automatic preference detection written into user-level instruction files that cross projects, user-reviewable. This is why the paper claims the evaluation, never the mechanism. AGENTS.md-style static instruction files (arXiv 2602.11988) are the hand-written contrast: preferences typed by the user, not learned.

## 14. What to release

The 10 preferences and their rule definitions, the persona files (synthetic, so releasable in full), run records, transcripts, results, patches, ledger, scripts, price table, and the OMMS version used.

Before release, the same steps as Paper A section 14: scrub personal identifiers, record checksums, keep large files in `~/Development/DATA/`, check the SWE-Bench licence, and check repository visibility.

## 15. Decisions

Recorded on 2026-11-04. Items 1 to 3 can change before the main run, but not after it starts.

| #   | Decision         | Choice                                                                                                                 | Reason                                                                     |
| --- | ---------------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 1   | Model and effort | Same as Paper A: `claude-sonnet-5-5` at medium effort, both harnesses                                                  | Comparability with Paper A. Any change applies to both papers.             |
| 2   | Capture model    | Same as Paper A: `deepseek-flash`, reasoning off                                                                       | Same reason.                                                               |
| 3   | The preferences  | The 10 in section 4                                                                                                    | Drafted for this study and approved. The persona pilot filters them (B-6). |
| 4   | Ethics           | Public tasks and your own data need no approval. Volunteer data would, so ask Edinburgh Napier before you collect any. | The paper uses no volunteer data.                                          |
| 5   | Target venue     | IUI or CHI (papers track) primary; ASE or ICSE secondary if the SE framing dominates.                                  | The user makes the final call.                                             |
