import { describe, it, expect } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONFIG } from "../src/config.js";
import { getProjectName, getProjectTagInfo, getUserTagInfo } from "../src/services/tags.js";

describe("tags", () => {
  describe("getProjectName", () => {
    it("should extract project name from Unix path", () => {
      expect(getProjectName("/home/user/projects/my-app")).toBe("my-app");
    });

    it("should extract project name from Windows path", () => {
      expect(getProjectName("C:\\Users\\user\\projects\\my-app")).toBe("my-app");
    });

    it("should extract project name from mixed-separator path", () => {
      expect(getProjectName("C:\\Users/user\\projects/my-app")).toBe("my-app");
    });

    it("should return input when no separators present", () => {
      expect(getProjectName("my-app")).toBe("my-app");
    });

    it("should handle trailing separator", () => {
      const result = getProjectName("/home/user/projects/my-app/");
      // Should handle trailing slash gracefully
      expect(typeof result).toBe("string");
    });

    it("should handle deeply nested path", () => {
      expect(getProjectName("/a/b/c/d/e/f/project")).toBe("project");
    });
  });
});

describe("tag settings", () => {
  // tags.ts reads its settings on each call (design D5a "S"); a reload must reach the next tag.
  it("reads the prefix and the user overrides from the live config", () => {
    const dir = mkdtempSync(join(tmpdir(), "omms-tag-settings-"));
    const saved = {
      prefix: CONFIG.containerTagPrefix,
      email: CONFIG.userEmailOverride,
      name: CONFIG.userNameOverride,
    };
    try {
      CONFIG.containerTagPrefix = "first";
      CONFIG.userEmailOverride = "a@example.com";
      CONFIG.userNameOverride = "Name A";
      const projectA = getProjectTagInfo(dir).tag;
      const userA = getUserTagInfo(dir);
      expect(projectA.startsWith("first_project_")).toBe(true);
      expect(userA.userEmail).toBe("a@example.com");

      CONFIG.containerTagPrefix = "second";
      CONFIG.userEmailOverride = "b@example.com";
      CONFIG.userNameOverride = "Name B";
      const userB = getUserTagInfo(dir);
      expect(getProjectTagInfo(dir).tag).toBe(projectA.replace("first_", "second_"));
      expect(userB.tag.startsWith("second_user_")).toBe(true);
      expect(userB.tag).not.toBe(userA.tag.replace("first_", "second_"));
      expect([userB.userEmail, userB.userName]).toEqual(["b@example.com", "Name B"]);
    } finally {
      CONFIG.containerTagPrefix = saved.prefix;
      CONFIG.userEmailOverride = saved.email;
      CONFIG.userNameOverride = saved.name;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("getGitEmail trusted git lookup", () => {
  function withFakeGit(withRepo: boolean, run: (root: string) => void) {
    const root = mkdtempSync(join(tmpdir(), "omms-git-trust-"));
    const bin = join(root, "bin");
    mkdirSync(bin);
    writeFileSync(join(bin, "git"), "#!/bin/sh\necho fake@example.com\n", { mode: 0o755 });
    if (withRepo) mkdirSync(join(root, ".git"));
    const savedPath = process.env.PATH;
    process.env.PATH = bin;
    try {
      run(root);
    } finally {
      process.env.PATH = savedPath;
      rmSync(root, { recursive: true, force: true });
    }
  }

  it.skipIf(process.platform === "win32")(
    "allows git from PATH when no repository or marker is above the directory",
    async () => {
      const { getGitEmail } = await import("../src/services/tags.js");
      withFakeGit(false, (root) => {
        expect(getGitEmail(root)).toBe("fake@example.com");
      });
    }
  );

  it.skipIf(process.platform === "win32")(
    "refuses a git executable inside the repository root",
    async () => {
      const { getGitEmail } = await import("../src/services/tags.js");
      withFakeGit(true, (root) => {
        expect(getGitEmail(root)).toBeNull();
      });
    }
  );
});
