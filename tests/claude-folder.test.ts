import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import {
  claudeProjectsRoot,
  isValidClaudeConfigDir,
  resolveClaudeFolder,
} from "../src/services/claude-folder.js";

const home = "/home/tester";

describe("resolveClaudeFolder", () => {
  it("prefers the setting over the variable and the default", () => {
    expect(resolveClaudeFolder("/data/claude", "/env/claude", home)).toEqual({
      folder: "/data/claude",
      source: "setting",
    });
  });

  it("uses the variable when the setting is empty or missing", () => {
    for (const configured of ["", "   ", undefined]) {
      expect(resolveClaudeFolder(configured, "/env/claude", home)).toEqual({
        folder: "/env/claude",
        source: "env",
      });
    }
  });

  it("falls back to ~/.claude", () => {
    expect(resolveClaudeFolder(undefined, "", home)).toEqual({
      folder: join(home, ".claude"),
      source: "default",
    });
    expect(resolveClaudeFolder("", " ", home).source).toBe("default");
  });

  it("expands ~/ in the setting to the home folder", () => {
    expect(resolveClaudeFolder("~/work/claude", "", home).folder).toBe(join(home, "work/claude"));
  });

  it("returns the projects folder inside the Claude folder", () => {
    expect(claudeProjectsRoot("/data/claude", "/env/claude", home)).toBe(
      join("/data/claude", "projects")
    );
    expect(claudeProjectsRoot(undefined, "", home)).toBe(join(home, ".claude", "projects"));
  });
});

describe("isValidClaudeConfigDir", () => {
  it("accepts empty, absolute, and ~/ paths", () => {
    for (const value of ["", "/data/claude", "~/claude"]) {
      expect(isValidClaudeConfigDir(value)).toBe(true);
    }
  });

  it("rejects relative paths and non-strings", () => {
    for (const value of ["claude/config", "./claude", "~claude", "~", 3, null]) {
      expect(isValidClaudeConfigDir(value)).toBe(false);
    }
  });
});
