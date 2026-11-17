import { describe, expect, it } from "bun:test";
import {
  HOST_INFO,
  HOSTS,
  hostChoiceMessage,
  hostLabel,
  hostLabelList,
  isMemoryHost,
} from "../src/shared/hosts.js";

describe("host registry", () => {
  it("lists the hosts in the order every API object uses", () => {
    expect([...HOSTS]).toEqual(["pi", "opencode", "claude-code"]);
  });

  it("accepts each host id and refuses anything else", () => {
    for (const host of HOSTS) expect(isMemoryHost(host)).toBe(true);
    for (const value of ["claude", "", null, 1, "PI", undefined, {}]) {
      expect(isMemoryHost(value)).toBe(false);
    }
  });

  it("gives each host its display name", () => {
    expect(hostLabel("opencode")).toBe("OpenCode");
    expect(hostLabel("pi")).toBe("Pi");
    expect(hostLabel("claude-code")).toBe("Claude Code");
  });

  it("gives the article used in 'An OpenCode import is already running'", () => {
    expect(HOST_INFO.opencode.article).toBe("An");
    expect(HOST_INFO.pi.article).toBe("A");
    expect(HOST_INFO["claude-code"].article).toBe("A");
  });

  it("gives the command name of each host", () => {
    expect(HOST_INFO.opencode.commandName).toBe("opencode");
    expect(HOST_INFO.pi.commandName).toBe("pi");
    expect(HOST_INFO["claude-code"].commandName).toBe("claude");
  });

  it("marks Claude Code as the only host with no session model or session commands", () => {
    expect(HOST_INFO.pi.sessionModel).toBe(true);
    expect(HOST_INFO.opencode.sessionModel).toBe(true);
    expect(HOST_INFO["claude-code"].sessionModel).toBe(false);
    expect(HOST_INFO.pi.sessionCommands).toBe(true);
    expect(HOST_INFO.opencode.sessionCommands).toBe(true);
    expect(HOST_INFO["claude-code"].sessionCommands).toBe(false);
  });

  it("names the backfill-model config key of each host", () => {
    expect(HOST_INFO.pi.backfillModelKey).toBe("piBackfillModel");
    expect(HOST_INFO.opencode.backfillModelKey).toBe("opencodeBackfillModel");
    expect(HOST_INFO["claude-code"].backfillModelKey).toBeNull();
  });

  it("gives the history source option and its usage line", () => {
    expect(HOST_INFO.pi.sourceOption).toEqual({
      flag: "--root",
      usage: "  --root <dir>              Pi session root (default ~/.pi/agent/sessions)",
    });
    expect(HOST_INFO.opencode.sourceOption).toEqual({
      flag: "--db",
      usage:
        "  --db <path>               OpenCode database (default ~/.local/share/opencode/opencode.db)",
    });
    expect(HOST_INFO["claude-code"].sourceOption).toEqual({
      flag: "--root",
      usage:
        "  --root <dir>              Claude Code transcripts folder (default ~/.claude/projects)",
    });
  });

  it("has one entry per host and no other", () => {
    expect(Object.keys(HOST_INFO).sort()).toEqual([...HOSTS].sort());
    for (const host of HOSTS) expect(HOST_INFO[host].label).toBe(hostLabel(host));
  });
});

describe("host choice message", () => {
  it("names every host label in registry order", () => {
    expect(hostChoiceMessage()).toBe("Choose Pi, OpenCode, or Claude Code");
  });
});

describe("host label list", () => {
  it("joins every host label with the given last separator", () => {
    expect(hostLabelList(", ")).toBe("Pi, OpenCode, Claude Code");
    expect(hostLabelList(" or ")).toBe("Pi, OpenCode or Claude Code");
    expect(hostLabelList(", or ")).toBe("Pi, OpenCode, or Claude Code");
  });
});
