import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { removeScratchDir } from "../scripts/remove-scratch-dir.mjs";

const root = join(import.meta.dir, "..");

function failing(code: string) {
  const calls: Array<{ path: string; options: Record<string, unknown> }> = [];
  const rm = (path: string, options: Record<string, unknown>) => {
    calls.push({ path, options });
    throw Object.assign(new Error(`${code}, locked`), { code });
  };
  return { rm, calls };
}

describe("removeScratchDir", () => {
  it("removes the folder with retries and reports success", () => {
    const calls: Array<{ path: string; options: Record<string, unknown> }> = [];
    const done = removeScratchDir("/tmp/scratch", {
      rm: (path: string, options: Record<string, unknown>) => void calls.push({ path, options }),
      platform: "linux",
    });
    expect(done).toBe(true);
    expect(calls).toEqual([
      {
        path: "/tmp/scratch",
        options: { recursive: true, force: true, maxRetries: 10, retryDelay: 100 },
      },
    ]);
  });

  it("leaves a folder that Windows still holds open, for EPERM and EBUSY", () => {
    for (const code of ["EPERM", "EBUSY"]) {
      const { rm } = failing(code);
      expect(removeScratchDir("C:\\scratch", { rm, platform: "win32" })).toBe(false);
    }
  });

  it("throws the same error on a platform other than Windows", () => {
    for (const platform of ["linux", "darwin"]) {
      const { rm } = failing("EPERM");
      expect(() => removeScratchDir("/tmp/scratch", { rm, platform })).toThrow("EPERM");
    }
  });

  it("throws any other error on Windows", () => {
    for (const code of ["ENOENT", "EACCES", "EIO"]) {
      const { rm } = failing(code);
      expect(() => removeScratchDir("C:\\scratch", { rm, platform: "win32" })).toThrow(code);
    }
  });
});

describe("the package smoke script", () => {
  const script = readFileSync(join(root, "scripts", "smoke-test.mjs"), "utf8");
  const workflow = readFileSync(join(root, ".github", "workflows", "platform-smoke.yml"), "utf8");

  it("removes its scratch home with the helper and not with a bare rmSync", () => {
    expect(script).toContain("removeScratchDir(home)");
    expect(script).not.toMatch(/\brmSync\(/);
  });

  it("is copied to the smoke folder together with every script it imports", () => {
    const imported = [...script.matchAll(/from "\.\/([\w-]+\.mjs)"/g)].map((match) => match[1]);
    expect(imported).toContain("remove-scratch-dir.mjs");
    for (const file of imported) {
      expect(workflow).toContain(`scripts/${file}" ./${file}`);
    }
  });
});
