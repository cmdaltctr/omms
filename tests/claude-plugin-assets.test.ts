import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The Claude Code plugin is data only: a manifest, a marketplace file, the
 * hook file, and one skill. Every hook runs the globally installed
 * `om-memory-system` command (design decision 1), and no MCP server exists.
 */

const root = join(import.meta.dir, "..");
const readJson = (path: string): any => JSON.parse(readFileSync(join(root, path), "utf8"));

describe("Claude Code plugin assets", () => {
  it("manifest names the plugin, matches the package version, and has no MCP servers", () => {
    const manifest = readJson(".claude-plugin/plugin.json");
    const pkg = readJson("package.json");

    expect(manifest.name).toBe("omms");
    expect(manifest.version).toBe(pkg.version);
    expect(manifest.license).toBe(pkg.license);
    expect(typeof manifest.description).toBe("string");
    expect(typeof manifest.author?.name).toBe("string");
    expect(manifest).not.toHaveProperty("mcpServers");
    expect(existsSync(join(root, ".mcp.json"))).toBe(false);
  });

  it("marketplace lists the plugin from the repository root", () => {
    const marketplace = readJson(".claude-plugin/marketplace.json");

    expect(typeof marketplace.name).toBe("string");
    expect(typeof marketplace.owner?.name).toBe("string");
    expect(marketplace.plugins).toHaveLength(1);
    expect(marketplace.plugins[0]).toMatchObject({ name: "omms", source: "./" });
  });

  it("hooks run om-memory-system claude-hook with the agreed timeouts", () => {
    const { hooks } = readJson("hooks/hooks.json");

    expect(Object.keys(hooks).sort()).toEqual(["SessionStart", "Stop", "UserPromptSubmit"]);
    const expected: Record<string, { command: string; timeout: number; async?: true }> = {
      SessionStart: { command: "om-memory-system claude-hook session-start", timeout: 20 },
      UserPromptSubmit: { command: "om-memory-system claude-hook user-prompt-submit", timeout: 10 },
      Stop: { command: "om-memory-system claude-hook stop", timeout: 60, async: true },
    };
    for (const [event, handler] of Object.entries(expected)) {
      expect(hooks[event]).toHaveLength(1);
      expect(hooks[event][0].hooks).toEqual([{ type: "command", ...handler }]);
    }
  });

  it("skill has name and description frontmatter and names the memory command", () => {
    const skill = readFileSync(join(root, "skills/omms-memory/SKILL.md"), "utf8");
    const frontmatter = skill.match(/^---\n([\s\S]*?)\n---\n/)?.[1];

    expect(frontmatter).toBeDefined();
    expect(frontmatter).toMatch(/^name: omms-memory$/m);
    expect(frontmatter).toMatch(/^description: \S.+$/m);
    expect(skill).toContain('om-memory-system memory search "<query>"');
    expect(skill).toContain("om-memory-system memory add --content");
    expect(skill).toContain("<private>");
  });
});
