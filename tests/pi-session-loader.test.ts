import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeLegacyV1Session, writeV3Session, makeProjectDir } from "./pi-import-fixtures.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

describe("Pi session loader (real SessionManager.open)", () => {
  it("loads a version 3 session with header cwd and active branch entries", async () => {
    const base = tempDir("pi-loader-v3-");
    const project = makeProjectDir(base, "repo");
    const file = join(base, "s1.jsonl");
    writeV3Session({
      file,
      sessionId: "11111111-1111-4111-8111-111111111111",
      cwd: project,
      windows: [
        { userText: "first prompt", assistantText: "first answer" },
        { userText: "second prompt", assistantText: "second answer" },
      ],
    });

    const { loadPiSessionForImport } = await import("../src/importer/session-loader.js");
    const loaded = loadPiSessionForImport(file);

    expect(loaded.sessionId).toBe("11111111-1111-4111-8111-111111111111");
    expect(loaded.cwd).toBe(project);
    // header is not a branch entry: 2 user + 2 assistant messages
    const roles = loaded.branch
      .filter((entry) => entry.type === "message")
      .map((entry) => entry.message?.role);
    expect(roles).toEqual(["user", "assistant", "user", "assistant"]);
  });

  it("migrates a legacy version 1 session through Pi's own migration", async () => {
    const base = tempDir("pi-loader-v1-");
    const project = makeProjectDir(base, "repo");
    const file = join(base, "legacy.jsonl");
    writeLegacyV1Session({
      file,
      sessionId: "22222222-2222-4222-8222-222222222222",
      cwd: project,
      windows: [{ userText: "legacy prompt", assistantText: "legacy answer" }],
    });

    const { loadPiSessionForImport } = await import("../src/importer/session-loader.js");
    const loaded = loadPiSessionForImport(file);

    expect(loaded.cwd).toBe(project);
    const messageEntries = loaded.branch.filter((entry) => entry.type === "message");
    expect(messageEntries.length).toBe(2);
    // migration assigned ids and a parent chain
    for (const entry of messageEntries) {
      expect(typeof entry.id).toBe("string");
      expect(entry.id.length).toBeGreaterThan(0);
    }
  });

  it("selects only the active branch when the session contains a fork", async () => {
    const base = tempDir("pi-loader-fork-");
    const project = makeProjectDir(base, "repo");
    const file = join(base, "forked.jsonl");

    const lines: string[] = [
      JSON.stringify({
        type: "session",
        version: 3,
        id: "33333333-3333-4333-8333-333333333333",
        timestamp: "2026-01-01T10:00:00.000Z",
        cwd: project,
      }),
    ];
    let parentId: string | null = null;
    let counter = 0;
    const push = (entryType: string, message: any) => {
      const entry = {
        type: "entry" as unknown as string,
        id: `e${counter++}`,
        parentId,
        timestamp: "2026-01-01T10:00:00.000Z",
        ...{},
      };
      entry.type = entryType;
      (entry as any).message = message;
      parentId = entry.id;
      lines.push(JSON.stringify(entry));
      return entry.id;
    };

    push("message", { role: "user", content: "root prompt" });
    const a1 = push("message", {
      role: "assistant",
      content: [{ type: "text", text: "root answer" }],
    });
    // abandoned branch from a1
    const abandonedUser = `e${counter++}`;
    lines.push(
      JSON.stringify({
        type: "message",
        id: abandonedUser,
        parentId: a1,
        timestamp: "2026-01-01T11:00:00.000Z",
        message: { role: "user", content: "abandoned branch prompt" },
      })
    );
    // active branch continues from a1, appended last (leaf)
    parentId = a1;
    push("message", { role: "user", content: "active branch prompt" });
    push("message", {
      role: "assistant",
      content: [{ type: "text", text: "active branch answer" }],
    });

    const { writeFileSync } = await import("node:fs");
    writeFileSync(file, lines.join("\n") + "\n");

    const { loadPiSessionForImport } = await import("../src/importer/session-loader.js");
    const loaded = loadPiSessionForImport(file);

    const prompts = loaded.branch
      .filter((entry) => entry.message?.role === "user")
      .map((entry) => {
        const content = entry.message!.content;
        return typeof content === "string" ? content : "";
      });
    expect(prompts).toEqual(["root prompt", "active branch prompt"]);
  });

  it("loads an empty-session file without entries", async () => {
    const base = tempDir("pi-loader-empty-");
    const project = makeProjectDir(base, "repo");
    const file = join(base, "empty.jsonl");
    const { writeFileSync } = await import("node:fs");
    writeFileSync(
      file,
      JSON.stringify({
        type: "session",
        version: 3,
        id: "44444444-4444-4444-8444-444444444444",
        timestamp: "2026-01-01T10:00:00.000Z",
        cwd: project,
      }) + "\n"
    );

    const { loadPiSessionForImport } = await import("../src/importer/session-loader.js");
    const loaded = loadPiSessionForImport(file);
    expect(loaded.branch.length).toBe(0);
  });
});
