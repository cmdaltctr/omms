import { describe, expect, it } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { registeredStoreResets } from "../src/services/spaces/store-handles.js";

// Loading these modules registers their handles.
await import("../src/services/turso/connection-manager.js");
await import("../src/services/turso/shard-manager.js");
await import("../src/services/turso/ready.js");
await import("../src/services/user-prompt/user-prompt-manager.js");
await import("../src/services/user-profile/user-profile-manager.js");
await import("../src/services/ai/session/ai-session-manager.js");
await import("../src/services/spaces/read-store-cache.js");
await import("../src/services/tag-migration.js");

const srcRoot = join(import.meta.dir, "../src");

/**
 * Every database file OMMS opens under `storagePath`, and how a memory space switch covers it.
 * A new file must be added here on purpose. If its owner keeps a handle or a cached path, the
 * owner must also register with `resettable()` (src/services/spaces/store-handles.ts).
 */
const KNOWN_DATABASES: Record<string, string> = {
  "metadata.db": "shards: tursoShardManager",
  "user-profiles.db": "user-profiles: userProfileManager",
  "user-prompts.db": "user-prompts: userPromptManager",
  "ai-sessions.db": "ai-sessions: aiSessionManager",
  "chats.db": "path-keyed chat store map; connection closed by connections",
  "import-ledger.db": "path from CONFIG on every call; connection closed by connections",
  "skills.db": "global, not tied to a space",
  "opencode.db": "OpenCode's own database, read only, outside storagePath",
};

function sourceFiles(dir: string): string[] {
  return (readdirSync(dir, { recursive: true }) as string[])
    .map((entry) => join(dir, entry))
    .filter((path) => path.endsWith(".ts"));
}

// A declaration that can keep a database handle: its type or initialiser names a libSQL client,
// a connection or a store handle type.
const HANDLE_TEXT = /\b(createClient|Client|Database|StoreDb|StoreConnections|Connections?)\b/;

/**
 * Names the module-level `let`/`var`/`const` declarations and class fields in `text` that keep a
 * database handle, and whether the file calls `resettable(`. The storage port (design D6) must
 * not hold a handle across a space switch without a reset (plan risk "handle open across a space
 * switch"). A handle read from the engine on each call is fine: it is not kept.
 */
function keptHandles(text: string): { kept: string[]; resettable: boolean } {
  const source = ts.createSourceFile("x.ts", text, ts.ScriptTarget.Latest, true);
  const kept: string[] = [];
  let hasResettable = false;
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "resettable"
    ) {
      hasResettable = true;
    }
    const isField = ts.isPropertyDeclaration(node);
    const isModuleVar =
      ts.isVariableDeclaration(node) && ts.isSourceFile(node.parent.parent.parent);
    if ((isField || isModuleVar) && HANDLE_TEXT.test(node.getText(source))) {
      kept.push(node.name.getText(source));
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { kept, resettable: hasResettable };
}

describe("storage port handle coverage", () => {
  it("finds a handle kept in a module variable or a class field", () => {
    // Guards the scan itself: a scan that finds nothing would pass the check below.
    const bad = 'import type { Client } from "@libsql/client";\nlet db: Client | undefined;';
    expect(keptHandles(bad)).toEqual({ kept: ["db"], resettable: false });
    const field = "class A { private handle = createClient({ url: 'x' }); }";
    expect(keptHandles(field).kept).toEqual(["handle"]);
    const map = "const open = new Map<string, Client>();";
    expect(keptHandles(map).kept).toEqual(["open"]);
    expect(
      keptHandles("export function f(db: Client) { const c: Client = db; return c; }").kept
    ).toEqual([]);
    expect(keptHandles('const x = resettable("a", new Map<string, Client>());').resettable).toBe(
      true
    );
  });

  it("registers every file in src/services/storage that keeps a handle", () => {
    const offenders: string[] = [];
    const dir = join(srcRoot, "services/storage");
    for (const path of sourceFiles(dir)) {
      const { kept, resettable } = keptHandles(readFileSync(path, "utf-8"));
      if (kept.length > 0 && !resettable) offenders.push(`${path}: ${kept.join(", ")}`);
    }
    expect(offenders).toEqual([]);
  });
});

describe("memory space store reset coverage", () => {
  it("registers every long-lived store handle", () => {
    expect(registeredStoreResets().sort()).toEqual(
      [
        "ai-sessions",
        "connections",
        "shards",
        "space-read-stores",
        "tag-migration",
        "turso-ready",
        "user-profiles",
        "user-prompts",
      ].sort()
    );
  });

  it("knows every database file the source names", () => {
    const found = new Set<string>();
    for (const path of sourceFiles(srcRoot)) {
      for (const match of readFileSync(path, "utf-8").matchAll(
        /["'`]([a-z][a-z0-9-]*\.db)["'`]/g
      )) {
        found.add(match[1]!);
      }
    }
    const unknown = [...found].filter((name) => !(name in KNOWN_DATABASES));
    // A new database file needs a decision: reset it on a space switch, or document why it need not.
    expect(unknown).toEqual([]);
    const missing = Object.keys(KNOWN_DATABASES).filter((name) => !found.has(name));
    expect(missing).toEqual([]);
  });
});
