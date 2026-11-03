import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import * as fs from "node:fs";
import {
  applyProjectVisibleRecall,
  visibleRecallFromFile,
} from "../src/services/visible-recall-config.js";
import { CONFIG, initConfig } from "../src/config.js";

describe("visibleRecallFromFile", () => {
  it("defaults to on", () => {
    expect(visibleRecallFromFile({})).toEqual({ visibleRecall: true });
  });

  it("reads an explicit false and an explicit true", () => {
    expect(visibleRecallFromFile({ visibleRecall: false })).toEqual({ visibleRecall: false });
    expect(visibleRecallFromFile({ visibleRecall: true })).toEqual({ visibleRecall: true });
  });
});

describe("applyProjectVisibleRecall", () => {
  it("keeps a project value of false", () => {
    const overrides: { visibleRecall?: boolean } = { visibleRecall: false };
    const log = mock();
    applyProjectVisibleRecall({ visibleRecall: false }, overrides, "/p", log);
    expect(overrides).toEqual({ visibleRecall: false });
    expect(log).not.toHaveBeenCalled();
  });

  it("drops a project value of true and logs it with the directory", () => {
    const overrides: { visibleRecall?: boolean } = { visibleRecall: true };
    const log = mock();
    applyProjectVisibleRecall({ visibleRecall: true }, overrides, "/p", log);
    expect(overrides).toEqual({});
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]).toEqual([
      "Project config cannot turn on visibleRecall; the value was ignored",
      { directory: "/p" },
    ]);
  });

  it("drops a project value that is not a boolean without a log line", () => {
    const overrides = { visibleRecall: "yes" as unknown as boolean };
    const log = mock();
    applyProjectVisibleRecall({ visibleRecall: "yes" as unknown as boolean }, overrides, "/p", log);
    expect(overrides).toEqual({});
    expect(log).not.toHaveBeenCalled();
  });

  it("leaves an unset project value unset", () => {
    const overrides: { visibleRecall?: boolean } = {};
    const log = mock();
    applyProjectVisibleRecall({}, overrides, "/p", log);
    expect(overrides).toEqual({});
    expect(log).not.toHaveBeenCalled();
  });
});

describe("visibleRecall in the loaded config", () => {
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

  it("defaults to on", () => {
    existsSpy = spyOn(fs, "existsSync").mockReturnValue(false);
    initConfig("/no/config/project");
    expect(CONFIG.visibleRecall).toBe(true);
  });

  it("is off when the global config says false", () => {
    mockGlobalAndProject({ visibleRecall: false }, {});
    initConfig("/my/project");
    expect(CONFIG.visibleRecall).toBe(false);
  });

  it("lets a project turn it off when the global config is on", () => {
    mockGlobalAndProject({ visibleRecall: true }, { visibleRecall: false });
    initConfig("/my/project");
    expect(CONFIG.visibleRecall).toBe(false);
  });

  it("lets a project turn it off when the global config leaves it unset", () => {
    mockGlobalAndProject({}, { visibleRecall: false });
    initConfig("/my/project");
    expect(CONFIG.visibleRecall).toBe(false);
  });

  it("ignores a project that turns it on when the global config is off", () => {
    mockGlobalAndProject({ visibleRecall: false }, { visibleRecall: true });
    initConfig("/my/project");
    expect(CONFIG.visibleRecall).toBe(false);
  });

  it("stays on when both are true", () => {
    mockGlobalAndProject({ visibleRecall: true }, { visibleRecall: true });
    initConfig("/my/project");
    expect(CONFIG.visibleRecall).toBe(true);
  });

  it("ignores a project value that is not a boolean when the global config is off", () => {
    mockGlobalAndProject({ visibleRecall: false }, { visibleRecall: "yes" });
    initConfig("/my/project");
    expect(CONFIG.visibleRecall).toBe(false);
  });
});
