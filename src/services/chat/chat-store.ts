import { randomUUID } from "node:crypto";
import type { InValue } from "@libsql/client";
import { tursoConnectionManager } from "../turso/connection-manager.js";
import type { TursoDb } from "../turso/turso-db.js";
import {
  ChatStoreError,
  type ChatConversation,
  type ChatFolder,
  type ChatMessage,
  type ChatNotice,
  type ChatPlanRecord,
  type ChatRole,
  type ChatSource,
} from "./chat-types.js";

/** Bump when the tables change, and add the step to `migrate`. */
export const CHAT_SCHEMA_VERSION = 1;
export const FOLDER_NAME_MAX = 80;
export const BULK_DELETE_MAX = 500;

type Row = Record<string, unknown>;
type GetConnection = (dbPath: string) => Promise<TursoDb>;

// The file is copied between computers by hand (ADR-032), so it keeps the
// default rollback journal: committed data lives in chats.db alone.
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS chat_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS chat_folders (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    name_key TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS chat_conversations (
    id TEXT PRIMARY KEY,
    folder_id TEXT REFERENCES chat_folders(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    scope_tag TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS chat_messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    sources_json TEXT,
    plan_json TEXT,
    model TEXT,
    error_code TEXT,
    notice TEXT,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS chat_messages_conversation ON chat_messages(conversation_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS chat_conversations_folder ON chat_conversations(folder_id)`,
];

// Only these fields are written, so a source never carries a folder path or an email.
const SOURCE_FIELDS = [
  "label",
  "kind",
  "id",
  "text",
  "projectName",
  "projectTag",
  "createdAt",
  "tags",
  "score",
  "section",
  "category",
  "evidence",
  "skill",
] as const;

// A skill source has its own list (ADR-037): no path, version id or proposal id.
const SKILL_FIELDS = [
  "name",
  "uses",
  "failedTurns",
  "attention",
  "modified",
  "lastAppliedAt",
] as const;
const HISTORY_FIELDS = ["kind", "at", "summary", "appliedBy"] as const;

function pick<T extends object>(value: T, fields: readonly (keyof T)[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    if (value[field] !== undefined) out[field as string] = value[field];
  }
  return out;
}

function snapshot(source: ChatSource): ChatSource {
  const out = pick(source, SOURCE_FIELDS);
  if (source.skill) {
    out.skill = {
      ...pick(source.skill, SKILL_FIELDS),
      history: (source.skill.history ?? []).map((entry) => pick(entry, HISTORY_FIELDS)),
    };
  }
  return out as unknown as ChatSource;
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string" || !value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function toConversation(row: Row): ChatConversation {
  return {
    id: String(row.id),
    folderId: row.folder_id == null ? null : String(row.folder_id),
    title: String(row.title),
    scopeTag: row.scope_tag == null ? null : String(row.scope_tag),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function toMessage(row: Row): ChatMessage {
  return {
    id: String(row.id),
    conversationId: String(row.conversation_id),
    role: String(row.role) as ChatRole,
    content: String(row.content),
    sources: parseJson<ChatSource[]>(row.sources_json, []),
    plan: parseJson<ChatPlanRecord | null>(row.plan_json, null),
    model: row.model == null ? null : String(row.model),
    errorCode: row.error_code == null ? null : String(row.error_code),
    notice: row.notice == null ? null : (String(row.notice) as ChatNotice),
    createdAt: Number(row.created_at),
  };
}

function folderName(name: string): { name: string; key: string } {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > FOLDER_NAME_MAX) {
    throw new ChatStoreError(`Folder names have 1 to ${FOLDER_NAME_MAX} characters`, "invalid");
  }
  return { name: trimmed, key: trimmed.toLowerCase() };
}

/**
 * Conversations, messages, and folders in `chats.db`. One instance per file;
 * every write checks the schema version so a file from a newer OMMS stays
 * untouched.
 */
export class ChatStore {
  private readOnly = false;
  // Strictly increasing timestamps keep "newest first" stable within one millisecond.
  private lastStamp = 0;

  constructor(
    private readonly dbPath: string,
    private readonly connect: GetConnection = (path) => tursoConnectionManager.getConnection(path)
  ) {}

  private db(): Promise<TursoDb> {
    return this.connect(this.dbPath);
  }

  private now(): number {
    this.lastStamp = Math.max(Date.now(), this.lastStamp + 1);
    return this.lastStamp;
  }

  async init(): Promise<void> {
    const db = await this.db();
    await db.execute(SCHEMA[0]!);
    const row = await db.get("SELECT value FROM chat_meta WHERE key = 'schema_version'");
    const version = row ? Number(row.value) : 0;
    if (version > CHAT_SCHEMA_VERSION) {
      this.readOnly = true;
      return;
    }
    this.readOnly = false;
    await db.batch(SCHEMA.slice(1).map((sql) => ({ sql })));
    if (version < CHAT_SCHEMA_VERSION) {
      await db.run(
        "INSERT INTO chat_meta (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [String(CHAT_SCHEMA_VERSION)]
      );
    }
  }

  isReadOnly(): boolean {
    return this.readOnly;
  }

  private writable(): void {
    if (this.readOnly) {
      throw new ChatStoreError("chats.db is from a newer OMMS and is read-only", "read_only");
    }
  }

  async listConversations(): Promise<ChatConversation[]> {
    const db = await this.db();
    const rows = await db.all(
      "SELECT * FROM chat_conversations ORDER BY updated_at DESC, created_at DESC"
    );
    return rows.map(toConversation);
  }

  async getConversation(
    id: string
  ): Promise<{ conversation: ChatConversation; messages: ChatMessage[] } | null> {
    const db = await this.db();
    const row = await db.get("SELECT * FROM chat_conversations WHERE id = ?", [id]);
    if (!row) return null;
    const messages = await db.all(
      "SELECT * FROM chat_messages WHERE conversation_id = ? ORDER BY created_at, rowid",
      [id]
    );
    return { conversation: toConversation(row), messages: messages.map(toMessage) };
  }

  async createConversation(input: {
    title: string;
    scopeTag: string | null;
    folderId?: string | null;
  }): Promise<ChatConversation> {
    this.writable();
    const db = await this.db();
    if (input.folderId) await this.requireFolder(input.folderId);
    const stamp = this.now();
    const conversation: ChatConversation = {
      id: randomUUID(),
      folderId: input.folderId ?? null,
      title: input.title.trim() || "New chat",
      scopeTag: input.scopeTag,
      createdAt: stamp,
      updatedAt: stamp,
    };
    await db.run(
      "INSERT INTO chat_conversations (id, folder_id, title, scope_tag, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      [
        conversation.id,
        conversation.folderId,
        conversation.title,
        conversation.scopeTag,
        stamp,
        stamp,
      ]
    );
    return conversation;
  }

  private async updateConversation(id: string, set: string, args: InValue[]): Promise<void> {
    this.writable();
    const db = await this.db();
    const changed = await db.run(
      `UPDATE chat_conversations SET ${set}, updated_at = ? WHERE id = ?`,
      [...args, this.now(), id]
    );
    if (changed === 0) throw new ChatStoreError("Conversation not found", "not_found");
  }

  async renameConversation(id: string, title: string): Promise<void> {
    const trimmed = title.trim();
    if (!trimmed) throw new ChatStoreError("A title is required", "invalid");
    await this.updateConversation(id, "title = ?", [trimmed.slice(0, 200)]);
  }

  async setConversationScope(id: string, scopeTag: string | null): Promise<void> {
    await this.updateConversation(id, "scope_tag = ?", [scopeTag]);
  }

  async moveConversation(id: string, folderId: string | null): Promise<void> {
    if (folderId) await this.requireFolder(folderId);
    await this.updateConversation(id, "folder_id = ?", [folderId]);
  }

  async deleteConversation(id: string): Promise<void> {
    this.writable();
    const db = await this.db();
    const changed = await db.run("DELETE FROM chat_conversations WHERE id = ?", [id]);
    if (changed === 0) throw new ChatStoreError("Conversation not found", "not_found");
  }

  /** Deletes every id or none: an unknown id fails the whole request. */
  async bulkDeleteConversations(ids: string[]): Promise<number> {
    this.writable();
    const unique = [...new Set(ids)];
    if (unique.length === 0 || unique.length > BULK_DELETE_MAX) {
      throw new ChatStoreError(`Select 1 to ${BULK_DELETE_MAX} conversations`, "invalid");
    }
    const db = await this.db();
    const marks = unique.map(() => "?").join(",");
    return db.transaction("write", async (tx) => {
      const found = await tx.execute({
        sql: `SELECT COUNT(*) AS n FROM chat_conversations WHERE id IN (${marks})`,
        args: unique,
      });
      if (Number(found.rows[0]?.n) !== unique.length) {
        throw new ChatStoreError("Conversation not found", "not_found");
      }
      const result = await tx.execute({
        sql: `DELETE FROM chat_conversations WHERE id IN (${marks})`,
        args: unique,
      });
      return Number(result.rowsAffected);
    });
  }

  async appendMessage(
    conversationId: string,
    input: {
      role: ChatRole;
      content: string;
      sources?: ChatSource[];
      plan?: ChatPlanRecord | null;
      model?: string | null;
      errorCode?: string | null;
      notice?: ChatNotice | null;
    }
  ): Promise<ChatMessage> {
    this.writable();
    const db = await this.db();
    const stamp = this.now();
    const sources = (input.sources ?? []).map(snapshot);
    const message: ChatMessage = {
      id: randomUUID(),
      conversationId,
      role: input.role,
      content: input.content,
      sources,
      plan: input.plan ?? null,
      model: input.model ?? null,
      errorCode: input.errorCode ?? null,
      notice: input.notice ?? null,
      createdAt: stamp,
    };
    await db.batch([
      {
        sql: "INSERT INTO chat_messages (id, conversation_id, role, content, sources_json, plan_json, model, error_code, notice, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        args: [
          message.id,
          conversationId,
          message.role,
          message.content,
          sources.length ? JSON.stringify(sources) : null,
          message.plan ? JSON.stringify(message.plan) : null,
          message.model,
          message.errorCode,
          message.notice,
          stamp,
        ],
      },
      {
        sql: "UPDATE chat_conversations SET updated_at = ? WHERE id = ?",
        args: [stamp, conversationId],
      },
    ]);
    return message;
  }

  async deleteMessage(id: string): Promise<void> {
    this.writable();
    const db = await this.db();
    await db.run("DELETE FROM chat_messages WHERE id = ?", [id]);
  }

  async countMessages(): Promise<number> {
    const db = await this.db();
    const row = await db.get("SELECT COUNT(*) AS n FROM chat_messages");
    return Number(row?.n ?? 0);
  }

  async listFolders(): Promise<ChatFolder[]> {
    const db = await this.db();
    const rows = await db.all(
      `SELECT f.*, (SELECT COUNT(*) FROM chat_conversations c WHERE c.folder_id = f.id) AS n
       FROM chat_folders f ORDER BY f.name_key`
    );
    return rows.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
      conversationCount: Number(row.n),
    }));
  }

  private async requireFolder(id: string): Promise<void> {
    const db = await this.db();
    if (!(await db.get("SELECT id FROM chat_folders WHERE id = ?", [id]))) {
      throw new ChatStoreError("Folder not found", "not_found");
    }
  }

  private async assertNameFree(key: string, exceptId?: string): Promise<void> {
    const db = await this.db();
    const clash = await db.get("SELECT id FROM chat_folders WHERE name_key = ? AND id != ?", [
      key,
      exceptId ?? "",
    ]);
    if (clash) throw new ChatStoreError("A folder with this name exists", "conflict");
  }

  async createFolder(name: string): Promise<ChatFolder> {
    this.writable();
    const clean = folderName(name);
    await this.assertNameFree(clean.key);
    const db = await this.db();
    const stamp = this.now();
    const id = randomUUID();
    await db.run(
      "INSERT INTO chat_folders (id, name, name_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      [id, clean.name, clean.key, stamp, stamp]
    );
    return { id, name: clean.name, createdAt: stamp, updatedAt: stamp, conversationCount: 0 };
  }

  async renameFolder(id: string, name: string): Promise<void> {
    this.writable();
    const clean = folderName(name);
    await this.assertNameFree(clean.key, id);
    const db = await this.db();
    const changed = await db.run(
      "UPDATE chat_folders SET name = ?, name_key = ?, updated_at = ? WHERE id = ?",
      [clean.name, clean.key, this.now(), id]
    );
    if (changed === 0) throw new ChatStoreError("Folder not found", "not_found");
  }

  /** Deletes the folder and every conversation in it. Returns how many conversations went. */
  async deleteFolder(id: string): Promise<number> {
    this.writable();
    const db = await this.db();
    return db.transaction("write", async (tx) => {
      const count = await tx.execute({
        sql: "SELECT COUNT(*) AS n FROM chat_conversations WHERE folder_id = ?",
        args: [id],
      });
      const result = await tx.execute({ sql: "DELETE FROM chat_folders WHERE id = ?", args: [id] });
      if (Number(result.rowsAffected) === 0) {
        throw new ChatStoreError("Folder not found", "not_found");
      }
      return Number(count.rows[0]?.n ?? 0);
    });
  }
}
