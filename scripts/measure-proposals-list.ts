/**
 * Measures how the skill proposal list reads grow with the number of
 * proposals (issue #192, TDR-059). It uses synthetic data only.
 *
 * Usage: bun scripts/measure-proposals-list.ts [--sizes 100,1000,5000] [--runs 5]
 *
 * The script starts itself again with HOME set to a new temporary folder,
 * because Bun reads the home folder once at process start. The child never
 * opens ~/.omms. The parent removes the temporary folder at the end.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";

const HOME_ENV = "OMMS_MEASURE_HOME";
const RSS_ENV = "OMMS_MEASURE_RSS_DB";

function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(name);
  return at >= 0 ? (process.argv[at + 1] ?? fallback) : fallback;
}

const SIZES = arg("--sizes", "100,1000,5000").split(",").map(Number);
const RUNS = Number(arg("--runs", "5"));
const SKILLS = 30;

if (!process.env[HOME_ENV]) {
  const home = mkdtempSync(join(tmpdir(), "omms-measure-home-"));
  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    [HOME_ENV]: home,
    OMMS_LOG_FILE: join(home, "omms.log"),
  };
  const child = spawnSync(process.execPath, [import.meta.path, ...process.argv.slice(2)], {
    env,
    stdio: "inherit",
  });
  rmSync(home, { recursive: true, force: true });
  process.exit(child.status ?? 1);
}

if (homedir() !== process.env[HOME_ENV]) {
  throw new Error("The home folder is not the temporary one; refusing to run");
}

// Load OMMS modules only in the child, after the home check.
const { CONFIG } = await import("../src/config.js");
const { SkillStore, skillsDbPath } = await import("../src/services/skill-learning/store.js");
const proposalStore = await import("../src/services/skill-learning/proposal-store.js");
const { skillHistory, withCanUndo } = await import("../src/services/skill-learning/history.js");
const { routeSkills } = await import("../src/services/skill-routes.js");
const { createProposal, updateProposalState, saveSkillVersion } = proposalStore;
/** The list query before phase 1 (`listProposals`, now removed): every column of every proposal. */
const listAllColumns = async (store: Store) =>
  (await store.db()).all("SELECT * FROM skill_proposals ORDER BY created_at DESC, rowid DESC");
const { listProposalSummaries } =
  await import("../src/services/skill-learning/proposal-summaries.js");
type Store = InstanceType<typeof SkillStore>;

if (process.env[RSS_ENV]) {
  // Isolated memory probe: open an existing file and run case 1 once.
  CONFIG.storagePath = dirname(process.env[RSS_ENV]);
  const store = new SkillStore(process.env[RSS_ENV]);
  await store.existingDb();
  Bun.gc(true);
  const before = process.memoryUsage().rss;
  const list = await listAllColumns(store);
  const after = process.memoryUsage().rss;
  const peakKb = process.resourceUsage().maxRSS;
  console.log(JSON.stringify({ rows: list.length, before, after, peak: peakKb * 1024 }));
  process.exit(0);
}

// Deterministic pseudo-random numbers (mulberry32), so every run seeds the same data.
let seed = 192;
function random(): number {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const between = (min: number, max: number) => Math.floor(min + random() * (max - min + 1));

const WORDS =
  "skill agent tool call test build check file path config memory store proposal diff line review apply undo version folder the a to of and run with when before after".split(
    " "
  );

function prose(bytes: number, prefix = (): string => ""): string {
  const lines: string[] = [];
  let size = 0;
  while (size < bytes) {
    const words = Array.from({ length: between(6, 14) }, () => WORDS[between(0, WORDS.length - 1)]);
    const line = `${prefix()}${words.join(" ")}`;
    lines.push(line);
    size += line.length + 1;
  }
  return lines.join("\n");
}

function diffText(bytes: number): string {
  let n = 0;
  return prose(bytes, () => {
    n++;
    if (n % 12 === 1) return `@@ -${n},7 +${n},8 @@\n `;
    return [" ", "+", "-"][between(0, 2)]!;
  });
}

/** Skill i gets weight 1/(i+1), so a few skills hold most proposals, as in real use. */
function pickSkill(): number {
  const total = Array.from({ length: SKILLS }, (_, i) => 1 / (i + 1)).reduce((a, b) => a + b);
  let r = random() * total;
  for (let i = 0; i < SKILLS; i++) {
    r -= 1 / (i + 1);
    if (r <= 0) return i;
  }
  return SKILLS - 1;
}

function pickState(): "pending" | "applied" | "rejected" | "undone" {
  const r = random();
  if (r < 0.3) return "pending";
  if (r < 0.65) return "applied";
  return r < 0.9 ? "rejected" : "undone";
}

async function seedStore(n: number, root: string) {
  const storage = join(root, "data");
  const skillsDir = join(root, "skills");
  mkdirSync(storage, { recursive: true });
  // The connection manager opens only files inside storagePath.
  CONFIG.storagePath = storage;
  CONFIG.skillFolders = [skillsDir];
  const paths: string[] = [];
  const hashes: string[] = [];
  for (let i = 0; i < SKILLS; i++) {
    const dir = join(skillsDir, `skill-${String(i).padStart(2, "0")}`);
    mkdirSync(dir, { recursive: true });
    const body = `---\nname: skill-${i}\n---\n${prose(8000)}\n`;
    writeFileSync(join(dir, "SKILL.md"), body);
    paths.push(join(dir, "SKILL.md"));
    hashes.push(createHash("sha256").update(body).digest("hex"));
  }
  const store = new SkillStore(skillsDbPath(storage));
  await store.init();
  const counts = new Array<number>(SKILLS).fill(0);
  const started = performance.now();
  for (let i = 0; i < n; i++) {
    const skill = pickSkill();
    counts[skill]!++;
    const createdAt = 1_700_000_000_000 + i * 60_000;
    const proposal = await createProposal(
      store,
      {
        kind: "improve",
        skillName: `skill-${skill}`,
        skillPath: paths[skill]!,
        baseHash: createHash("sha256").update(String(i)).digest("hex"),
        content: prose(between(4096, 24576)),
        diff: diffText(between(1024, 6144)),
        summary: prose(between(280, 320)).replace(/\n/g, " "),
        evidenceTurnIds: Array.from({ length: between(5, 30) }, () => between(1, 50_000)),
      },
      createdAt
    );
    const state = pickState();
    if (state === "pending") continue;
    const appliedBy =
      state === "applied" ? (["person", "agent"] as const)[between(0, 1)] : undefined;
    await updateProposalState(store, proposal.id, state, createdAt + 30_000, appliedBy);
    if (state === "applied" || state === "undone") {
      // Every version holds the current file hash, so canUndo does its full check.
      await saveSkillVersion(
        store,
        {
          proposalId: proposal.id,
          path: paths[skill]!,
          previousContent: prose(between(4096, 24576)),
          writtenHash: hashes[skill]!,
        },
        createdAt + 30_000
      );
    }
  }
  const busiest = counts.indexOf(Math.max(...counts));
  return {
    store,
    storage,
    skillsDir,
    busiestPath: paths[busiest]!,
    busiestCount: counts[busiest]!,
    seedMs: performance.now() - started,
  };
}

interface Result {
  n: number;
  case: string;
  medianMs: number;
  maxMs: number;
  bytes: number;
}
const results: Result[] = [];

async function measure(n: number, label: string, fn: () => Promise<unknown>): Promise<unknown> {
  let value = await fn(); // warm-up run, not counted
  const times: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const t = performance.now();
    value = await fn();
    times.push(performance.now() - t);
  }
  times.sort((a, b) => a - b);
  results.push({
    n,
    case: label,
    medianMs: times[Math.floor(times.length / 2)]!,
    maxMs: times[times.length - 1]!,
    bytes: Buffer.byteLength(JSON.stringify(value)),
  });
  return value;
}

const SMALL = `id, kind, skill_name, skill_path, base_hash, summary, evidence_turn_ids, state,
  applied_by, drafted_by, created_at, updated_at`;
const ORDER = "ORDER BY created_at DESC, rowid DESC";

/** The proposal shape a summary-only list would send. */
function summaryOf(p: Record<string, any>) {
  let added = 0;
  let removed = 0;
  for (const line of String(p.diff ?? "").split("\n")) {
    if (line.startsWith("@@")) continue;
    if (line.startsWith("+")) added++;
    else if (line.startsWith("-")) removed++;
  }
  return {
    id: p.id,
    kind: p.kind,
    skillName: p.skillName,
    skillPath: p.skillPath,
    state: p.state,
    appliedBy: p.appliedBy,
    draftedBy: p.draftedBy,
    summary: p.summary,
    evidenceTurnIds: p.evidenceTurnIds,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    added,
    removed,
    hasDiff: p.diff !== null,
    canUndo: p.canUndo,
  };
}

const LATEST_VERSIONS = `SELECT v.proposal_id, v.path, v.written_hash FROM skill_versions v
  JOIN (SELECT MAX(id) AS id FROM skill_versions
        WHERE proposal_id IN (SELECT value FROM json_each(?)) GROUP BY proposal_id) m ON v.id = m.id`;

function fileHash(path: string): string | null {
  try {
    return createHash("sha256").update(readFileSync(path)).digest("hex");
  } catch {
    return null;
  }
}

/**
 * A throwaway prototype of a summary list, not production code: small columns
 * plus diff, one batched version lookup, and one file hash per applied proposal.
 */
async function summaryListPrototype(db: Awaited<ReturnType<Store["db"]>>) {
  const rows = await db.all(`SELECT ${SMALL}, diff FROM skill_proposals ${ORDER}`);
  const applied = rows.filter((r) => r.state === "applied").map((r) => String(r.id));
  const versions = await db.all(LATEST_VERSIONS, [JSON.stringify(applied)]);
  const byId = new Map(versions.map((v) => [String(v.proposal_id), v]));
  return rows.map((r) => {
    const v = byId.get(String(r.id));
    return summaryOf({
      id: r.id,
      kind: r.kind,
      skillName: r.skill_name,
      skillPath: r.skill_path,
      state: r.state,
      appliedBy: r.applied_by,
      draftedBy: r.drafted_by,
      summary: r.summary,
      evidenceTurnIds: JSON.parse(String(r.evidence_turn_ids)),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      diff: r.diff,
      canUndo: v !== undefined && fileHash(String(v.path)) === v.written_hash,
    });
  });
}

async function queryPlans(db: Awaited<ReturnType<Store["db"]>>): Promise<string[]> {
  const queries = [
    "SELECT * FROM skill_versions WHERE proposal_id = 'x' ORDER BY id DESC LIMIT 1",
    `SELECT ${SMALL} FROM skill_proposals ${ORDER} LIMIT 5`,
    `SELECT * FROM skill_proposals WHERE skill_path = 'x' ${ORDER}`,
  ];
  const plans: string[] = [];
  for (const sql of queries) {
    const rows = await db.all(`EXPLAIN QUERY PLAN ${sql}`);
    plans.push(`plan [${sql.replace(/\s+/g, " ")}]: ${rows.map((r) => r.detail).join("; ")}`);
  }
  return plans;
}

async function overflowCase(n: number, store: Store) {
  const db = await store.db();
  await db.execute(`CREATE TABLE m_large_first AS SELECT id, proposed_content, diff, kind,
    skill_name, skill_path, state, summary, created_at FROM skill_proposals`);
  await db.execute(`CREATE TABLE m_small_first AS SELECT id, kind, skill_name, skill_path,
    state, summary, created_at, proposed_content, diff FROM skill_proposals`);
  await db.execute(`CREATE TABLE m_small_only AS SELECT id, kind, skill_name, skill_path,
    state, summary, created_at FROM skill_proposals`);
  for (const table of ["skill_proposals", "m_large_first", "m_small_first", "m_small_only"]) {
    await measure(n, `6 overflow: ${table}`, () =>
      db.all(`SELECT id, state, summary, created_at FROM ${table} ORDER BY created_at DESC`)
    );
  }
  const page = await db.get("PRAGMA page_size");
  return Number(page?.page_size);
}

function rssProbe(dbPath: string) {
  const child = spawnSync(process.execPath, [import.meta.path], {
    env: { ...process.env, [RSS_ENV]: dbPath },
    encoding: "utf8",
  });
  if (child.status !== 0) return `RSS probe failed: ${child.stderr.trim()}`;
  const r = JSON.parse(child.stdout.trim()) as Record<string, number>;
  const mb = (bytes: number) => (bytes / 1024 / 1024).toFixed(1);
  return `rows ${r.rows}; RSS before ${mb(r.before!)} MB, after ${mb(r.after!)} MB, peak ${mb(r.peak!)} MB`;
}

const notes: string[] = [];
for (const n of SIZES) {
  const root = join(homedir(), `n${n}`);
  const seeded = await seedStore(n, root);
  const { store } = seeded;
  const deps = { store, folders: [seeded.skillsDir] };
  const db = await store.db();

  await measure(n, "1 old list query (SELECT *)", () => listAllColumns(store));
  await measure(n, "2 small columns", () =>
    db.all(`SELECT ${SMALL} FROM skill_proposals ${ORDER}`)
  );
  await measure(n, "2b small columns + diff", () =>
    db.all(`SELECT ${SMALL}, diff FROM skill_proposals ${ORDER}`)
  );
  await measure(n, "3 small columns LIMIT 5", () =>
    db.all(`SELECT ${SMALL} FROM skill_proposals ${ORDER} LIMIT 5`)
  );
  await measure(n, "4 skillHistory busiest, page 20", () =>
    skillHistory(deps, { path: seeded.busiestPath }, 20, 0)
  );
  // The path GET /api/skills/skill takes: summaries, then one batched canUndo.
  const skillProposals = async () =>
    withCanUndo(
      deps,
      (await listProposalSummaries(store, { skillPath: seeded.busiestPath })).proposals
    );
  await measure(n, "4b skill detail proposals busiest", skillProposals);
  const ctx = { cwd: root, startRecordPast: () => Promise.reject(new Error("unused")) };
  const url = new URL("http://127.0.0.1/api/skills/proposals");
  const route = (await measure(n, "5 GET /api/skills/proposals (current)", async () => {
    const reply = await routeSkills(url.pathname, "GET", url, async () => ({}), ctx);
    if (!reply || reply.status !== 200) throw new Error(`route failed: ${reply?.status}`);
    return reply.body;
  })) as { data: { proposals: Record<string, any>[]; total: number } };
  const summaryBody = {
    success: true,
    code: "ok",
    data: { proposals: route.data.proposals.map(summaryOf), total: route.data.total },
  };
  results.push({
    n,
    case: "5 summary-only body (bytes only)",
    medianMs: NaN,
    maxMs: NaN,
    bytes: Buffer.byteLength(JSON.stringify(summaryBody)),
  });
  await measure(n, "5c summary list prototype (light canUndo)", () => summaryListPrototype(db));
  await db.execute("CREATE INDEX m_versions_proposal ON skill_versions(proposal_id, id)");
  await measure(n, "5d GET /api/skills/proposals + index on skill_versions", async () => {
    const reply = await routeSkills(url.pathname, "GET", url, async () => ({}), ctx);
    return reply?.body;
  });
  await measure(n, "4c skill detail proposals busiest + index", skillProposals);
  await db.execute("DROP INDEX m_versions_proposal");
  if (n === SIZES[0]) notes.push(...(await queryPlans(db)));
  const pageSize = await overflowCase(n, store);
  const busiest = `busiest skill ${seeded.busiestCount} proposals`;
  notes.push(
    `N=${n}: seed ${(seeded.seedMs / 1000).toFixed(1)} s, ${busiest}, page_size ${pageSize}`
  );
  if (n === Math.max(...SIZES))
    notes.push(`N=${n} isolated case 1: ${rssProbe(skillsDbPath(seeded.storage))}`);
  notes.push(
    `N=${n}: skills.db ${(store.fileSize() / 1024 / 1024).toFixed(1)} MB after overflow tables`
  );
}

const fmt = (v: number) => (Number.isNaN(v) ? "n/a" : v.toFixed(2));
console.log(
  `Bun ${Bun.version}, ${process.platform} ${process.arch}, ${RUNS} runs after 1 warm-up`
);
console.log("| N | Case | Median ms | Max ms | Bytes |");
console.log("| --: | --- | --: | --: | --: |");
for (const r of results) {
  console.log(`| ${r.n} | ${r.case} | ${fmt(r.medianMs)} | ${fmt(r.maxMs)} | ${r.bytes} |`);
}
for (const note of notes) console.log(note);
process.exit(0);
