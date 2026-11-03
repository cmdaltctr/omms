import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import * as fs from "node:fs";
import {
  applyProjectInjectionOptions,
  DEFAULT_OPENING_CONTEXT_QUERY,
  injectionOptionsFromFile,
  OPENING_CONTEXT_QUERY_MAX_LENGTH,
} from "../src/services/injection-options-config.js";
import { CONFIG, initConfig, refreshConfigIfChanged } from "../src/config.js";
import { CONFIG_TEMPLATE } from "../src/config-template.js";
import { stripJsoncComments } from "../src/services/jsonc.js";

const DEFAULTS = {
  openingContext: false,
  openingContextQuery: "project architecture, setup, conventions and key decisions",
  subagentMemory: true,
};

describe("injectionOptionsFromFile", () => {
  it("exports the default query and the 500-character limit", () => {
    expect(DEFAULT_OPENING_CONTEXT_QUERY).toBe(DEFAULTS.openingContextQuery);
    expect(OPENING_CONTEXT_QUERY_MAX_LENGTH).toBe(500);
  });

  it("defaults to opening context off, the default query and subagent memory on", () => {
    expect(injectionOptionsFromFile({})).toEqual(DEFAULTS);
  });

  it("reads explicit values", () => {
    expect(
      injectionOptionsFromFile({
        openingContext: true,
        openingContextQuery: "setup",
        subagentMemory: false,
      })
    ).toEqual({ openingContext: true, openingContextQuery: "setup", subagentMemory: false });
  });

  it("reads values of the wrong type as their defaults", () => {
    const file = { openingContext: "yes", openingContextQuery: 5, subagentMemory: "no" };
    expect(injectionOptionsFromFile(file as unknown as object)).toEqual(DEFAULTS);
    const numbers = { openingContext: 1, subagentMemory: 0 };
    expect(injectionOptionsFromFile(numbers as unknown as object)).toEqual(DEFAULTS);
  });

  it("trims the query, and an empty query stays empty", () => {
    expect(injectionOptionsFromFile({ openingContextQuery: "  tests and setup \n" })).toMatchObject(
      { openingContextQuery: "tests and setup" }
    );
    expect(injectionOptionsFromFile({ openingContextQuery: "   " })).toMatchObject({
      openingContextQuery: "",
    });
  });

  it("cuts a 700-character query to 500 and logs the length, never the text", () => {
    const query = "QUERYMARK-".repeat(70);
    const log = mock();
    const options = injectionOptionsFromFile({ openingContextQuery: query }, log);
    expect(options.openingContextQuery).toBe(query.slice(0, 500));
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]![1]).toEqual({ length: 700 });
    expect(JSON.stringify(log.mock.calls)).not.toContain("QUERYMARK");
  });

  it("does not log a query of exactly 500 characters", () => {
    const log = mock();
    const query = "q".repeat(500);
    expect(injectionOptionsFromFile({ openingContextQuery: query }, log).openingContextQuery).toBe(
      query
    );
    expect(log).not.toHaveBeenCalled();
  });
});

describe("applyProjectInjectionOptions", () => {
  it("keeps a project false for both switches", () => {
    const overrides = { openingContext: false, subagentMemory: false };
    const log = mock();
    applyProjectInjectionOptions({ ...overrides }, overrides, "/p", log);
    expect(overrides).toEqual({ openingContext: false, subagentMemory: false });
    expect(log).not.toHaveBeenCalled();
  });

  it("removes a project true for each switch and logs it with the directory", () => {
    const overrides = { openingContext: true, subagentMemory: true };
    const log = mock();
    applyProjectInjectionOptions({ ...overrides }, overrides, "/p", log);
    expect(overrides).toEqual({});
    expect(log.mock.calls).toEqual([
      ["Project config cannot turn on openingContext; the value was ignored", { directory: "/p" }],
      ["Project config cannot turn on subagentMemory; the value was ignored", { directory: "/p" }],
    ]);
  });

  it("removes a project query and logs it without the query text", () => {
    const overrides = { openingContextQuery: "PROJECTMARK query" };
    const log = mock();
    applyProjectInjectionOptions({ ...overrides }, overrides, "/p", log);
    expect(overrides).toEqual({});
    expect(log.mock.calls).toEqual([
      ["Project config cannot set openingContextQuery; the value was ignored", { directory: "/p" }],
    ]);
    expect(JSON.stringify(log.mock.calls)).not.toContain("PROJECTMARK");
  });

  it("drops project values of the wrong type without a log line", () => {
    const project = { openingContext: "yes", subagentMemory: 1 } as unknown as object;
    const overrides = { ...project };
    const log = mock();
    applyProjectInjectionOptions(project, overrides, "/p", log);
    expect(overrides).toEqual({});
    expect(log).not.toHaveBeenCalled();
  });

  it("leaves unset project values unset", () => {
    const overrides = {};
    const log = mock();
    applyProjectInjectionOptions({}, overrides, "/p", log);
    expect(overrides).toEqual({});
    expect(log).not.toHaveBeenCalled();
  });
});

describe("memory injection settings in the loaded config", () => {
  let readSpy: ReturnType<typeof spyOn>;
  let existsSpy: ReturnType<typeof spyOn>;

  const normalizePath = (p: unknown) => String(p).replace(/\\/g, "/");

  afterEach(() => {
    readSpy?.mockRestore();
    existsSpy?.mockRestore();
    initConfig("/nonexistent-project");
  });

  function mockGlobalAndProject(global: object, project: object) {
    existsSpy = spyOn(fs, "existsSync").mockReturnValue(true);
    readSpy = spyOn(fs, "readFileSync").mockImplementation((p) => {
      const path = normalizePath(p);
      if (/\/\.opencode\/(omms|opencode-mem)\./.test(path)) return JSON.stringify(project) as any;
      return JSON.stringify(global) as any;
    });
  }

  const loaded = () => ({
    openingContext: CONFIG.openingContext,
    openingContextQuery: CONFIG.openingContextQuery,
    subagentMemory: CONFIG.subagentMemory,
  });

  it("uses the defaults when no file sets them", () => {
    existsSpy = spyOn(fs, "existsSync").mockReturnValue(false);
    initConfig("/no/config/project");
    expect(loaded()).toEqual(DEFAULTS);
  });

  it("reads the global values", () => {
    mockGlobalAndProject(
      { openingContext: true, openingContextQuery: " setup ", subagentMemory: false },
      {}
    );
    initConfig("/my/project");
    expect(loaded()).toEqual({
      openingContext: true,
      openingContextQuery: "setup",
      subagentMemory: false,
    });
  });

  it("lets a project turn both switches off", () => {
    mockGlobalAndProject(
      { openingContext: true, subagentMemory: true },
      { openingContext: false, subagentMemory: false }
    );
    initConfig("/my/project");
    expect(loaded()).toMatchObject({ openingContext: false, subagentMemory: false });
  });

  it("ignores a project that turns either switch on", () => {
    mockGlobalAndProject(
      { openingContext: false, subagentMemory: false },
      { openingContext: true, subagentMemory: true }
    );
    initConfig("/my/project");
    expect(loaded()).toMatchObject({ openingContext: false, subagentMemory: false });
  });

  it("uses the global query when a project sets one", () => {
    mockGlobalAndProject(
      { openingContext: true, openingContextQuery: "global query" },
      { openingContextQuery: "project query" }
    );
    initConfig("/my/project");
    expect(CONFIG.openingContextQuery).toBe("global query");
  });

  it("picks up the settings on a config reload", () => {
    existsSpy = spyOn(fs, "existsSync").mockReturnValue(false);
    initConfig("/no/config/project");
    existsSpy.mockRestore();
    mockGlobalAndProject({ openingContext: true, subagentMemory: false }, {});
    refreshConfigIfChanged("/reloaded/project");
    expect(loaded()).toMatchObject({ openingContext: true, subagentMemory: false });
  });
});

describe("config template", () => {
  const parsed = JSON.parse(stripJsoncComments(CONFIG_TEMPLATE)) as Record<string, unknown>;

  it("documents the three memory injection keys as comments next to visibleRecall", () => {
    const block = CONFIG_TEMPLATE.slice(CONFIG_TEMPLATE.indexOf('// "visibleRecall"'));
    expect(block).toContain('// "openingContext": false,');
    expect(block).toContain(`// "openingContextQuery": "${DEFAULTS.openingContextQuery}",`);
    expect(block).toContain('// "subagentMemory": true,');
    expect(CONFIG_TEMPLATE).toContain("OpenCode V2, Pi and Claude Code");
    expect(CONFIG_TEMPLATE).toContain("first message of a new session");
    expect(CONFIG_TEMPLATE).toContain("a project config can only turn these off");
    for (const key of ["openingContext", "openingContextQuery", "subagentMemory"]) {
      expect(parsed[key]).toBeUndefined();
    }
  });

  it("documents the restore after compaction and resume and its project rule", () => {
    expect(CONFIG_TEMPLATE).toContain('// "compaction": { "enabled": true, "memoryLimit": 10 },');
    expect(CONFIG_TEMPLATE).toContain("after compaction and after resume");
    expect(CONFIG_TEMPLATE).toContain("A project config can turn it on or off.");
    expect(parsed.compaction).toBeUndefined();
  });
});
