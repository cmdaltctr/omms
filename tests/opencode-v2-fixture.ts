import { DatabaseSync } from "node:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Builder for OpenCode databases in tests. It writes the OpenCode 2.x tables
 * (`session_v2`, `session_message`, an empty `session_part`) and, on request,
 * the older `session`, `message` and `part` tables in the layout the existing
 * reader tests use. Nothing here touches a real OpenCode database.
 *
 * Column sets: `session_v2` and `session_message` hold the columns the reader
 * needs plus `time_updated`, as recorded in the change design. `session_part`
 * only has to exist and stay empty.
 */

/** Every `session_message.type` value OpenCode 2.x writes. */
export type V2MessageType =
  | "assistant"
  | "user"
  | "synthetic"
  | "idle"
  | "system"
  | "compaction"
  | "agent-switched"
  | "model-switched"
  | "location-switched";

/** One entry of an `assistant` message's `data.content`. */
export type V2ContentItem =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }
  | {
      type: "tool";
      name: string;
      state: {
        status: string;
        input?: unknown;
        content?: Array<{ type: string; text?: string }>;
        error?: string;
      };
    };

export interface OpencodeFixtureOptions {
  /** Create the V2 tables. Default true. */
  v2?: boolean;
  /** Also create the V1 tables (`session`, `message`, `part`). Default false. */
  v1?: boolean;
  /** Folder for the database file. Default: a new temporary folder. */
  root?: string;
  /** File name inside `root`. Default `opencode.db`. */
  fileName?: string;
  /** Project folder recorded in `project.worktree` and sessions. Default: `root`. */
  project?: string;
  /** Skip the shared `project` table, to build a database with neither table set. */
  projectTable?: boolean;
}

export interface SessionOptions {
  parentId?: string | null;
  title?: string | null;
  directory?: string;
  at?: number;
}

export function createOpencodeFixture(options: OpencodeFixtureOptions = {}) {
  const root = options.root ?? mkdtempSync(join(tmpdir(), "omms-opencode-v2-"));
  const project = options.project ?? root;
  const path = join(root, options.fileName ?? "opencode.db");
  const db = new DatabaseSync(path);
  if (options.projectTable !== false) {
    db.exec("CREATE TABLE project (id TEXT, worktree TEXT)");
    db.prepare("INSERT INTO project VALUES (?, ?)").run("p", project);
  }
  if (options.v2 !== false) {
    db.exec(`CREATE TABLE session_v2 (id TEXT, project_id TEXT, parent_id TEXT, title TEXT, directory TEXT, time_created INTEGER, time_updated INTEGER);
      CREATE TABLE session_message (id TEXT, session_id TEXT, type TEXT, time_created INTEGER, time_updated INTEGER, data TEXT);
      CREATE TABLE session_part (id TEXT, message_id TEXT, session_id TEXT, time_created INTEGER, data TEXT);`);
  }
  if (options.v1) {
    db.exec(`CREATE TABLE session (id TEXT, project_id TEXT, parent_id TEXT, directory TEXT, time_created INTEGER);
      CREATE TABLE message (id TEXT, session_id TEXT, time_created INTEGER, data TEXT);
      CREATE TABLE part (id TEXT, message_id TEXT, session_id TEXT, time_created INTEGER, data TEXT);`);
  }

  const v2Session = (id: string, session: SessionOptions = {}) => {
    const at = session.at ?? 1;
    db.prepare("INSERT INTO session_v2 VALUES (?, ?, ?, ?, ?, ?, ?)").run(
      id,
      "p",
      session.parentId ?? null,
      session.title ?? null,
      session.directory ?? project,
      at,
      at
    );
  };
  const v2Message = (
    sessionId: string,
    id: string,
    type: V2MessageType,
    at: number,
    data: object = {}
  ) => {
    db.prepare("INSERT INTO session_message VALUES (?, ?, ?, ?, ?, ?)").run(
      id,
      sessionId,
      type,
      at,
      at,
      JSON.stringify(data)
    );
  };
  const v2User = (sessionId: string, id: string, at: number, text: string) =>
    v2Message(sessionId, id, "user", at, { text, files: [], agents: [], skills: [], time: at });
  const v2Assistant = (sessionId: string, id: string, at: number, content: V2ContentItem[]) =>
    v2Message(sessionId, id, "assistant", at, { content });
  /** A user message followed by one assistant text reply. */
  const v2Turn = (
    sessionId: string,
    userId: string,
    answerId: string,
    at: number,
    prompt: string,
    reply: string
  ) => {
    v2User(sessionId, userId, at, prompt);
    v2Assistant(sessionId, answerId, at + 1, [{ type: "text", text: reply }]);
  };

  const v1Session = (id: string, session: SessionOptions = {}) => {
    db.prepare("INSERT INTO session VALUES (?, ?, ?, ?, ?)").run(
      id,
      "p",
      session.parentId ?? null,
      session.directory ?? project,
      session.at ?? 1
    );
  };
  const v1Message = (
    sessionId: string,
    id: string,
    role: "user" | "assistant",
    at: number,
    parts: object[]
  ) => {
    db.prepare("INSERT INTO message VALUES (?, ?, ?, ?)").run(
      id,
      sessionId,
      at,
      JSON.stringify({ role })
    );
    parts.forEach((part, index) =>
      db
        .prepare("INSERT INTO part VALUES (?, ?, ?, ?, ?)")
        .run(`${id}-${index}`, id, sessionId, at + index, JSON.stringify(part))
    );
  };
  /** A V1 user message followed by one assistant text reply. */
  const v1Turn = (
    sessionId: string,
    userId: string,
    answerId: string,
    at: number,
    prompt: string,
    reply: string
  ) => {
    v1Message(sessionId, userId, "user", at, [{ type: "text", text: prompt }]);
    v1Message(sessionId, answerId, "assistant", at + 1, [{ type: "text", text: reply }]);
  };

  return {
    root,
    project,
    path,
    db,
    close: () => db.close(),
    v2Session,
    v2Message,
    v2User,
    v2Assistant,
    v2Turn,
    v1Session,
    v1Message,
    v1Turn,
  };
}

export type OpencodeFixture = ReturnType<typeof createOpencodeFixture>;
