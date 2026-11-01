import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * The `/api/skills` routes, the skill settings in the safe Settings save and
 * the skill counts in the import preview (tasks 7.1 to 7.3). Each scenario
 * runs in its own Bun process with its own home folder, so the config file,
 * `skills.db` and the skill folders are private to it.
 */

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const src = (path: string) =>
  JSON.stringify(pathToFileURL(join(import.meta.dir, "../src", path)).href);

const ALPHA = "---\nname: alpha\ndescription: First skill\n---\nAlpha body\n";
const BETA = "---\nname: beta\ndescription: Second skill\n---\nBeta body\n";

interface Setup {
  /** The global config, given the home folder. */
  config?: (home: string) => Record<string, unknown>;
  projectConfig?: Record<string, unknown>;
}

async function scenario(body: string, setup: Setup = {}) {
  const home = mkdtempSync(join(tmpdir(), "omms-skill-routes-"));
  dirs.push(home);
  const skills = join(home, "skills");
  mkdirSync(join(skills, "a"), { recursive: true });
  mkdirSync(join(skills, "b"), { recursive: true });
  writeFileSync(join(skills, "a", "SKILL.md"), ALPHA);
  writeFileSync(join(skills, "b", "SKILL.md"), BETA);
  const project = join(home, "project");
  mkdirSync(join(project, ".opencode"), { recursive: true });
  if (setup.projectConfig) {
    writeFileSync(join(project, ".opencode", "omms.jsonc"), JSON.stringify(setup.projectConfig));
  }
  const configPath = join(home, ".config", "omms", "omms.jsonc");
  mkdirSync(join(home, ".config", "omms"), { recursive: true });
  const config = setup.config?.(home) ?? { skillFolders: [skills] };
  writeFileSync(configPath, `{\n  // kept comment\n${JSON.stringify(config, null, 2).slice(2)}`);
  const script = `
    const { mock } = await import("bun:test");
    const { join } = await import("node:path");
    const { existsSync, readFileSync, writeFileSync } = await import("node:fs");
    const { WebServer } = await import(${src("services/web-server.ts")});
    const { getOrCreateAuthToken } = await import(${src("services/auth-token.ts")});
    const { CONFIG } = await import(${src("config.ts")});
    const { SkillStore, skillsDbPath } = await import(${src("services/skill-learning/store.ts")});
    const token = getOrCreateAuthToken();
    (await import(${src("services/api-tokens.ts")})).importConfigApiToken("network-test-token");
    const home = ${JSON.stringify(home)};
    const configPath = ${JSON.stringify(configPath)};
    const skills = ${JSON.stringify(skills)};
    const alphaPath = join(skills, "a", "SKILL.md");
    const betaPath = join(skills, "b", "SKILL.md");
    const dbPath = skillsDbPath(CONFIG.storagePath);
    const server = new WebServer({ enabled: true, host: "127.0.0.1", port: 4747, directory: ${JSON.stringify(project)} });
    const json = { "content-type": "application/json" };
    const send = (path, method = "GET", body, headers = {}) => server.handleRequest(
      new Request("http://127.0.0.1:4747" + path, { method,
        headers: { "x-omms-token": token, ...(method === "GET" ? {} : json), ...headers },
        body: body === undefined ? undefined : JSON.stringify(body) })
    );
    const call = async (path, method, body, headers) => {
      const response = await send(path, method, body, headers);
      return { status: response.status, body: await response.json() };
    };
    let seq = 0;
    const turn = (skill, path, failed, prompt = "search the docs") => ({
      turnKey: "pi:s1:u" + ++seq, host: "pi", sessionId: "s1", projectTag: null,
      projectName: "demo", provider: null, model: null, createdAt: Date.now() - 60000 + seq,
      prompt, replies: ["done"], redacted: true,
      toolCalls: [{ name: "Bash", input: "ls", outcome: failed ? "error" : "ok", error: null },
        { name: "Read", input: "x", outcome: failed ? "error" : "ok", error: null }],
      skillUses: [{ name: skill, path, method: "read" }],
    });
    const output = await (async () => { ${body} })();
    console.log("RESULT:" + JSON.stringify(output));
  `;
  const scriptPath = join(home, "scenario.mjs");
  writeFileSync(scriptPath, script);
  const proc = Bun.spawn(["bun", "run", scriptPath], {
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      OMMS_LOG_FILE: join(home, "omms.log"),
    },
  });
  const text = await new Response(proc.stdout).text();
  const error = await new Response(proc.stderr).text();
  expect(await proc.exited, error).toBe(0);
  const match = text.match(/RESULT:(.*)$/m);
  if (!match) throw new Error(text + error);
  return { home, skills, result: JSON.parse(match[1]!) };
}

describe("skills routes with recording off", () => {
  it("lists watched skills, folders, stats and proposals without creating skills.db", async () => {
    const { skills, result } = await scenario(`
      const list = await call("/api/skills");
      const folders = await call("/api/skills/folders");
      const stats = await call("/api/skills/stats");
      const proposals = await call("/api/skills/proposals");
      const ideas = await call("/api/skills/ideas", "POST", {});
      const draft = await call("/api/skills/draft", "POST", { skill: "alpha" });
      const past = await call("/api/skills/record-past", "POST", {});
      return { list, folders, stats, proposals, ideas, draft, past, created: existsSync(dbPath) };
    `);
    expect(result.list.status).toBe(200);
    expect(result.list.body.data.recording).toBe(false);
    expect(result.list.body.data.skills.map((s: { name: string }) => s.name)).toEqual([
      "alpha",
      "beta",
    ]);
    expect(result.list.body.data.folders).toEqual([{ path: skills, skills: 2, exists: true }]);
    expect(result.folders.body.data.folders).toEqual([{ path: skills, skills: 2, exists: true }]);
    expect(result.stats.body.data).toEqual({
      turns: 0,
      fileSize: 0,
      recording: false,
      redact: true,
    });
    expect(result.proposals.status).toBe(200);
    expect(result.proposals.body.data.proposals).toEqual([]);
    for (const refused of [result.ideas, result.draft, result.past]) {
      expect(refused.status).toBe(409);
      expect(refused.body).toMatchObject({ success: false, code: "recording-off" });
    }
    expect(result.created).toBe(false);
  });
});

describe("skills routes with recording on", () => {
  const on = {
    config: (home: string) => ({ skillLearning: true, skillFolders: [join(home, "skills")] }),
  };

  it("orders the list by attention with ?order=attention and rejects an unknown order", async () => {
    const { result } = await scenario(
      `
      const store = new SkillStore(dbPath);
      await store.init();
      for (let i = 0; i < 4; i++) await store.insertTurn(turn("alpha", alphaPath, false));
      await store.insertTurn(turn("beta", betaPath, true));
      const names = (r) => r.body.data.skills.map((s) => s.name);
      const byUse = await call("/api/skills");
      const byAttention = await call("/api/skills?order=attention");
      const bad = await call("/api/skills?order=newest");
      return { byUse: names(byUse), byAttention: names(byAttention), attention: byAttention.body.data.skills[0].attention, bad };
    `,
      on
    );
    expect(result.byUse).toEqual(["alpha", "beta"]);
    expect(result.byAttention).toEqual(["beta", "alpha"]);
    expect(result.attention).toBe(0.67);
    expect(result.bad.status).toBe(400);
  });

  it("adds modified and lastAppliedAt to the list and to one skill", async () => {
    const { result } = await scenario(
      `
      const store = new SkillStore(dbPath);
      await store.init();
      const { createProposal, updateProposalState } = await import(${src("services/skill-learning/proposal-store.ts")});
      const draft = (name, skillPath) => ({ kind: "improve", skillName: name, skillPath, baseHash: "h",
        content: "c", diff: "", summary: "", evidenceTurnIds: [] });
      const made = await createProposal(store, draft("alpha", alphaPath), 1000);
      const before = await call("/api/skills");
      await updateProposalState(store, made.id, "applied", 5000, "person");
      const applied = await call("/api/skills");
      const one = await call("/api/skills/skill?path=" + encodeURIComponent(alphaPath));
      await updateProposalState(store, made.id, "undone", 6000);
      const undone = await call("/api/skills");
      const pick = (r, name) => r.body.data.skills.find((s) => s.name === name);
      return { before: pick(before, "alpha"), applied: pick(applied, "alpha"), beta: pick(applied, "beta"),
        one: one.body.data.skill, undone: pick(undone, "alpha") };
    `,
      on
    );
    expect(result.before).toMatchObject({ modified: false, lastAppliedAt: null });
    expect(result.applied).toMatchObject({ modified: true, lastAppliedAt: 5000 });
    expect(result.one).toMatchObject({ modified: true, lastAppliedAt: 5000 });
    expect(result.beta).toMatchObject({ modified: false, lastAppliedAt: null });
    expect(result.undone).toMatchObject({ modified: false, lastAppliedAt: null });
  });

  it("ranks recorded skills, shows one skill with its recent turns, sets the mode and deletes turns", async () => {
    const { result } = await scenario(
      `
      const store = new SkillStore(dbPath);
      await store.init();
      await store.insertTurn(turn("alpha", alphaPath, false, "x".repeat(300)));
      await store.insertTurn(turn("alpha", alphaPath, true));
      const list = await call("/api/skills");
      const one = await call("/api/skills/skill?path=" + encodeURIComponent(alphaPath));
      const missing = await call("/api/skills/skill?path=" + encodeURIComponent("/no/such/SKILL.md"));
      const stats = await call("/api/skills/stats");
      const mode = await call("/api/skills/mode", "POST", { skillPath: alphaPath, mode: "automatic" });
      const badMode = await call("/api/skills/mode", "POST", { skillPath: alphaPath, mode: "sometimes" });
      const unknownSkill = await call("/api/skills/mode", "POST", { skillPath: "/no/such/SKILL.md", mode: "manual" });
      const after = await call("/api/skills");
      const noConfirm = await call("/api/skills/delete-turns", "POST", {});
      const deleted = await call("/api/skills/delete-turns", "POST", { confirm: true });
      const emptied = await call("/api/skills/stats");
      return { list, one, missing, stats, mode, badMode, unknownSkill, after, noConfirm, deleted, emptied };
    `,
      on
    );
    expect(result.list.body.data.recording).toBe(true);
    const alpha = result.list.body.data.skills[0];
    expect(alpha).toMatchObject({ name: "alpha", uses: 2, failedTurns: 1, mode: "manual" });

    expect(result.one.status).toBe(200);
    expect(result.one.body.data.skill).toMatchObject({ name: "alpha", uses: 2, failedTurns: 1 });
    const turns = result.one.body.data.recentTurns;
    expect(turns).toHaveLength(2);
    // Newest first: the failed turn was recorded second.
    expect(turns[0]).toMatchObject({
      host: "pi",
      promptPreview: "search the docs",
      failedToolCalls: 2,
    });
    expect(turns[1].promptPreview).toBe("x".repeat(200));
    expect(turns[1].failedToolCalls).toBe(0);
    expect(typeof turns[0].createdAt).toBe("number");
    expect(result.one.body.data.proposals).toEqual([]);
    expect(result.missing.status).toBe(404);
    expect(result.missing.body.code).toBe("not-found");

    expect(result.stats.body.data.turns).toBe(2);
    expect(result.stats.body.data.fileSize).toBeGreaterThan(0);

    expect(result.mode.status).toBe(200);
    expect(result.badMode.status).toBe(400);
    expect(result.badMode.body.code).toBe("invalid-args");
    expect(result.unknownSkill.status).toBe(404);
    expect(result.after.body.data.skills[0].mode).toBe("automatic");

    expect(result.noConfirm.status).toBe(400);
    expect(result.noConfirm.body.code).toBe("invalid-args");
    expect(result.deleted.status).toBe(200);
    expect(result.deleted.body.data.deleted).toBe(2);
    expect(result.emptied.body.data.turns).toBe(0);
  });

  it("lists, shows, applies, undoes and rejects proposals as a person", async () => {
    const { result } = await scenario(
      `
      const { createProposal } = await import(${src("services/skill-learning/proposal-store.ts")});
      const { hashSkillContent } = await import(${src("services/skill-learning/apply.ts")});
      const store = new SkillStore(dbPath);
      await store.init();
      await store.insertTurn(turn("alpha", alphaPath, true));
      const original = readFileSync(alphaPath, "utf8");
      const draftOf = (content) => ({ kind: "improve", skillName: "alpha", skillPath: alphaPath,
        baseHash: hashSkillContent(readFileSync(alphaPath, "utf8")), content, diff: "-a\\n+b",
        summary: "Better", evidenceTurnIds: [1] });
      const first = await createProposal(store, draftOf(original + "Improved\\n"), Date.now() - 2000);
      const second = await createProposal(store, { ...draftOf("x"), skillName: "beta", skillPath: betaPath }, Date.now() - 1000);
      const all = await call("/api/skills/proposals");
      const pending = await call("/api/skills/proposals?state=pending");
      const applied0 = await call("/api/skills/proposals?state=applied");
      const badState = await call("/api/skills/proposals?state=maybe");
      const byName = await call("/api/skills/proposals?skill=alpha");
      const byPath = await call("/api/skills/proposals?skill=" + encodeURIComponent(betaPath));
      const show = await call("/api/skills/proposals/" + first.id);
      const showMissing = await call("/api/skills/proposals/nope");
      const apply = await call("/api/skills/apply", "POST", { id: first.id });
      const appliedText = readFileSync(alphaPath, "utf8");
      const again = await call("/api/skills/apply", "POST", { id: first.id });
      const undo = await call("/api/skills/undo", "POST", { id: first.id });
      const restored = readFileSync(alphaPath, "utf8") === original;
      const undoAgain = await call("/api/skills/undo", "POST", { id: first.id });
      const reject = await call("/api/skills/reject", "POST", { id: second.id });
      const rejectMissing = await call("/api/skills/reject", "POST", { id: "nope" });
      const noId = await call("/api/skills/apply", "POST", {});
      const third = await createProposal(store, draftOf(original + "Third\\n"), Date.now());
      await call("/api/skills/apply", "POST", { id: third.id });
      writeFileSync(alphaPath, "edited by hand");
      const changed = await call("/api/skills/undo", "POST", { id: third.id });
      return { all, pending, applied0, badState, byName, byPath, show, showMissing, apply, appliedText,
        again, undo, restored, undoAgain, reject, rejectMissing, noId, changed, original };
    `,
      on
    );
    expect(result.all.body.data.proposals).toHaveLength(2);
    expect(result.pending.body.data.proposals).toHaveLength(2);
    expect(result.applied0.body.data.proposals).toEqual([]);
    expect(result.badState.status).toBe(400);
    expect(result.badState.body.code).toBe("invalid-args");
    expect(
      result.byName.body.data.proposals.map((p: { skillName: string }) => p.skillName)
    ).toEqual(["alpha"]);
    expect(
      result.byPath.body.data.proposals.map((p: { skillName: string }) => p.skillName)
    ).toEqual(["beta"]);
    expect(result.show.status).toBe(200);
    expect(result.show.body.data.proposal).toMatchObject({ skillName: "alpha", state: "pending" });
    expect(result.show.body.data.evidence).toEqual([
      expect.objectContaining({ id: 1, host: "pi", failedToolCalls: 2 }),
    ]);
    expect(result.showMissing.status).toBe(404);

    expect(result.apply.status).toBe(200);
    expect(result.apply.body).toMatchObject({ success: true, code: "applied" });
    expect(result.apply.body.data.proposal).toMatchObject({
      state: "applied",
      appliedBy: "person",
    });
    expect(result.appliedText).toBe(result.original + "Improved\n");
    expect(result.again.status).toBe(409);
    expect(result.again.body.code).toBe("not-pending");

    expect(result.undo.status).toBe(200);
    expect(result.undo.body.code).toBe("undone");
    expect(result.undo.body.data.proposal.state).toBe("undone");
    expect(result.restored).toBe(true);
    expect(result.undoAgain.status).toBe(409);
    expect(result.undoAgain.body.code).toBe("not-applied");

    expect(result.reject.status).toBe(200);
    expect(result.reject.body.data.proposal.state).toBe("rejected");
    expect(result.rejectMissing.status).toBe(404);
    expect(result.noId.status).toBe(400);

    // Undo refuses a file changed by hand and shows the content it would restore.
    expect(result.changed.status).toBe(409);
    expect(result.changed.body.code).toBe("changed");
    expect(result.changed.body.savedContent).toBe(result.original);
  });

  it("rolls the file back and answers state-write-failed when the proposal state cannot be saved", async () => {
    const { result } = await scenario(
      `
      const { createProposal } = await import(${src("services/skill-learning/proposal-store.ts")});
      const { hashSkillContent } = await import(${src("services/skill-learning/apply.ts")});
      const store = new SkillStore(dbPath);
      await store.init();
      const original = readFileSync(alphaPath, "utf8");
      const make = () => createProposal(store, { kind: "improve", skillName: "alpha",
        skillPath: alphaPath, baseHash: hashSkillContent(readFileSync(alphaPath, "utf8")),
        content: original + "Improved\\n", diff: "-a\\n+b", summary: "Better",
        evidenceTurnIds: [] }, Date.now());
      const state = async (id) => (await call("/api/skills/proposals/" + id)).body.data.proposal.state;
      const block = () => store.db().then((db) => db.execute(
        "CREATE TRIGGER block_state BEFORE UPDATE OF state ON skill_proposals " +
        "BEGIN SELECT RAISE(ABORT, 'disk full'); END"));
      const unblock = () => store.db().then((db) => db.execute("DROP TRIGGER block_state"));

      const first = await make();
      await block();
      const applyFailed = await call("/api/skills/apply", "POST", { id: first.id });
      const afterApply = { text: readFileSync(alphaPath, "utf8"), state: await state(first.id) };
      await unblock();
      await call("/api/skills/apply", "POST", { id: first.id });
      const appliedText = readFileSync(alphaPath, "utf8");
      await block();
      const undoFailed = await call("/api/skills/undo", "POST", { id: first.id });
      const afterUndo = { text: readFileSync(alphaPath, "utf8"), state: await state(first.id) };
      return { original, applyFailed, afterApply, appliedText, undoFailed, afterUndo };
    `,
      on
    );
    expect(result.applyFailed.status).toBe(500);
    expect(result.applyFailed.body).toMatchObject({ success: false, code: "state-write-failed" });
    expect(JSON.stringify(result.applyFailed.body)).not.toContain("disk full");
    expect(result.afterApply).toEqual({ text: result.original, state: "pending" });
    expect(result.undoFailed.status).toBe(500);
    expect(result.undoFailed.body).toMatchObject({ success: false, code: "state-write-failed" });
    expect(JSON.stringify(result.undoFailed.body)).not.toContain("disk full");
    expect(result.afterUndo).toEqual({ text: result.appliedText, state: "applied" });
  });

  it("drafts through the shared operations and reports the model and name codes", async () => {
    const { result } = await scenario(
      `
      const store = new SkillStore(dbPath);
      await store.init();
      await store.insertTurn(turn("alpha", alphaPath, true));
      return {
        none: await call("/api/skills/draft", "POST", {}),
        unknown: await call("/api/skills/draft", "POST", { skill: "zeta" }),
        noModel: await call("/api/skills/draft", "POST", { skill: "alpha" }),
        notWatched: await call("/api/skills/draft", "POST", { idea: { name: "n", description: "d" }, folder: "/elsewhere" }),
      };
    `,
      on
    );
    expect(result.none.status).toBe(400);
    expect(result.none.body.code).toBe("invalid-args");
    expect(result.unknown.status).toBe(404);
    expect(result.unknown.body.code).toBe("not-found");
    // No external API is set up in this home folder.
    expect(result.noModel.status).toBe(409);
    expect(result.noModel.body.code).toBe("not-configured");
    expect(result.notWatched.status).toBe(400);
    expect(result.notWatched.body.code).toBe("not-watched");
  });

  it("starts Record past turns in the web app's job slot and reports a busy slot as 409", async () => {
    const { result } = await scenario(
      `
      const recordUrl = ${src("importer/record-past-turns.ts")};
      const jobsUrl = ${src("importer/web-import-jobs.ts")};
      const { ImportJobError } = await import(jobsUrl);
      const calls = [];
      mock.module(recordUrl, () => ({
        startRecordPastTurns: async (jobs, cwd, readiness) => {
          calls.push({ jobs, cwd, hasReadiness: Boolean(readiness) });
          if (calls.length > 1) throw new ImportJobError("An import is already running", 409);
          return { id: "group-1", state: "running" };
        },
      }));
      const started = await call("/api/skills/record-past", "POST", {});
      const busy = await call("/api/skills/record-past", "POST", {});
      return { started, busy, sameSlot: calls[0].jobs === server.settingsImportJobs,
        cwd: calls[0].cwd, hasReadiness: calls[0].hasReadiness };
    `,
      on
    );
    expect(result.started.status).toBe(202);
    expect(result.started.body.data.id).toBe("group-1");
    expect(result.sameSlot).toBe(true);
    expect(result.cwd).toEndWith("project");
    expect(result.hasReadiness).toBe(true);
    expect(result.busy.status).toBe(409);
    expect(result.busy.body).toMatchObject({ success: false, code: "busy" });
  });

  it("refuses cross-origin, form, tokenless and unauthenticated network requests", async () => {
    const { result } = await scenario(
      `
      const store = new SkillStore(dbPath);
      await store.init();
      await store.insertTurn(turn("alpha", alphaPath, false));
      const foreign = await send("/api/skills/delete-turns", "POST", { confirm: true }, { origin: "https://example.com" });
      const form = await send("/api/skills/delete-turns", "POST", { confirm: true }, { "content-type": "text/plain" });
      const wrong = await send("/api/skills/delete-turns", "POST", { confirm: true }, { "x-omms-token": "wrong" });
      const network = new WebServer({ enabled: true, host: "0.0.0.0", port: 4747 });
      const remote = await network.handleRequest(new Request("http://127.0.0.1:4747/api/skills/delete-turns",
        { method: "POST", headers: { ...json, "x-omms-token": token }, body: JSON.stringify({ confirm: true }) }));
      return { foreign: foreign.status, form: form.status, wrong: wrong.status, remote: remote.status,
        turns: await store.countTurns() };
    `,
      on
    );
    expect(result.foreign).toBe(403);
    expect(result.form).toBe(415);
    expect(result.wrong).toBe(401);
    expect(result.remote).toBe(401);
    expect(result.turns).toBe(1);
  });
});

describe("skills failure routes", () => {
  const on = {
    config: (home: string) => ({ skillLearning: true, skillFolders: [join(home, "skills")] }),
  };

  it("returns a turn's failed calls and a skill's failure groups, and logs nothing", async () => {
    const { result } = await scenario(
      `
      const store = new SkillStore(dbPath);
      await store.init();
      let seq = 0;
      const fturn = (skill, path, calls, position, at) => ({
        turnKey: "pi:s1:u" + ++seq, host: "pi", sessionId: "s1", projectTag: null,
        projectName: "demo", provider: null, model: null,
        createdAt: at === undefined ? Date.now() - 60000 + seq : at,
        prompt: "do it", replies: ["done"], redacted: true, toolCalls: calls,
        skillUses: [{ name: skill, path, method: "tool",
          ...(position === undefined ? {} : { position }) }],
      });
      await store.insertTurn(fturn("alpha", alphaPath, [
        { name: "Bash", input: "SECRET-INPUT-" + "x".repeat(21_000), outcome: "error", error: "SECRET-ERR boom\\nsecond line" },
        { name: "Read", input: "fine", outcome: "ok", error: null },
        { name: "Grep", input: "g", outcome: "error", error: null },
      ]));
      const turnId = Number((await (await store.db()).get("SELECT id FROM turns"))?.id);
      const failures = await call("/api/skills/turns/" + turnId + "/failures");
      const badId = await call("/api/skills/turns/abc/failures");
      const badEncoding = await call("/api/skills/turns/%E0%A4%A/failures");
      const missing = await call("/api/skills/turns/9999/failures");
      await store.insertTurn(fturn("alpha", alphaPath, [
        { name: "Bash", input: "b2", outcome: "error", error: "SECRET-ERR boom" },
      ], undefined, Date.now()));
      const groups = await call("/api/skills/failures?path=" + encodeURIComponent(alphaPath));
      const betaGroups = await call("/api/skills/failures?path=" + encodeURIComponent(betaPath));
      const noArgs = await call("/api/skills/failures");
      const unknown = await call("/api/skills/failures?path=" + encodeURIComponent("/no/SKILL.md"));
      const logFile = join(home, "omms.log");
      return {
        failures, badId, badEncoding, missing, groups, betaGroups, noArgs, unknown,
        logText: existsSync(logFile) ? readFileSync(logFile, "utf8") : "",
      };
    `,
      on
    );
    expect(result.failures.status).toBe(200);
    const failures = result.failures.body.data.failures;
    expect(failures).toHaveLength(2);
    expect(failures[0]).toMatchObject({
      position: 0,
      name: "Bash",
      inputCut: true,
      // The turn dialog carries the stored error text in full; only the group
      // key uses its first line.
      error: "SECRET-ERR boom\nsecond line",
    });
    expect(failures[0].input).toHaveLength(20_000);
    expect(failures[1]).toMatchObject({ position: 2, name: "Grep", inputCut: false, error: null });
    expect(result.badId.status).toBe(400);
    expect(result.badId.body.code).toBe("invalid-args");
    expect(result.badEncoding.status).toBe(400);
    expect(result.badEncoding.body.code).toBe("invalid-args");
    expect(result.missing.status).toBe(404);
    expect(result.missing.body.code).toBe("not-found");

    const groups = result.groups.body.data.groups;
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({
      name: "Bash",
      errorLine: "SECRET-ERR boom",
      calls: 2,
      turns: 2,
    });
    expect(groups[0].latest).toHaveLength(2);
    expect(groups[0].latest[0]).toMatchObject({ input: "b2", projectName: "demo" });
    expect(groups[1]).toMatchObject({ name: "Grep", errorLine: null, calls: 1 });
    expect(result.betaGroups.status).toBe(200);
    expect(result.betaGroups.body.data.groups).toEqual([]);
    expect(result.noArgs.status).toBe(400);
    expect(result.noArgs.body.code).toBe("invalid-args");
    expect(result.unknown.status).toBe(404);
    // The routes never write stored text to the log.
    expect(result.logText).not.toContain("SECRET-INPUT");
    expect(result.logText).not.toContain("SECRET-ERR");
  });

  it("explains failures through the model and logs only a reason code", async () => {
    const { result } = await scenario(
      `
      const skillModelUrl = ${src("services/skill-learning/skill-model.ts")};
      let toolCalls = 0;
      mock.module(skillModelUrl, () => ({
        skillModel: () => ({ ready: true, callTool: async () => {
          toolCalls += 1;
          return toolCalls === 1
            ? { success: true, data: { summary: "The tool path is wrong", causes: [
                { kind: "skill", explanation: "The skill omits the project root",
                  actions: [" Name the root "] } ] } }
            : { success: false, error: "timeout after 10ms" };
        } }),
      }));
      const store = new SkillStore(dbPath);
      await store.init();
      let seq = 0;
      const fturn = (skill, path, calls) => ({
        turnKey: "pi:s1:u" + ++seq, host: "pi", sessionId: "s1", projectTag: null,
        projectName: "demo", provider: null, model: null, createdAt: Date.now() - 60000 + seq,
        prompt: "PROMPT-SECRET keep out", replies: ["REPLY-SECRET keep out"], redacted: true,
        toolCalls: calls, skillUses: [{ name: skill, path, method: "tool" }],
      });
      await store.insertTurn(fturn("alpha", alphaPath, [
        { name: "Bash", input: "SECRET-INPUT", outcome: "error", error: "SECRET-ERR boom" },
      ]));
      const body = { path: alphaPath };
      const noArgs = await call("/api/skills/explain-failures", "POST", {});
      const unknown = await call("/api/skills/explain-failures", "POST", { path: "/no/SKILL.md" });
      const explained = await call("/api/skills/explain-failures", "POST", body);
      const timedOut = await call("/api/skills/explain-failures", "POST", body);
      const logFile = join(home, "omms.log");
      return {
        noArgs, unknown, explained, timedOut,
        logText: existsSync(logFile) ? readFileSync(logFile, "utf8") : "",
      };
    `,
      on
    );
    expect(result.noArgs.status).toBe(400);
    expect(result.noArgs.body.code).toBe("invalid-args");
    expect(result.unknown.status).toBe(404);
    expect(result.unknown.body.code).toBe("not-found");
    expect(result.explained.status).toBe(200);
    expect(result.explained.body.data.explanation).toEqual({
      summary: "The tool path is wrong",
      causes: [
        {
          kind: "skill",
          explanation: "The skill omits the project root",
          actions: ["Name the root"],
        },
      ],
    });
    expect(result.timedOut.status).toBe(502);
    expect(result.timedOut.body).toMatchObject({ success: false, code: "timeout" });
    // The failure is logged by reason code only, with no stored text.
    expect(result.logText).toContain('"reason":"timeout"');
    expect(result.logText).not.toContain("SECRET-INPUT");
    expect(result.logText).not.toContain("SECRET-ERR");
    expect(result.logText).not.toContain("PROMPT-SECRET");
    expect(result.logText).not.toContain("REPLY-SECRET");
  });

  it("refuses to explain without the external API and without recording", async () => {
    const { result } = await scenario(
      `
      const store = new SkillStore(dbPath);
      await store.init();
      let seq = 0;
      const fturn = (skill, path, calls) => ({
        turnKey: "pi:s1:u" + ++seq, host: "pi", sessionId: "s1", projectTag: null,
        projectName: "demo", provider: null, model: null, createdAt: Date.now() - 60000 + seq,
        prompt: "p", replies: ["r"], redacted: true, toolCalls: calls,
        skillUses: [{ name: skill, path, method: "tool" }],
      });
      await store.insertTurn(fturn("alpha", alphaPath, [
        { name: "Bash", input: "x", outcome: "error", error: "boom" },
      ]));
      return { off: await call("/api/skills/explain-failures", "POST", { path: alphaPath }) };
    `,
      on
    );
    // No external API is set up in this home folder, so nothing is sent.
    expect(result.off.status).toBe(409);
    expect(result.off.body.code).toBe("not-configured");
  });

  it("refuses to explain failures while recording is off and never calls the model", async () => {
    const { result } = await scenario(
      `
      const skillModelUrl = ${src("services/skill-learning/skill-model.ts")};
      let modelCalls = 0;
      mock.module(skillModelUrl, () => ({
        skillModel: () => ({ ready: true, callTool: async () => {
          modelCalls += 1;
          return { success: true, data: { summary: "sent", causes: [] } };
        } }),
      }));
      const store = new SkillStore(dbPath);
      await store.init();
      await store.insertTurn({
        turnKey: "pi:s1:u1", host: "pi", sessionId: "s1", projectTag: null,
        projectName: "demo", provider: null, model: null, createdAt: Date.now() - 60000,
        prompt: "p", replies: ["r"], redacted: true,
        toolCalls: [{ name: "Bash", input: "x", outcome: "error", error: "boom" }],
        skillUses: [{ name: "alpha", path: alphaPath, method: "tool" }],
      });
      const off = await call("/api/skills/explain-failures", "POST", { path: alphaPath });
      return { off, modelCalls };
    `
    );
    expect(result.off.status).toBe(409);
    expect(result.off.body.code).toBe("recording-off");
    expect(result.modelCalls).toBe(0);
  });

  it("gives empty failures without creating skills.db while recording is off", async () => {
    const { result } = await scenario(
      `
      const failures = await call("/api/skills/turns/3/failures");
      const groups = await call("/api/skills/failures?path=" + encodeURIComponent(join(skills, "a", "SKILL.md")));
      return { failures, groups, created: existsSync(dbPath) };
    `
    );
    expect(result.failures.status).toBe(200);
    expect(result.failures.body.data.failures).toEqual([]);
    expect(result.groups.status).toBe(200);
    expect(result.groups.body.data.groups).toEqual([]);
    expect(result.created).toBe(false);
  });
});

describe("skill settings in the safe Settings save", () => {
  it("writes only the changed skill keys and shows them in the settings snapshot", async () => {
    const { home, skills, result } = await scenario(
      `
      const save = async (edits) => {
        const { revision } = await (await send("/api/settings")).json();
        return call("/api/settings", "PATCH", { edits, revision });
      };
      const before = readFileSync(configPath, "utf8");
      const learning = await save({ skillLearning: true });
      const afterLearning = readFileSync(configPath, "utf8");
      const redact = await save({ skillLearningRedact: false });
      const badRedact = await save({ skillLearningRedact: "no" });
      const missing = await save({ skillFolders: [skills, join(home, "no-such-folder")] });
      const relative = await save({ skillFolders: ["relative/folder"] });
      const notList = await save({ skillFolders: "~/skills" });
      const folders = await save({ skillFolders: [join(skills, "a")] });
      const snapshot = (await (await send("/api/settings")).json()).settings;
      const reset = await save({ skillFolders: null });
      const afterReset = readFileSync(configPath, "utf8");
      return { before, learning, afterLearning, redact, badRedact, missing, relative, notList, folders,
        reset, afterReset,
        snapshot: { skillLearning: snapshot.skillLearning, skillLearningRedact: snapshot.skillLearningRedact,
          skillFolders: snapshot.skillFolders },
        text: readFileSync(configPath, "utf8") };
    `,
      { config: () => ({ piModel: "kept-model" }) }
    );
    expect(result.learning.status).toBe(200);
    // Only the changed key is added; the comment and the other key stay as they were.
    expect(result.afterLearning).toContain("// kept comment");
    expect(result.afterLearning).toContain('"piModel": "kept-model"');
    expect(result.afterLearning).toContain('"skillLearning": true');
    expect(result.afterLearning).not.toContain("skillLearningRedact");
    expect(result.afterLearning).not.toContain("skillFolders");
    expect(result.redact.status).toBe(200);
    expect(result.badRedact.status).toBe(400);
    expect(result.missing.status).toBe(400);
    // The message names the missing folder.
    expect(result.missing.body.error).toContain(join(home, "no-such-folder"));
    expect(result.relative.status).toBe(400);
    expect(result.notList.status).toBe(400);
    expect(result.folders.status).toBe(200);
    expect(result.text).toContain('"skillLearningRedact": false');
    expect(result.text).not.toContain("no-such-folder");
    expect(result.snapshot.skillLearning).toMatchObject({ globalValue: true, source: "global" });
    expect(result.snapshot.skillLearningRedact).toMatchObject({ globalValue: false });
    expect(result.snapshot.skillFolders.globalValue).toEqual([join(skills, "a")]);
    // Reset default removes the key, so the default folders apply again.
    expect(result.reset.status).toBe(200);
    expect(result.afterReset).not.toContain("skillFolders");
    expect(result.afterReset).toContain('"skillLearning": true');
  });

  it("lets a project turn skill learning off but never on, and ignores its folders", async () => {
    const { skills, result } = await scenario(
      `return (await (await send("/api/settings")).json()).settings;`,
      {
        config: (home) => ({ skillLearning: false, skillFolders: [join(home, "skills")] }),
        projectConfig: { skillLearning: true, skillFolders: ["/project/skills"] },
      }
    );
    expect(result.skillLearning).toMatchObject({ value: false, source: "global" });
    expect(result.skillFolders).toMatchObject({ value: [skills], source: "global" });
    expect(result.skillLearningRedact).toMatchObject({ value: true, source: "default" });
  });
});

describe("skill turns in the web import and preview", () => {
  it("accepts skipSkills and returns the skill-turn counts in the preview JSON", async () => {
    const [{ WebServer }, { getOrCreateAuthToken }, { SettingsImportJobs }, { CONFIG }] =
      await Promise.all([
        import("../src/services/web-server.js"),
        import("../src/services/auth-token.js"),
        import("../src/importer/web-import-jobs.js"),
        import("../src/config.js"),
      ]);
    const previous = CONFIG.skillLearning;
    CONFIG.skillLearning = true;
    try {
      const seen: Array<{ skipSkills?: boolean; dryRun?: boolean }> = [];
      const jobs = new SettingsImportJobs({
        readiness: async () => ({
          external: { state: "missing-key", provider: "test", model: null },
          opencode: { available: false, models: [] },
          piReader: { available: true },
          claudeCode: {
            available: false,
            defaultRoot: "/tmp",
            defaultRootFound: false,
            modelChoices: [],
          },
        }),
        waitingPrompts: async () => new Set(),
        resolveSelection: async (_token, selection, { host }) => ({
          identity: { host, kind: "pi-folder", realPath: "/fixture", dev: 1, ino: 2 },
          keys: ["same"],
          cutoff: selection.listedAt,
        }),
        runner: async (_host, args) => {
          seen.push({ skipSkills: args.skipSkills, dryRun: args.dryRun });
          return {
            dryRun: true,
            root: "",
            sessionsDiscovered: 1,
            sessionsLoaded: 1,
            sessionsFilteredOut: 0,
            sessionsUnrecognized: 0,
            unitsTotal: 4,
            unitsWouldImport: 0,
            unitsImported: 0,
            unitsAlreadyHandled: 0,
            unitsSkipped: 0,
            unitsFailed: 0,
            projects: [],
            units: [],
            skipReasons: {},
            loadErrors: [],
            unresolvableSessions: [],
            skillTurnsWouldRecord: 3,
            skillTurnsAlreadyRecorded: 1,
          };
        },
      });
      const server = new WebServer({ enabled: true, host: "127.0.0.1", port: 4747 });
      const routes = server as unknown as {
        settingsImportJobs: InstanceType<typeof SettingsImportJobs>;
        handleRequest(request: Request, address: string): Promise<Response>;
      };
      routes.settingsImportJobs = jobs;
      const send = (path: string, method = "GET", body?: unknown) =>
        routes.handleRequest(
          new Request(`http://127.0.0.1:4747${path}`, {
            method,
            headers: { "x-omms-token": getOrCreateAuthToken(), "content-type": "application/json" },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          }),
          "127.0.0.1"
        );
      const request = (options: Record<string, unknown>) => ({
        hosts: [
          {
            host: "pi",
            source: "token",
            selection: { mode: "all", revision: "r", excludedKeys: [], listedAt: 1000 },
          },
        ],
        options,
      });
      const invalid = await send(
        "/api/settings/imports",
        "POST",
        request({ dryRun: true, skipSkills: "yes" })
      );
      expect(invalid.status).toBe(400);
      // Skill turns alone are a valid target while recording is on.
      const started = await send(
        "/api/settings/imports",
        "POST",
        request({ dryRun: true, skipMemories: true, skipProfile: true, skipSkills: false })
      );
      expect(started.status).toBe(202);
      let current: { job: { state: string; summary?: Record<string, number> } };
      do {
        await new Promise((resolve) => setTimeout(resolve, 5));
        current = await (await send("/api/settings/imports/current")).json();
      } while (current.job.state === "running");
      expect(current.job.state).toBe("done");
      expect(current.job.summary).toMatchObject({
        skillTurnsWouldRecord: 3,
        skillTurnsAlreadyRecorded: 1,
      });
      expect(seen).toEqual([{ skipSkills: false, dryRun: true }]);
      // With skill turns skipped too, nothing is left to import.
      const nothing = await send(
        "/api/settings/imports",
        "POST",
        request({ dryRun: true, skipMemories: true, skipProfile: true, skipSkills: true })
      );
      expect(nothing.status).toBe(400);
    } finally {
      CONFIG.skillLearning = previous;
    }
  });
});

describe("skills list routes: paging, activity and history", () => {
  const on = {
    config: (home: string) => ({ skillLearning: true, skillFolders: [join(home, "skills")] }),
  };

  it("pages the turns of one skill and adds turnTotal and 30 daily rows", async () => {
    const { result } = await scenario(
      `
      const store = new SkillStore(dbPath);
      await store.init();
      for (let i = 0; i < 25; i++) await store.insertTurn(turn("alpha", alphaPath, i % 5 === 0));
      const q = "/api/skills/skill?path=" + encodeURIComponent(alphaPath);
      const base = await call(q);
      const paged = await call(q + "&turnLimit=5&turnOffset=10");
      const big = await call(q + "&turnLimit=9999");
      const bad = await call(q + "&turnLimit=abc&turnOffset=-4");
      const zero = await call(q + "&turnLimit=0");
      return { base, paged, big, bad, zero };
    `,
      on
    );
    const data = (r: { body: { data: Record<string, unknown[]> } }) => r.body.data;
    expect(data(result.base).recentTurns).toHaveLength(20);
    expect(data(result.base).turnTotal).toBe(25);
    const daily = data(result.base).daily as { uses: number; failed: number }[];
    expect(daily).toHaveLength(30);
    expect(daily.reduce((n, d) => n + d.uses, 0)).toBe(25);
    expect(daily.reduce((n, d) => n + d.failed, 0)).toBe(5);
    for (const d of daily) expect(d.failed).toBeLessThanOrEqual(d.uses);
    expect(data(result.paged).recentTurns).toHaveLength(5);
    expect(data(result.paged).recentTurns[0].id).toBe(data(result.base).recentTurns[10].id);
    expect(data(result.big).recentTurns).toHaveLength(25);
    expect(result.bad.status).toBe(200);
    expect(data(result.bad).recentTurns).toHaveLength(20);
    expect(result.zero.status).toBe(200);
    expect(data(result.zero).recentTurns).toHaveLength(1);
  });

  it("returns activity with clamped days, zero-fill and top skills", async () => {
    const { result } = await scenario(
      `
      const empty = await call("/api/skills/activity");
      const store = new SkillStore(dbPath);
      await store.init();
      for (let i = 0; i < 3; i++) await store.insertTurn(turn("alpha", alphaPath, i === 0));
      await store.insertTurn(turn("beta", betaPath, false));
      const full = await call("/api/skills/activity?days=7");
      const huge = await call("/api/skills/activity?days=9999");
      const junk = await call("/api/skills/activity?days=abc");
      return { empty, full, huge, junk };
    `,
      on
    );
    expect(result.empty.body.data.days).toHaveLength(30);
    expect(result.empty.body.data.topSkills).toEqual([]);
    expect(result.empty.body.data.totals).toEqual({ uses: 0, failed: 0, activeSkills: 0 });
    expect(result.full.body.data.days).toHaveLength(7);
    expect(result.full.body.data.totals).toEqual({ uses: 4, failed: 1, activeSkills: 2 });
    expect(result.full.body.data.topSkills.map((t: { name: string }) => t.name)).toEqual([
      "alpha",
      "beta",
    ]);
    expect(result.huge.body.data.days).toHaveLength(90);
    expect(result.junk.body.data.days).toHaveLength(30);
  });

  it("returns activity by month and year, a whole month by day, and refuses bad params", async () => {
    const { result } = await scenario(
      `
      const store = new SkillStore(dbPath);
      await store.init();
      await store.insertTurn(turn("alpha", alphaPath, true));
      await store.insertTurn(turn("beta", betaPath, false));
      const plain = await call("/api/skills/activity");
      const month = await call("/api/skills/activity?bucket=month");
      const old = await call("/api/skills/activity?bucket=month&year=2020");
      const junkYear = await call("/api/skills/activity?bucket=month&year=abc");
      const year = await call("/api/skills/activity?bucket=year");
      const leap = await call("/api/skills/activity?bucket=day&month=2024-02");
      const topOne = await call("/api/skills/activity?bucket=month&top=1");
      const topHuge = await call("/api/skills/activity?top=9999");
      const bad = [];
      for (const q of ["bucket=week", "month=2024-13", "month=abc", "month=1969-12"]) {
        bad.push(await call("/api/skills/activity?" + q));
      }
      return { plain, month, old, junkYear, year, leap, topOne, topHuge, bad };
    `,
      on
    );
    const now = new Date();
    const y = now.getUTCFullYear();
    const thisMonth = `${y}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
    const months = (year: number) =>
      Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);
    type Point = { key: string; uses: number; failed: number };
    const keys = (r: { body: { data: { series: Point[] } } }) =>
      r.body.data.series.map((p) => p.key);

    const plain = result.plain.body.data;
    expect(plain.bucket).toBe("day");
    expect(plain.series).toHaveLength(30);
    expect(plain.days.map((d: { day: string }) => d.day)).toEqual(keys(result.plain));
    expect(plain.available).toEqual({ months: [thisMonth], years: [y] });

    expect(result.month.body.data.bucket).toBe("month");
    expect(keys(result.month)).toEqual(months(y));
    expect(result.month.body.data.days).toEqual([]);
    expect(result.month.body.data.totals).toEqual({ uses: 2, failed: 1, activeSkills: 2 });
    expect(keys(result.old)).toEqual(months(2020));
    expect(result.old.body.data.totals).toEqual({ uses: 0, failed: 0, activeSkills: 0 });
    expect(result.old.body.data.topSkills).toEqual([]);
    expect(result.junkYear.status).toBe(200);
    expect(keys(result.junkYear)).toEqual(months(y));

    expect(result.year.body.data.series).toEqual([{ key: String(y), uses: 2, failed: 1 }]);
    expect(result.leap.body.data.series).toHaveLength(29);
    expect(result.leap.body.data.days).toHaveLength(29);
    expect(plain.topTotal).toBe(2);
    expect(result.topOne.body.data.topSkills).toHaveLength(1);
    expect(result.topOne.body.data.topTotal).toBe(2);
    expect(result.topHuge.status).toBe(200);
    expect(result.topHuge.body.data.topSkills).toHaveLength(2);
    for (const r of result.bad) {
      expect(r.status).toBe(400);
      expect(r.body.code).toBe("invalid-args");
    }
  });

  it("returns history, pages it, clamps params and pages proposals with a total", async () => {
    const { result } = await scenario(
      `
      const { createProposal } = await import(${src("services/skill-learning/proposal-store.ts")});
      const { hashSkillContent } = await import(${src("services/skill-learning/apply.ts")});
      const store = new SkillStore(dbPath);
      await store.init();
      const current = readFileSync(alphaPath, "utf8");
      const ids = [];
      for (let i = 0; i < 3; i++) {
        const p = await createProposal(store, { kind: "improve", skillName: "alpha", skillPath: alphaPath,
          baseHash: hashSkillContent(current), content: current + "line " + i + "\\n",
          diff: "@@ -1,1 +1,2 @@\\n x\\n+line " + i, summary: "s" + i, evidenceTurnIds: [] }, 1000 + i);
        ids.push(p.id);
      }
      const q = "/api/skills/history?path=" + encodeURIComponent(alphaPath);
      const before = await call(q);
      const applied = await call("/api/skills/apply", "POST", { id: ids[0] });
      const after = await call(q);
      const paged = await call(q + "&limit=2&offset=1");
      const junk = await call(q + "&limit=zzz&offset=-3");
      const unknown = await call("/api/skills/history?path=" + encodeURIComponent("/no/SKILL.md"));
      const noArgs = await call("/api/skills/history");
      const proposalsAll = await call("/api/skills/proposals");
      const proposalsPage = await call("/api/skills/proposals?limit=2&offset=1");
      const proposalsJunk = await call("/api/skills/proposals?limit=zzz&offset=-1");
      return { before, applied, after, paged, junk, unknown, noArgs, proposalsAll, proposalsPage, proposalsJunk };
    `,
      on
    );
    expect(result.before.body.data.total).toBe(3);
    expect(
      result.before.body.data.entries.every((e: { kind: string }) => e.kind === "created")
    ).toBe(true);
    expect(result.applied.status).toBe(200);
    expect(result.after.body.data.total).toBe(4);
    expect(result.after.body.data.entries[0]).toMatchObject({
      kind: "applied",
      appliedBy: "person",
      canUndo: true,
      laterAppliedCount: 0,
      added: 1,
      removed: 0,
    });
    expect(result.paged.body.data.entries).toHaveLength(2);
    expect(result.paged.body.data.total).toBe(4);
    expect(result.junk.status).toBe(200);
    expect(result.unknown.body.data).toEqual({ total: 0, entries: [] });
    expect(result.noArgs.status).toBe(400);
    expect(result.proposalsAll.body.data.proposals).toHaveLength(3);
    expect(result.proposalsAll.body.data.total).toBe(3);
    // canUndo is true only for the applied proposal; pending ones have nothing to undo.
    expect(
      result.proposalsAll.body.data.proposals.map((p: { state: string; canUndo: boolean }) => [
        p.state,
        p.canUndo,
      ])
    ).toEqual([
      ["pending", false],
      ["pending", false],
      ["applied", true],
    ]);
    expect(result.proposalsPage.body.data.proposals).toHaveLength(2);
    expect(result.proposalsPage.body.data.total).toBe(3);
    expect(result.proposalsJunk.body.data.proposals).toHaveLength(3);
  });

  it("lists summaries without content or diff, and the detail route keeps both", async () => {
    const { result } = await scenario(
      `
      const { createProposal } = await import(${src("services/skill-learning/proposal-store.ts")});
      const { lineDiff } = await import(${src("services/skill-learning/line-diff.ts")});
      const store = new SkillStore(dbPath);
      await store.init();
      const before = "a\\nb\\nc\\n";
      const after = "a\\nB\\nc\\nd\\ne\\n";
      const improve = await createProposal(store, { kind: "improve", skillName: "alpha",
        skillPath: alphaPath, baseHash: "h", content: "SECRET-CONTENT\\n" + after,
        diff: lineDiff(before, after), summary: "Better", evidenceTurnIds: [1] }, 1000);
      const fresh = await createProposal(store, { kind: "new", skillName: "gamma",
        skillPath: join(skills, "gamma", "SKILL.md"), baseHash: null,
        content: "SECRET-NEW\\ntwo\\nthree", diff: null, summary: "A new one", evidenceTurnIds: [] }, 2000);
      const list = await call("/api/skills/proposals");
      const one = await call("/api/skills/skill?path=" + encodeURIComponent(alphaPath));
      const detail = await call("/api/skills/proposals/" + improve.id);
      return { improve, fresh, list, one, detail };
    `,
      on
    );
    const summaryKeys = [
      "added",
      "appliedBy",
      "canUndo",
      "createdAt",
      "draftedBy",
      "evidenceTurnIds",
      "hasDiff",
      "id",
      "kind",
      "removed",
      "skillName",
      "skillPath",
      "state",
      "summary",
      "updatedAt",
    ];
    const listed = result.list.body.data.proposals;
    expect(listed).toHaveLength(2);
    for (const proposal of listed) expect(Object.keys(proposal).sort()).toEqual(summaryKeys);
    // Newest first: the new skill, then the improvement.
    expect(listed[0]).toMatchObject({ id: result.fresh.id, added: 3, removed: 0, hasDiff: false });
    expect(listed[1]).toMatchObject({ id: result.improve.id, added: 3, removed: 1, hasDiff: true });
    expect(JSON.stringify(result.list.body)).not.toContain("SECRET");
    // One skill's proposals in GET /api/skills/skill have the same shape.
    expect(result.one.body.data.proposals).toHaveLength(1);
    expect(Object.keys(result.one.body.data.proposals[0]).sort()).toEqual(summaryKeys);
    expect(JSON.stringify(result.one.body)).not.toContain("SECRET");
    // The detail route still returns the full proposal.
    expect(result.detail.body.data.proposal).toMatchObject({
      id: result.improve.id,
      content: expect.stringContaining("SECRET-CONTENT"),
      diff: expect.stringContaining("+B"),
    });
  });

  it("keeps the proposal list under its size budget as proposals grow (TDR-059)", async () => {
    const { result } = await scenario(
      `
      const { createProposal } = await import(${src("services/skill-learning/proposal-store.ts")});
      const store = new SkillStore(dbPath);
      await store.init();
      // 500 proposals, each with 20 KB of content, a 2 KB diff, a 300-character
      // summary and 30 evidence ids. The full shape is over 10 MB.
      const content = "x".repeat(20_000);
      const diff = "@@ -1,1 +1,1 @@\\n" + "+y".repeat(1000);
      const evidenceTurnIds = Array.from({ length: 30 }, (_, i) => 1000 + i);
      for (let i = 0; i < 500; i++) {
        await createProposal(store, { kind: "improve", skillName: "alpha", skillPath: alphaPath,
          baseHash: "h", content, diff, summary: "s".repeat(300), evidenceTurnIds }, 1000 + i);
      }
      const response = await send("/api/skills/proposals");
      const body = await response.text();
      return { status: response.status, bytes: Buffer.byteLength(body),
        count: JSON.parse(body).data.proposals.length };
    `,
      on
    );
    expect(result.status).toBe(200);
    expect(result.count).toBe(500);
    // About 830 bytes a proposal, so about 415,000. The budget leaves room for field growth.
    expect(result.bytes).toBeLessThan(600_000);
  }, 60_000);
});
