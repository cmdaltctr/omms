# Does persistent memory make coding agents better, and at what token cost?

Status: draft for review. This is a research proposal for one paper. It is not an OpenSpec change. Section 11 lists the OMMS changes that need their own OpenSpec proposals.

Date: 2026-11-04

## 1. The paper in one page

**Question.** Does persistent memory give a coding agent better context, so it does better work? What does that cost in tokens?

**What is under test.** The question is about agent memory. OMMS is the system under test. OMMS uses a "digest, then retrieve" design: a model extracts memories after each turn, and embedding retrieval recalls them. The result covers this class of memory in coding agents. One system cannot support a claim about every memory design.

**Two outcomes, in this order.**

1. Effectiveness: does the agent do better work?
2. Token cost: what does the memory add or save, counting its own model calls?

**Two studies, one paper.**

| Study                   | Question                                                                                      | Arms                                                                                                                             |
| ----------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Study 1, project memory | Does memory help on real issues? Does the digest step beat plain retrieval over raw history?  | N no memory, then OMMS (D) and raw-turn retrieval (R), each under three retrieval methods: plain, reranker, hybrid plus reranker |
| Study 2, user memory    | Does a persona learned from corrections carry across projects and cut the corrections needed? | N no memory, M project memory only, P persona, O oracle                                                                          |

**Two harnesses.** Pi, which is open source, and Claude Code. The TokenEconomizer paper names Pi as untested, so a Pi result fills a gap its authors state.

**What is new in this paper.**

1. A controlled test of memory in coding agents, with a no-memory control and cache-aware token cost.
2. The first test of digest against raw retrieval in coding sessions, as far as we know. A recent paper tested this in chat only (arXiv 2610.30755).
3. A user-level memory that crosses projects, tested against project memory.
4. Results on an open-source harness, and a full public release of tasks, transcripts, ledgers and scripts.

The literature search so far is small (section 13). Check these claims with a proper search before you write them.

**What the paper can say under each result.**

| Result                                                  | What the paper says                                                                                                  |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| D beats N on pass rate                                  | Memory improves agent outcomes on independent issues, at a stated token cost.                                        |
| D and N are not distinguishable, recall probes favour D | Memory carries facts forward. On independent issues that does not show up as more tasks solved, at this sample size. |
| R is at least as good as D                              | The digest step does not earn its cost in coding sessions. This extends the chat finding.                            |
| D beats R                                               | Digesting helps in coding, unlike chat.                                                                              |
| P beats M after a project change                        | User memory carries across projects where project memory cannot.                                                     |
| P costs more than it saves                              | Following preferences has a token price. The paper states it, with the oracle arm as the reference.                  |

Each row is publishable. The most likely headline for Study 1 is "no detectable effect on pass rate at this size". Study 1's recall probes and Study 2 show where memory does work. A paper that reports this plainly is stronger than one that hopes for a large gain.

**Honest label.** The public runs are staged work. A script gives the tasks. Study 2 uses a scripted user. The paper must say so.

## 2. What we borrow

**From TokenEconomizer (arXiv 2610.22732), the evaluation method.** It controls the cost of coding agents from outside, and cuts cost by 18.4 to 30.9 percent.

| Part of the paper                                                                        | Our use                                |
| ---------------------------------------------------------------------------------------- | -------------------------------------- |
| SWE-Bench tasks in date order inside each repository                                     | Same.                                  |
| Tasks chosen close together in date, on purpose (xarray median 4 days)                   | Same idea. Section 4 has the rule.     |
| Cache-aware cost: uncached input, cache read and output tokens, each with a price weight | Same, plus a cache-write term.         |
| Helper calls charged to the task that caused them                                        | Same. OMMS capture calls count.        |
| Failed tasks keep their cost in the mean                                                 | Same.                                  |
| Three runs per setting, official grader, Pass@1                                          | Same.                                  |
| Standard deviation over runs, no confidence intervals                                    | We report both.                        |
| Block GitHub so the agent cannot read the fix                                            | Weaker version on a Mac (section 8.5). |
| Micro-skill rule: confirm after 3 tasks with non-overlapping edited files                | Used for the persona (section 6.1).    |

We leave out its controller, tool pruning, failure-loop guard, and its comparison arms (RTK, RepoMap, lower effort). Those are cost-control methods. They answer a different question from "does memory help?", and they would double the run count. Section 12 lists them as later work.

**From the raw-RAG paper (arXiv 2610.30755), the memory comparison.** "Is Complex Agentic Memory Always Needed? Naive RAG Is Stronger Than We Thought".

- It reports that dense retrieval over raw chat history, plus a cross-encoder reranker, beats most agent memory systems on chat benchmarks. It does not test BM25 or hybrid search.
- It also tested digest-like steps on top of raw retrieval. Atomic-fact extraction lowered accuracy by 19.62 points and summaries by 5.81.
- It reports ingestion cost in LLM tokens and hours. It has a full-context arm, and controls at 5,000 tokens.
- It uses 256-token windows with 32 overlap, and reranks 128 candidates to 15. Removing the reranker cost 3.92 points.
- It covers offline conversation only. It has no coding agents and no cache-aware cost.

We take its raw baseline, its retrieval method (dense plus cross-encoder), its window size and its split between coverage and utilisation. **The prior evidence is against digesting, so OMMS may lose to arm R.** That is a finding, and the study is built to report it. These details come from subagent reading. Read the paper yourself before you cite it.

## 3. Hypotheses and tests

**RQ1, effectiveness.** Does memory help the agent do better work than no memory?
**RQ2, cost.** What does memory add or save in tokens?
**RQ3, digest or raw.** Does digest-then-retrieve beat raw retrieval on effectiveness and on cost?
**RQ4, user memory.** Does a persona cut preference violations after a project change, and at what token cost?

| Test                      | Comparison                           | Measure                           | Role                            |
| ------------------------- | ------------------------------------ | --------------------------------- | ------------------------------- |
| H1                        | D against N, in Study 1              | Pass rate per task                | Primary                         |
| H3                        | D against R, in Study 1              | Pass rate per task                | Primary, two-sided              |
| H4                        | P against M, in Study 2, final block | Preferences broken per task       | Primary                         |
| Cost of D against N       | Study 1                              | Paired change in cost             | Estimate with interval, no test |
| Cost of D against R       | Study 1                              | Paired change in cost             | Estimate with interval, no test |
| Cost of P against M and O | Study 2                              | Paired change in cost             | Estimate with interval, no test |
| Recall probes             | D, R, N                              | Correct answers, turns and tokens | Key secondary                   |

**The rule for many comparisons.** There are 6 primary tests: H1, H3 and H4 on each of two harnesses. Apply a Holm correction across the 6. Everything else is an estimate with an interval, or is labelled exploratory.

**The rule when outcomes disagree.** Report H3 per outcome and do not name an overall winner. If D solves more tasks and costs more, the paper says exactly that. The chart of pass rate against cost lets the reader decide.

**What the study can and cannot see.** With 60 tasks and 3 runs, the study can see cost changes of about 10 percent or more. It cannot see pass-rate differences below roughly 8 points. This is a rough estimate. Check it with the pilot variance. A wide interval that includes zero means "not shown". It does not mean "equal". Make no claim that two arms are equal.

## 4. Tasks and repositories

**Source.** SWE-Bench. The official grader runs the tests, so success needs no judge model. Check the dataset licence before release.

**Repositories.** The TokenEconomizer paper uses six. We take five, and drop xarray because only 9 of the paper's 39 xarray tasks are Verified.

| Repository   | Licence (checked 2026-11-04)                                         | Tasks the paper used             |
| ------------ | -------------------------------------------------------------------- | -------------------------------- |
| Django       | BSD-3-Clause                                                         | 40 Verified (earliest 40 of 231) |
| scikit-learn | BSD-3-Clause                                                         | 60 (31 Verified, 29 full split)  |
| SymPy        | BSD-3-Clause style (GitHub shows "unknown" because of bundled parts) | 60 (41 Verified, 19 full split)  |
| Sphinx       | BSD-2-Clause                                                         | 44 Verified                      |
| Matplotlib   | Matplotlib licence (PSF based, permissive)                           | 34 Verified                      |

All five allow redistribution if we keep the copyright notice. The release includes a `NOTICE` file.

**Choosing 12 tasks per repository.** Use the paper's task list for that repository. Take the window of 12 consecutive tasks, in base-commit date order, with the shortest date span. Tasks close in date share more code and conventions, so memory has something to carry. Report each span. Write the list before the pilot.

**Why the list includes full-split tasks.** The paper reports that on Verified tasks alone almost every method passes almost every scikit-learn and SymPy task. A ceiling would hide any gain, so we follow the paper's mix for those two.

**Pilot tasks.** Use Django tasks outside the chosen window. Fix every setting before the main run. Do not change a setting after you see main-run results.

**Recall probes.** Independent issues are a hard test for memory. The probes are the direct test. After task 12 of each sequence, a script writes 3 questions from that run's own earlier tasks:

1. "An earlier task fixed this issue: <title>. Which file did the fix change?" The answer comes from that run's own patch.
2. "Which command runs the tests for <module>?" The answer is a command that worked earlier in that run.
3. "An earlier task hit this error: <message>. What caused it?" Scored by whether the answer names the file from that run's own patch.

The working folder holds no git history, so the agent cannot look these up in commits. It can still search the code, so also measure the turns and tokens it takes. Every arm gets the same templates. Arm N sets the floor.

## 5. Study 1: project memory

### 5.1 Arms

| Arm                   | What it is                                                                                                                                                                                                                        |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| N. No memory          | The harness with no memory system.                                                                                                                                                                                                |
| D. OMMS               | OMMS recall and capture on, with its reranker setting on. A model extracts memories after each task, and dense retrieval plus a cross-encoder reranker recalls them.                                                              |
| R. Raw-turn retrieval | No digest and no chat-model call. A study harness indexes the raw transcripts of earlier tasks and retrieves windows with dense retrieval plus the same cross-encoder reranker (section 8.8). This is the raw-RAG paper's method. |

**All three retrieval methods are live arms.** That makes 7 arms:

| Arm     | Memory      | Retrieval                                                      |
| ------- | ----------- | -------------------------------------------------------------- |
| N       | None        | None                                                           |
| D-P     | OMMS digest | Plain: dense only. This is OMMS's shipped default.             |
| D (D-X) | OMMS digest | Dense plus cross-encoder reranker                              |
| D-H     | OMMS digest | Hybrid: dense plus BM25, then the reranker                     |
| R-P     | Raw windows | Plain: dense only                                              |
| R (R-X) | Raw windows | Dense plus cross-encoder reranker. The raw-RAG paper's method. |
| R-H     | Raw windows | Hybrid: dense plus BM25, then the reranker                     |

In this document, D and R with no suffix mean the reranker arms D-X and R-X. The primary tests in section 3 use these two, because they match the raw-RAG paper. The other four arms are reported with intervals as secondary results.

**Hybrid is defined once, before the run.** BM25 and dense candidates are fused by reciprocal rank fusion with k = 60, then reranked. The raw-RAG paper does not test BM25 or hybrid, so this is our addition.

### 5.2 Fixed settings

| Setting            | Value                                                                                                                           |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| Harness            | Pi 1.4.0 and Claude Code 2.1.318 (installed on 2026-11-04). Pin both. Switch auto-update off.                                   |
| Model              | `claude-sonnet-5-5` on both harnesses. Never an alias.                                                                          |
| Effort             | Medium on both harnesses. The paper uses high.                                                                                  |
| Repeats            | 3 per task and arm. LLM runs cannot be seeded, so a repeat is only a second run.                                                |
| Task prompt        | The issue text plus one fixed instruction.                                                                                      |
| Limits             | The same turn and budget limits for all arms. Record when a run hits one.                                                       |
| Profile learning   | Off (`injectProfile` off), so it adds no uncounted calls or text.                                                               |
| Skill learning     | Off.                                                                                                                            |
| Reranker           | The same model in every arm that uses it (section 5.3).                                                                         |
| Embedding model    | Pinned, and the same in D and R. Record the `similarityThreshold`, because its default depends on the embedder.                 |
| Memory search tool | Off, so memory reaches the agent only by injection. OMMS has no setting for this, so use the harness tool filter (section 8.4). |

A scripted task has one user prompt, so recall happens about once per task. The injected text stays in the prompt for every later step. Its token cost is mostly cache reads.

### 5.3 Retrieval: dense plus cross-encoder reranker in both arms

Arms D and R both use the retrieval method the raw-RAG paper tested: dense retrieval plus a cross-encoder reranker. This tests what that paper said, in coding sessions. It also keeps the arms equal, so D against R tests the digest step alone. Using the reranker in R only would mix two effects: if R won, nobody could say whether the digest or the reranker caused it.

**Settings.**

- The same reranker model and server in both arms. Use Qwen3-Reranker-4B, which the paper uses in one of its settings (section 15, item 7).
- Follow the paper's pool where OMMS allows it: 128 dense candidates, reranked to 15, then packed to the budget in section 5.4. Use the same pool in both arms. Check in the pilot whether OMMS can do this.
- OMMS falls back to its normal order when the reranker times out. So raise `rerankerTimeoutMs` well above the delays seen in the pilot, and log every fallback. Drop no run for this, but report the count per arm.

**What the paper must state.**

1. **This is not OMMS's default.** `rerankerEnabled` defaults to false, and the `memory-reranker` spec makes it opt-in. The study tests OMMS with a setting it already has, and says so.
2. **The delay is outside the question.** Experiment 24 measured a median delay of 2.46 s per prompt and p95 9.52 s, against a product limit of 0.5 s, and it needs a second model server. A batch study can absorb that, but a daily user may not. Report the delay per arm. A result that needs the reranker carries this price.
3. **Our earlier evidence differs.** Experiment 24 found little gain over digested memories (recall@10 from 0.66 to 0.68, p 0.44; a stricter key reached 0.75, p 0.058; validity INCONCLUSIVE). The raw-RAG paper finds 3.92 points in chat. This study measures the reranker's own effect on digested and raw memory: D-P against D, and R-P against R.

### 5.4 Equal budget between D and R

`retrievalMaxTokens` is a cap, not a target. Digested memories are short and rarely fill 2000 tokens. OMMS can also inject nothing, when no memory clears the threshold. Raw windows would fill any cap. Calling that "equal budget" would be false. So:

1. **Run D before R for each repository and harness.** Record D's injected tokens per recall.
2. **Cap R at D's realised amount.** Each raw arm's cap is the mean injected tokens per recall of the digest arm with the same retrieval method, for that repository and harness.
3. **Give R a score cutoff, so it can inject nothing.** Set it by rule on the pilot tasks: the cutoff at which R injects on the same share of recalls as D. This rule looks at no outcome.
4. **Report injected tokens per recall for both arms.** If they still differ, the paper shows it.
5. **Test the full budget offline.** After the main run, rerun retrieval only on the recorded prompts, and report R's coverage at the 2000-token cap. This needs no agent runs.

### 5.5 Runs

| Harness     | Repositories | Tasks   | Arms | Repeats | Runs  |
| ----------- | ------------ | ------- | ---- | ------- | ----- |
| Pi          | 5            | 12 each | 7    | 3       | 1,260 |
| Claude Code | 5            | 12 each | 7    | 3       | 1,260 |

Recall probes add 3 short runs per sequence: 105 sequences per harness, so 315 short runs per harness.

**Rule: compare arms inside one harness.** Pi's base prompt is short, and Claude Code's prompt and tool set are much larger. Each harness has its own arm N. Between harnesses, describe only the relative change from N.

**If the pilot shows this is too expensive.** Cut to Django, scikit-learn and Sphinx on both harnesses (756 runs each). Keep the same repositories on both, so harness differences are not mixed with repository differences. Decide this before the main run, and state it.

## 6. Study 2: user memory, a persona that learns from you

This is the main selling point. Project memory lives in one project. A persona belongs to the person, so it can carry across projects.

### 6.1 What the persona is

A short, readable list of preferences, for example "add a regression test with every fix". It lives in a file such as `user-persona.md`, which you can read, edit and delete from. Each item has the preference text, a state (candidate, confirmed or retired) and its evidence.

Rules, adapted from the paper's micro-skill design:

1. A new preference starts as a candidate. It comes from what the user writes, by the same model step OMMS uses for its profile.
2. It becomes confirmed after support in 3 separate tasks that edit different files.
3. A contradiction retires it. You can also retire or edit it by hand.
4. Only confirmed items are injected, under a token budget. Every injection logs its items and tokens.

This stays review-first. You can see and undo every item, unlike a hidden user model. OMMS already has a user profile, stored apart from project memories (`user-profile-manager.ts`). Read that code first and decide whether to extend or replace it (section 11, item 6).

### 6.2 Arms

| Arm               | What it is                                                                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| N. No memory      | The harness with no memory system.                                                                                                          |
| M. Project memory | OMMS as in Study 1, with no persona. Corrections may be captured as project memories. This is what OMMS does today.                         |
| P. Persona        | Arm M plus the persona.                                                                                                                     |
| O. Oracle         | No memory. All preferences are stated in every task prompt. This is the upper bound on benefit, and the price of always stating everything. |

### 6.3 Protocol

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

In the pilot, run arm N and keep a preference only if the agent breaks it in at least half of the runs. Without that, there is nothing to learn.

**Corrections throughout.** After the agent's first answer on every task, the script checks the rules. For each broken preference it sends one fixed, plain correction, for example "Please add a regression test." The agent answers again. This is how a real user behaves, and all turns count toward cost.

**Crossing projects.** One sequence is 12 tasks over 3 repositories: 4 tasks each from Django, scikit-learn and Sphinx, using the first 4 tasks of each Study 1 window. Each repeat rotates the order, so that every repository appears in the final block:

| Repeat | Block 1 (tasks 1 to 4) | Block 2 (tasks 5 to 8) | Block 3 (tasks 9 to 12) |
| ------ | ---------------------- | ---------------------- | ----------------------- |
| 1      | Django                 | scikit-learn           | Sphinx                  |
| 2      | scikit-learn           | Sphinx                 | Django                  |
| 3      | Sphinx                 | Django                 | scikit-learn            |

OMMS keeps one memory store per project, so arm M starts empty at each new repository. The persona does not.

**Keeping the grading independent.** The persona learns only from the text of the conversation. It never sees the rules or their results. The rules grade the first answer of each task. Check the rules against a hand reading of 20 patches before the main run, and report the agreement.

### 6.4 Measures and tests

- **Primary (H4).** Preferences broken in the first answer per task, in block 3, P against M. Bootstrap over tasks and preferences.
- **Learning curve.** Preferences broken and corrections sent, by task position. M should reset at each project change. P should not.
- **Inside one project.** P against M on tasks 3 and 4. This is the harder comparison, because M can also learn here. Report it next to H4.
- **Share of the possible gain.** (N minus P) divided by (N minus O).
- **Net cost.** Total cost per task, including correction turns, persona tokens and the model calls that build the persona. No direction is assumed. Following a preference such as "add a test" usually costs tokens. The oracle shows what that costs when nothing has to be learned.
- **Safety.** Pass rate per task, by arm.

**A point the paper must state.** M cannot carry across projects, by design. So P beating M in block 3 shows that the persona works and the agent follows it. It does not show that persona items are better memories than project items. The inside-one-project comparison speaks to that.

**Not tested here.** Retirement on contradiction, because the scripted user never changes their mind. Say so.

### 6.5 Runs

12 tasks times 4 arms times 3 repeats is 144 runs per harness, so 288 in all.

**Optional field note.** Randomised weeks on your own sessions, with the persona on or off, measuring how often your next prompt corrects the agent. Release numbers only. One person is a weak sample, so report it as descriptive. The paper does not depend on it.

## 7. Measures

The study evaluates in layers. If the agent does not improve, the lower layers show why.

| Layer              | Question                                                               | Measure                                         |
| ------------------ | ---------------------------------------------------------------------- | ----------------------------------------------- |
| 1. Memory quality  | Can the retriever find the right items?                                | Existing retrieval experiments (`experiments/`) |
| 2. Context quality | Did the injected text hold what the task needed? Did the agent use it? | Coverage, utilisation                           |
| 3. Agent outcome   | Did the agent do better work?                                          | Pass rate, recall probes, preferences broken    |
| 4. Cost            | What did it cost?                                                      | Cache-aware cost per task                       |

**Pass rate per task (primary for Study 1).** The share of a task's 3 runs that pass the official grader. This is Pass@1 with the field's usual meaning.

**Coverage (a proxy).** Does the injected text name a file from the task's gold patch, or a test command that works for it? Also report this per 1,000 injected tokens, because raw windows full of tool output name many files. The agent never sees the gold patch.

**Utilisation (a proxy).** After injection, does the agent read or edit a file named in the injected text? Compare with the rate for files named in text recalled for a different task. Otherwise, a file the agent would touch anyway counts as use. Read 20 cases by hand in the pilot.

**Process measures (explanation only).** Turns per task, tool errors per task, and repeated errors.

**Cost per task.** Add up every model call made for the task:

```text
cost = uncached_input x p_in
     + cache_write    x p_cw
     + cache_read     x p_cr
     + output         x p_out
     (+ the same four terms for OMMS capture calls)
```

- Use the token counts the provider reports. Record the price table and its date.
- Report token counts too. Prices change. Counts do not.
- A failed task keeps its cost in the mean.
- Arm R makes no chat-model call for its index, because embeddings run locally. So D against R shows what the digest costs.

**Analysis.**

1. **Unit.** One task on one harness. Its result is the mean over its 3 runs. Run k of one arm has nothing in common with run k of another, so pair by task.
2. **Cost change.** The mean over tasks of log(cost_arm / cost_N), shown as a percent change. Also report the ratio of total costs, and each repository.
3. **Intervals.** A paired bootstrap over tasks, 10,000 draws. Tasks in one sequence share a memory store, so they are not independent. Say so in the paper, and report the main results leaving out one repository at a time.
4. **Main chart.** Pass rate against cost, per arm and harness.
5. **Order plot.** Pass rate and cost by position in the sequence. If memory helps, the gap should grow. Task 1 has no memory in any arm, so it checks that the arms start level.

Write this plan down before the main run.

## 8. Setting up on your Mac

The commands come from the harness docs and `--help`. No run has tested them. Treat them as the start of the pilot.

### 8.1 What you need

- `ANTHROPIC_API_KEY` exported. It is not set in the shell today. Both harnesses can read it from the environment. Subscription login gets one more test in the pilot (section 15, item 4).
- A built OMMS checkout in a worktree (see `AGENTS.md`). Run `bun run build` first, because the plugin launcher runs the newest copy it finds.
- Docker. Your Mac is Apple silicon, and the SWE-Bench images are built for x86 (section 8.6).
- A local reranker server, one per machine, shared by the runs. Point `rerankerApiUrl` and the raw-turn harness at it. Pin the model.

### 8.2 Folder layout

```text
~/omms-study/
  tasks/                      task lists for pilot, Study 1 and Study 2
  runs/<study>/<harness>/<repo>/<arm>/<repeat>/
    home/                     scratch HOME for this sequence
    work/                     working folder (same path for every task)
    out/<task-id>/            result, transcript copy, patch, ledger rows
  results/                    graded results, tables, plots
  study.env                   pinned versions and the price table
```

### 8.3 Isolating OMMS

OMMS has no variable for its data folder, so a scratch `HOME` per sequence is the simplest full isolation. It gives each sequence its own store and auth token.

- `HOME=<run>/home`.
- A different `webServerPort` per sequence. The default, 4747, is your real app. Stop the server when the sequence ends.
- `OMMS_DISABLE_AUTO_BACKFILL=1`, so your real history cannot enter the study store. `OMMS_DISABLE_UPDATE_CHECK=1`.
- Link the real embedding model cache into the scratch `HOME`. `scripts/run-tests-isolated.sh` shows the method, but it links a separate test cache, so do not copy its path.
- Set a fixed study git identity in the scratch `HOME`. Do not copy your real one.
- In the config: `autoCaptureEnabled: true`, `memoryProvider: openai-chat`, `memoryModel: deepseek-flash`, `memoryApiUrl: https://api.deepseek.com`, and reasoning off through `memoryExtraParams`. Reference the key by file and do not copy it into the run folder. Its cost counts.

### 8.4 Commands

**Pi.**

```bash
cd "$RUN/work" && \
HOME="$RUN/home" PI_CODING_AGENT_DIR="$RUN/pi-agent" PI_CODING_AGENT_SESSION_DIR="$RUN/pi-sessions" \
PI_SKIP_VERSION_CHECK=1 PI_TELEMETRY=0 \
pi --mode json --model "anthropic/$MODEL" --thinking "$EFFORT" \
   -ne -e "$OMMS_CHECKOUT" --no-skills --no-prompt-templates --no-context-files \
   --tools read,bash,edit,write "$TASK_PROMPT"
```

- `--tools` leaves out the OMMS `memory` tool.
- Pi never asks for approval, so the throwaway folder matters.
- Set `cacheWarming` to `off` in `$RUN/pi-agent/settings.json`, or cache-warming entries distort the cost.
- Usage is in the `message_end` events and the session file.
- The `agent_settled` event on stdout appears after OMMS capture has finished. A capture failure is not signalled there, so check `omms.log`.

**Claude Code.**

```bash
cd "$RUN/work" && HOME="$RUN/home" DISABLE_AUTOUPDATER=1 \
claude --bare -p "$TASK_PROMPT" \
  --plugin-dir "$OMMS_CHECKOUT" \
  --model "$MODEL" --effort "$EFFORT" \
  --output-format json --max-turns 40 --max-budget-usd 5 \
  --permission-mode dontAsk \
  --tools "Read,Edit,Bash" --disallowedTools "mcp__omms__memory" \
  --allowedTools "Read,Edit,Bash(python *),Bash(pytest *),Bash(git diff *),Bash(git status *),Bash(grep *),Bash(ls *)"
```

- The numbers and the tool list are examples. Fix them in the pilot.
- Do not use `--dangerously-skip-permissions`.
- Do not use `--no-session-persistence`. OMMS capture and the token counts read the transcript file.
- Leave out `--fallback-model`.
- Claude Code has no whole-run timeout. Use an outside timer, and send SIGINT when it ends.
- `--bare` skips settings hooks and CLAUDE.md. So deliver other hooks through `--plugin-dir` or `--settings`.

Arm N on each harness is the same command without OMMS.

### 8.5 Keeping the answer out of reach

The paper blocks GitHub inside its container. We use four weaker steps:

1. The working folder is a new repository with one commit, so no future commits are in it.
2. No web tools, and a short Bash allow list. Python can still reach the network, so add a pre-tool hook or extension that refuses shell commands naming GitHub, as the paper does.
3. Scan every transcript for `github.com`, `pip download` and similar. Drop any flagged run, in all arms.
4. State in the paper that a model may have seen these issues in training. All arms share this risk, so the arm comparison holds.

A stronger option: a Docker container with a proxy that allows only the model API hosts.

### 8.6 Python environment and grading

Each task needs its own Python version and packages. Without them, `pytest` fails on imports and the agent spends turns on setup. Two options, and the pilot decides:

1. Run the harness inside the task's container image, with the run's `HOME` mounted. This matches the grader.
2. Build a virtual environment per task from the harness install steps.

**What grading is.** The official SWE-Bench grader starts a clean copy of the repository at the task's commit, applies the agent's patch and runs the task's tests. The task passes if the failing tests now pass and the passing tests still pass. No person or AI judge is involved.

**Where to run.** Start on the Mac. The bigger question is the full run, because the agents may also need the x86 task images. The fixed gap alone comes to about 252 hours if Study 1 runs one sequence at a time (210 sequences, 72 minutes each), so it needs parallel runs. Those also load the Mac with the embedder and reranker. If the pilot is too slow, rent an x86 Linux machine for the main run.

Grading on Apple silicon, in the order we suggest:

1. Build arm64 images with the official harness. Check a few tasks against published results.
2. Grade on a rented x86 Linux machine. Only patches and the grader go there.
3. Run x86 images under emulation. Slow, but it works.

### 8.7 One sequence, step by step

A sequence is one repository, one arm and one repeat in Study 1. In Study 2 it is the rotation in section 6.3.

1. Make a run folder with its own scratch `HOME`. Set up the arm's memory, starting empty.
2. For each task, in date order:
   1. Rebuild the working folder from the task's base commit, as a new git repository with one commit and no remote. Keep the path the same within a repository, so OMMS sees one project.
   2. Run the harness headless with the task prompt, in the task's Python environment.
   3. Study 2 only: check the rules, and send the corrections.
   4. Save the result, the transcript and the patch.
   5. Wait for memory to be ready. On Pi, wait for `agent_settled`. On Claude Code, use the capture-idle route (section 11, item 5). For arm R, add the transcript to the index.
   6. In every arm, including N, wait a fixed gap longer than the cache lifetime (for example 6 minutes with the default 5-minute cache). Otherwise arm N runs back to back and gets cache hits that arm D misses. Run several sequences in parallel to hide the wait.
   7. Export the ledger rows.
3. Study 1 only: run the 3 recall probes.
4. Grade every patch in a clean environment.
5. Stop the OMMS web server. Archive the run folder.

### 8.8 The raw-turn arm

The OMMS spec says project memories must not read `skills.db`. So the raw-turn index lives in the study harness, outside the OMMS product, and reads transcripts directly. No OMMS spec changes.

1. **Indexer.** After each task, it reads the transcript and cuts it into 256-token windows with 32 overlap, as in the raw-RAG paper. Raw means raw, so tool output stays in. It embeds the windows with the same pinned model as OMMS. It makes no chat-model call. Write one small reader per harness, and share the index.
2. **Injector.** A thin plugin per harness, at the same point OMMS uses: `before_agent_start` on Pi and `UserPromptSubmit` on Claude Code. It takes dense candidates, reranks them with the cross-encoder, keeps those above the cutoff, packs them to the cap (section 5.4), and adds them in the same kind of wrapper.

Log the injected window ids and tokens in the same ledger format as arm D.

## 9. Controls and threats to validity

| Threat                                  | Control                                                                                    |
| --------------------------------------- | ------------------------------------------------------------------------------------------ |
| Run-to-run variation                    | Three repeats. Paired by task. Report spread.                                              |
| Cache effects                           | Same cache setting. A fixed gap in every arm. Report cache tokens apart from fresh tokens. |
| OMMS capture cost hidden                | Capture calls charged to the task.                                                         |
| Memory missing because capture was slow | The runner waits, and logs the wait.                                                       |
| Tuning on test tasks                    | Separate pilot tasks. Settings frozen before the main run.                                 |
| Model has seen the tasks                | Stated limit. Compare arms, not absolute pass rates.                                       |
| Price changes                           | Store the price table and date. Report token counts.                                       |
| Raw arm given too much or too little    | Budget rule in section 5.4. Cutoff set by rule. Report injected tokens.                    |
| Reranker mixed with the digest effect   | Same reranker and pool in D and R (section 5.3).                                           |
| Reranker timeouts differ by arm         | Raised timeout. Log and report fallbacks per arm.                                          |
| One system stands in for all memory     | State the scope. Do not generalise beyond digest-then-retrieve.                            |
| Independent issues hide a benefit       | Tasks close in date, recall probes, order plot.                                            |
| Scripted user is artificial             | Label it. State what it can and cannot show.                                               |
| Grading rules may be wrong              | Hand check of 20 patches. Rules hidden from the persona.                                   |
| Harness differences                     | Compare inside a harness. Same repositories on both. Report base prompt size.              |
| Real data leaks into the study          | Scratch `HOME`, backfill off, own port.                                                    |

## 10. Staged plan and gates

| Stage            | Content                                                                  | Runs                         | Gate to the next stage                                  |
| ---------------- | ------------------------------------------------------------------------ | ---------------------------- | ------------------------------------------------------- |
| 0. Build         | OMMS items 1 to 5 and 9 with tests, and the raw-turn harness             | none                         | Ledger rows appear on a real session on both harnesses. |
| 1. Pilot         | Django pilot tasks, 8 tasks, arms N, D and R, 2 repeats, on each harness | 48 per harness               | All checks below pass. Cost per run known.              |
| 2. Study 1       | Section 5                                                                | 2,520, plus 630 short probes | Analysis plan frozen before this starts.                |
| 3. Build persona | OMMS items 6 to 8, with tests                                            | none                         | Persona confirms and injects on a test sequence.        |
| 4. Persona pilot | Arm N on pilot tasks, to filter the 10 preferences                       | about 16                     | At least 5 preferences survive the filter.              |
| 5. Study 2       | Section 6                                                                | 288                          | None.                                                   |

Total: about 2,920 full runs plus the short probes. Cost is runs times cost per run, and the cost per run is unknown until the pilot. Do not start stage 2 before you know it.

### Pilot checks (answer each one before stage 2)

1. Do OMMS hooks fire under `claude --bare -p --plugin-dir`? The docs are unclear. If not, drop `--bare` and use the environment variables that switch off user memory and settings. Also test whether subscription login works with `--bare` under a scratch `HOME`.
2. What are the exact usage key names in Claude Code's JSON result? Does `--max-turns` exist in 2.1.318? It does not show in `--help`.
3. Does the transcript `.jsonl` exist under the scratch `HOME` after a headless run?
4. Does capture finish if `claude -p` exits right after the reply?
5. Does OMMS work on Pi 1.4.0? Its docs say tested on 0.86.1. Do `message_end` events carry usage? Is `OMMS_DISABLE_WEB_AUTOSTART` safe, or does recall need the web app?
6. Does OMMS keep one project identity when the folder is rebuilt? The code says yes (`src/services/tags.ts`). Confirm it.
7. Does recall inject anything on task 2 after task 1? How many tokens per recall?
8. Do the tool filters remove the OMMS `memory` tool on both harnesses? Does the bundled skill still tell the agent to call it? If a filter fails, add a setting to OMMS.
9. How much does cost vary between repeats of one task?
10. Which Python environment and grading option works, and how long does grading take?
11. Do the GitHub-blocking hook and the raw-turn injector fire on both harnesses?
12. Do the coverage and utilisation proxies give sensible numbers on 20 cases read by hand?
13. Do the plain and hybrid arms run on both harnesses? Set `keywordBoost` to the same value in all D arms, and record it. Can OMMS use the paper's pool of 128 candidates reranked to 15? Does the chosen reranker run on your Mac, and what delay does it add when sequences run in parallel?
14. Are the recall probes answerable? Does arm N get some wrong, or take visibly longer? If it answers them all cheaply, change the templates before the main run.

## 11. Changes needed in OMMS

Each group needs an OpenSpec proposal before code.

**Change 1, cost ledger (Study 1).**

| #   | Where                                                                                                                                                                  | Change                                                                                                                                                                                               |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Claude Code: `src/importer/claude-conversation.ts`. Pi: `PiSessionEntry` in `src/importer/pi-conversation.ts`.                                                         | Read token usage per turn. Claude Code has `message.usage` in the transcript. Pi has `usage` (input, output, cacheRead, cacheWrite, cost) in the session file.                                       |
| 2   | New ledger store, for example `ledger.db` beside `skills.db`                                                                                                           | One row per turn with no text: hashed ids, model, the four token counts, recalled ids, bytes cut by the budget, arm label. Written whether or not `skillLearning` is on. `skills.db` is not changed. |
| 3   | `src/services/capture-attempt-store.ts`. Pi: `registry.complete()` and `PiAssistantReply` in `src/adapters/pi/provider.ts`.                                            | Keep the token usage of OMMS's own capture calls. Pi drops it today.                                                                                                                                 |
| 4   | `src/importer/claude-hook-context.ts` and `buildRetrievalSection` in `src/core/retrieval.ts`. Pi: at injection, because the recall code returns early outside the TUI. | Log the recalled ids and the bytes cut by the budget.                                                                                                                                                |
| 5   | `src/importer/claude-hook-api.ts` or the web server routes                                                                                                             | Expose `whenClaudeCaptureIdle()` through an HTTP route, so a runner can wait for capture. Today only tests call it.                                                                                  |

**Study-only change, hybrid arm.**

| #   | Where                                                                                          | Change                                                                                                                                                                                       |
| --- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 9   | `src/services/turso/vector-search.ts` and `src/services/retrieval-rerank.ts`, behind a setting | A BM25 index over memory text (for example SQLite FTS5), fused with dense candidates. The keyword boost today matches tags only. Needed for arm D-H. Arm R-H does this in the study harness. |

**Change 2, persona (Study 2).**

| #   | Where                                                                                     | Change                                                                                                                                                     |
| --- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 6   | `src/services/user-profile/` (read first; `injectProfile`, `userProfileAnalysisInterval`) | Decide: extend the profile, or replace it with persona items that have a state and evidence.                                                               |
| 7   | New pure module, with `CONFIG` passed as an argument                                      | Lifecycle rules (section 6.1) and injection under a token budget. Config key `persona.mode`: `off` or `on`. Log the injected ids and tokens to the ledger. |
| 8   | New `user-persona.md` export                                                              | A readable, editable file with review and undo, like skill drafts. Correction events go to the ledger.                                                     |

Host parity (`AGENTS.md`) asks for OpenCode as well. The ledger and persona should reach OpenCode in the same changes, even though the paper does not measure it.

**Notes from reading the code.**

- `turns` in `skills.db` fills only when `skillLearning` is on, so the ledger needs its own store.
- Project memories and `user-prompts.db` must not read `skills.db`. The ledger follows this rule.
- Never log raw prompts or replies in the ledger.

**Study scripts** (runner, raw-turn harness, grader wrapper, analysis) live in a new experiment folder. The next free number is 29. Follow `experiments/AGENTS.md` and `experiments/EXP_README.md`.

## 12. Not in this paper

Left out to keep one clear paper. Each could come later.

- **OpenCode.** Host parity still applies to the code, but the paper measures Pi and Claude Code. In a one-shot run OpenCode may never capture, because capture starts 10 seconds after the reply and shutdown cancels it. It needs `--standalone` for isolation, and possibly a persistent server.
- **TokenEconomizer's comparison arms** (RTK, RepoMap, lower effort), and its tool pruning and failure-loop guard.
- **Weakest-items ablation and a random recall holdout.**
- **Retirement suggestions** for memories and skills that cost more than they save.
- **Skill learning as an arm.**
- **A grader-free success proxy** for natural use. The public runs can validate one later, because they have test results.
- **Raw-turn retrieval as an OMMS feature.** If arm R wins, this is the first follow-up. It needs a spec change.
- **Ideas from TokenEconomizer for OMMS itself:** lifecycle states for project memories, cheap regular-expression detectors, recall triggered by a repeated error, and advice on unused tools.

## 13. Related work and literature status

- TokenEconomizer: arXiv 2610.22732. A reviewer checked the numbers used here against the text. Check them again before you cite them.
- Raw-RAG paper: arXiv 2610.30755. A reviewer checked the numbers used here against a copy of the text. Study 1 depends on it, so read it yourself first.
- Abstracts read only: arXiv 2610.34073 (Memory Tax), 2604.23853 (ClawTrace), 2608.20614 (ACES), 2604.27283 (RSCB-MC).
- The literature search had two queries. It did not cover personalisation or user models for coding agents, which Study 2 needs. Run a proper search (Scopus first, then multi-source) before you write any novelty claim. Add each reference only after its DOI or arXiv record is checked.

## 14. What to release

Task lists, run records, transcripts, results, patches, ledger, grader output, scripts, price table, `NOTICE` with the five licences, the 10 preferences and rules, and the OMMS version used. Study 2's persona is synthetic, so it can be released in full.

Before release:

- Search for personal names, home paths (`/Users/<name>/`), email addresses, API keys and tokens. Replace paths with `~` or a placeholder. Do not edit data files that have recorded checksums without asking.
- Record a SHA-256 checksum for each large archive. Keep a second copy on another device. Large files live in `~/Development/DATA/`, not in git.
- Check the SWE-Bench dataset licence.
- Check the repository's visibility before you upload.

## 15. Decisions

Recorded on 2026-11-04. Items 1 to 3 and 5 can change before the main run, but not after it starts.

| #   | Decision               | Choice                                                                                                                                                | Reason                                                                                                                                                                                                          |
| --- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Model                  | Claude Sonnet 5.5 at medium effort, pinned as `claude-sonnet-5-5`, on both harnesses                                                                  | Cheaper than Opus, and the TokenEconomizer paper also tested a Sonnet model. GLM 5.3 stays out, because a second model would double the runs and its cache token reporting is unchecked. It is good later work. |
| 2   | Capture model          | DeepSeek flash (`deepseek-flash`), with reasoning off through `memoryExtraParams`                                                                     | It is the current OMMS setting, so the study tests the real setup. Earlier timing work stalled on z.ai and ran well on DeepSeek. Add its prices to the price table.                                             |
| 3   | Where to run and grade | Start on the Mac (M5 Pro, 64 GB, 344 GB free). Rent an x86 Linux machine for the main run if the pilot is too slow.                                   | Section 8.6.                                                                                                                                                                                                    |
| 4   | Access and budget      | Use `ANTHROPIC_API_KEY` by default. Retest subscription login with `--bare` in the pilot. Set the spend limit after the pilot gives the cost per run. | `--bare` is documented to ignore login, and an earlier test lost Keychain access under a scratch `HOME`. A subscription limit could stop a run partway, or hit one arm more than another.                       |
| 5   | The preferences        | The 10 in section 6.3                                                                                                                                 | Drafted for this study and approved. The persona pilot filters them.                                                                                                                                            |
| 6   | Ethics                 | Public tasks and your own data need no approval. Volunteer data would, so ask Edinburgh Napier before you collect any.                                | The paper uses no volunteer data.                                                                                                                                                                               |
| 7   | Reranker model         | Qwen3-Reranker-4B                                                                                                                                     | The raw-RAG paper uses it in one of its settings. The pilot checks its speed when sequences run in parallel.                                                                                                    |
