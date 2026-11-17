import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  claimNotice,
  clearNotice,
  firstRunNoticeLines,
  noticeClaimed,
} from "../src/services/first-run-notice.js";

const LOGIN_ITEM = { loginItem: true };
const ALL_ON = { autoBackfill: true, webServerAutoStart: true, embeddingApiUrl: undefined };
const roots: string[] = [];

function scratch(): string {
  const root = mkdtempSync(join(tmpdir(), "omms-first-run-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("firstRunNoticeLines", () => {
  it("names the three behaviours and how to turn each off for OpenCode and Pi", () => {
    const text = firstRunNoticeLines(ALL_ON, LOGIN_ITEM).join("\n");
    expect(text).toContain("autoBackfill");
    expect(text).toContain("webServerAutoStart");
    expect(text).toContain("embedding API URL");
  });

  it("leaves the login item out for a host without one (Claude Code)", () => {
    const text = firstRunNoticeLines(ALL_ON, { loginItem: false }).join("\n");
    expect(text).toContain("autoBackfill");
    expect(text).toContain("embedding API URL");
    expect(text).not.toContain("webServerAutoStart");
  });

  it("states the embedding download size the docs give", () => {
    const text = firstRunNoticeLines(ALL_ON, LOGIN_ITEM).join("\n");
    expect(text).toContain("about 550 MB");
  });

  it("leaves out a part that is already off", () => {
    const noImport = firstRunNoticeLines({ ...ALL_ON, autoBackfill: false }, LOGIN_ITEM).join("\n");
    expect(noImport).not.toContain("autoBackfill");
    expect(noImport).toContain("webServerAutoStart");

    const noLogin = firstRunNoticeLines({ ...ALL_ON, webServerAutoStart: false }, LOGIN_ITEM).join(
      "\n"
    );
    expect(noLogin).not.toContain("webServerAutoStart");

    const remoteEmbedding = firstRunNoticeLines(
      {
        ...ALL_ON,
        embeddingApiUrl: "http://127.0.0.1:11434/v1",
      },
      LOGIN_ITEM
    ).join("\n");
    expect(remoteEmbedding).not.toContain("embedding API URL");
  });

  it("treats a blank embedding API URL as unset", () => {
    const text = firstRunNoticeLines({ ...ALL_ON, embeddingApiUrl: "  " }, LOGIN_ITEM).join("\n");
    expect(text).toContain("embedding API URL");
  });

  it("returns no lines when every part is off", () => {
    const lines = firstRunNoticeLines(
      {
        autoBackfill: false,
        webServerAutoStart: false,
        embeddingApiUrl: "http://127.0.0.1:11434/v1",
      },
      LOGIN_ITEM
    );
    expect(lines).toEqual([]);
  });
});

describe("claimNotice", () => {
  it("returns true once per key", () => {
    const folder = scratch();
    expect(claimNotice("pi", folder)).toBe(true);
    expect(claimNotice("pi", folder)).toBe(false);
    expect(claimNotice("opencode", folder)).toBe(true);
  });

  it("keeps the claim across calls through the record file", () => {
    const folder = scratch();
    claimNotice("pi", folder);
    const record = JSON.parse(readFileSync(join(folder, "first-run-notices.json"), "utf8"));
    expect(Object.keys(record)).toContain("pi");
  });

  it("claims in a folder that does not exist yet", () => {
    const folder = join(scratch(), "nested", "storage");
    expect(claimNotice("pi", folder)).toBe(true);
    expect(existsSync(join(folder, "first-run-notices.json"))).toBe(true);
  });

  it("survives a broken record file", () => {
    const folder = scratch();
    writeFileSync(join(folder, "first-run-notices.json"), "{not json");
    expect(claimNotice("pi", folder)).toBe(true);
    expect(claimNotice("pi", folder)).toBe(false);
  });

  it("survives a record file that is not an object", () => {
    const folder = scratch();
    writeFileSync(join(folder, "first-run-notices.json"), "[1,2]");
    expect(claimNotice("pi", folder)).toBe(true);
    expect(claimNotice("pi", folder)).toBe(false);
  });

  it("keeps other keys when it claims a new one", () => {
    const folder = scratch();
    claimNotice("pi", folder);
    claimNotice("opencode", folder);
    expect(claimNotice("pi", folder)).toBe(false);
    expect(claimNotice("opencode", folder)).toBe(false);
  });

  it("writes atomically and leaves no temporary file in the folder", () => {
    const folder = scratch();
    claimNotice("pi", folder);
    expect(readdirSync(folder)).toEqual(["first-run-notices.json"]);
  });

  it("returns false when the record cannot be written", () => {
    const folder = scratch();
    const codes: string[] = [];
    const claimed = claimNotice("pi", folder, {
      readFile: () => null,
      writeAtomic: () => {
        throw new Error("disk full");
      },
      log: (code) => codes.push(code),
    });
    expect(claimed).toBe(false);
    expect(codes).toEqual(["first-run-notice-write-failed"]);
  });
});

describe("clearNotice", () => {
  it("lets a cleared key be claimed again", () => {
    const folder = scratch();
    expect(claimNotice("claude-code-capture-setup", folder)).toBe(true);
    expect(claimNotice("claude-code-capture-setup", folder)).toBe(false);
    clearNotice("claude-code-capture-setup", folder);
    expect(claimNotice("claude-code-capture-setup", folder)).toBe(true);
  });

  it("keeps the other keys", () => {
    const folder = scratch();
    claimNotice("pi", folder);
    claimNotice("opencode", folder);
    clearNotice("pi", folder);
    expect(claimNotice("opencode", folder)).toBe(false);
  });

  it("does nothing when the record is missing", () => {
    const folder = scratch();
    expect(() => clearNotice("pi", folder)).not.toThrow();
    expect(existsSync(join(folder, "first-run-notices.json"))).toBe(false);
  });
});

describe("noticeClaimed", () => {
  it("reads a claim without writing the record", () => {
    const folder = scratch();
    expect(noticeClaimed("opencode", folder)).toBe(false);
    expect(existsSync(join(folder, "first-run-notices.json"))).toBe(false);
    claimNotice("opencode", folder);
    expect(noticeClaimed("opencode", folder)).toBe(true);
    expect(noticeClaimed("pi", folder)).toBe(false);
  });

  it("counts a broken record as no claim", () => {
    const folder = scratch();
    writeFileSync(join(folder, "first-run-notices.json"), "{ not json");
    expect(noticeClaimed("opencode", folder)).toBe(false);
  });
});
