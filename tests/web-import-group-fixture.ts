import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { CONFIG } from "../src/config.js";

/** Create synthetic histories; the caller owns their handles and temporary directory. */
export function fixture(dirs: string[], sourceHandles: DatabaseSync[]) {
  const root = mkdtempSync(join(tmpdir(), "omms-web-group-"));
  dirs.push(root);
  const project = join(root, "project");
  mkdirSync(project);
  const pi = join(root, "pi");
  mkdirSync(pi);
  const claude = join(root, "claude");
  mkdirSync(claude);
  mkdirSync(join(claude, "project"));
  const prompts = [
    "Please improve the regression tests",
    "yes",
    "<private>Never disclose this preference</private>",
    "use bun not npm",
  ];
  const piRows: unknown[] = [
    {
      type: "session",
      version: 3,
      id: "same",
      timestamp: new Date(10).toISOString(),
      cwd: project,
    },
  ];
  const claudeRows: unknown[] = [];
  for (const [index, content] of prompts.entries()) {
    const time = new Date(20 + index * 10).toISOString();
    piRows.push(
      {
        type: "message",
        id: `u${index}`,
        parentId: index ? `a${index - 1}` : null,
        timestamp: time,
        message: { role: "user", content },
      },
      {
        type: "message",
        id: `a${index}`,
        parentId: `u${index}`,
        timestamp: time,
        message: { role: "assistant", content: [{ type: "text", text: "Synthetic response" }] },
      }
    );
    claudeRows.push(
      {
        type: "user",
        uuid: `u${index}`,
        parentUuid: index ? `a${index - 1}` : null,
        sessionId: "same",
        cwd: project,
        timestamp: time,
        message: { role: "user", content },
      },
      {
        type: "assistant",
        uuid: `a${index}`,
        parentUuid: `u${index}`,
        sessionId: "same",
        cwd: project,
        timestamp: time,
        message: { role: "assistant", content: [{ type: "text", text: "Synthetic response" }] },
      }
    );
  }
  const piFile = join(pi, "same.jsonl");
  const claudeFile = join(claude, "project", "same.jsonl");
  writeFileSync(piFile, piRows.map((row) => JSON.stringify(row)).join("\n") + "\n");
  writeFileSync(claudeFile, claudeRows.map((row) => JSON.stringify(row)).join("\n") + "\n");
  const dbPath = join(root, "opencode.db");
  const db = new DatabaseSync(dbPath);
  sourceHandles.push(db);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(`CREATE TABLE project (id TEXT, worktree TEXT);
    CREATE TABLE session (id TEXT, project_id TEXT, parent_id TEXT, directory TEXT, time_created INTEGER);
    CREATE TABLE message (id TEXT, session_id TEXT, time_created INTEGER, data TEXT);
    CREATE TABLE part (id TEXT, message_id TEXT, session_id TEXT, time_created INTEGER, data TEXT);`);
  db.prepare("INSERT INTO project VALUES (?, ?)").run("p", project);
  db.prepare("INSERT INTO session VALUES (?, ?, ?, ?, ?)").run("same", "p", null, project, 10);
  for (const [index, prompt] of prompts.entries())
    for (const [id, role, text] of [
      [`u${index}`, "user", prompt],
      [`a${index}`, "assistant", "Synthetic response"],
    ]) {
      const time = 20 + index * 10 + (role === "assistant" ? 1 : 0);
      db.prepare("INSERT INTO message VALUES (?, ?, ?, ?)").run(
        id,
        "same",
        time,
        JSON.stringify({ role })
      );
      db.prepare("INSERT INTO part VALUES (?, ?, ?, ?, ?)").run(
        `part-${id}`,
        id,
        "same",
        time,
        JSON.stringify({ type: "text", text })
      );
    }
  CONFIG.storagePath = join(root, "store");
  return {
    root,
    project,
    pi,
    claude,
    dbPath,
    files: [piFile, claudeFile, dbPath, `${dbPath}-wal`, `${dbPath}-shm`],
  };
}
