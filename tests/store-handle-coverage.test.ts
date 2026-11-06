import { describe, expect, it } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { registeredStoreResets } from "../src/services/spaces/store-handles.js";

// Loading these modules registers their handles.
await import("../src/services/turso/connection-manager.js");
await import("../src/services/turso/shard-manager.js");
await import("../src/services/turso/ready.js");
await import("../src/services/user-prompt/user-prompt-manager.js");
await import("../src/services/user-profile/user-profile-manager.js");
await import("../src/services/ai/session/ai-session-manager.js");

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

describe("memory space store reset coverage", () => {
  it("registers every long-lived store handle", () => {
    expect(registeredStoreResets().sort()).toEqual(
      [
        "ai-sessions",
        "connections",
        "shards",
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
