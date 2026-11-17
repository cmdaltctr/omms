import { afterEach, describe, expect, it } from "bun:test";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HostSetupDeps } from "../src/core/host-setup.js";
import { mergeCliJson, opencodeSetup } from "../src/adapters/opencode/setup.js";

const roots: string[] = [];

function scratch(): string {
  const root = mkdtempSync(join(tmpdir(), "omms-opencode-setup-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function deps(home: string, env: Record<string, string> = {}): HostSetupDeps {
  return {
    env,
    home,
    platform: "linux",
    program: join(home, "bin", "opencode"),
    readFile: (path) => {
      try {
        return readFileSync(path, "utf8");
      } catch {
        return null;
      }
    },
    run: () => {
      throw new Error("OpenCode setup must not run a command to read its state");
    },
  };
}

function writeConfig(folder: string, file: string, text: string): string {
  mkdirSync(folder, { recursive: true });
  const path = join(folder, file);
  writeFileSync(path, text);
  return path;
}

describe("opencodeSetup.registered", () => {
  it("is false when no global config exists", () => {
    expect(opencodeSetup.registered(deps(scratch()))).toBe(false);
  });

  it("reads opencode.json under the home folder", () => {
    const home = scratch();
    writeConfig(
      join(home, ".config", "opencode"),
      "opencode.json",
      '{"plugins":["om-memory-system"]}'
    );
    expect(opencodeSetup.registered(deps(home))).toBe(true);
  });

  it("reads opencode.jsonc with comments and a version", () => {
    const home = scratch();
    writeConfig(
      join(home, ".config", "opencode"),
      "opencode.jsonc",
      '{\n  // memory\n  "plugins": ["om-memory-system@6.4.0",],\n}\n'
    );
    expect(opencodeSetup.registered(deps(home))).toBe(true);
  });

  it("reads the object form of an entry", () => {
    const home = scratch();
    writeConfig(
      join(home, ".config", "opencode"),
      "opencode.json",
      '{"plugins":[{"package":"om-memory-system","options":{}}]}'
    );
    expect(opencodeSetup.registered(deps(home))).toBe(true);
  });

  it("uses XDG_CONFIG_HOME when it is set", () => {
    const home = scratch();
    const xdg = join(home, "xdg");
    writeConfig(
      join(home, ".config", "opencode"),
      "opencode.json",
      '{"plugins":["om-memory-system"]}'
    );
    expect(opencodeSetup.registered(deps(home, { XDG_CONFIG_HOME: xdg }))).toBe(false);
    writeConfig(join(xdg, "opencode"), "opencode.json", '{"plugins":["om-memory-system"]}');
    expect(opencodeSetup.registered(deps(home, { XDG_CONFIG_HOME: xdg }))).toBe(true);
  });

  it("does not count another package with a similar name", () => {
    const home = scratch();
    writeConfig(
      join(home, ".config", "opencode"),
      "opencode.json",
      '{"plugins":["om-memory-system-extra","other"]}'
    );
    expect(opencodeSetup.registered(deps(home))).toBe(false);
  });
});

describe("opencodeSetup.installSteps", () => {
  it("adds the plugin through OpenCode's own command", () => {
    expect(opencodeSetup.installSteps(deps(scratch()))).toEqual([
      expect.objectContaining({ command: "opencode", args: ["plugin", "add", "om-memory-system"] }),
    ]);
  });
});

describe("mergeCliJson", () => {
  it("adds the entry and keeps other keys and entries", () => {
    const result = mergeCliJson('{"theme": "dark", "plugins": ["other-plugin"]}');
    expect(result.state).toBe("add");
    if (result.state !== "add") return;
    expect(result.text).toContain('"theme": "dark"');
    expect(JSON.parse(result.text)).toEqual({
      theme: "dark",
      plugins: ["other-plugin", "om-memory-system"],
    });
  });

  it("keeps comments and the formatting of other lines", () => {
    const text =
      '{\n  // my theme\n  "theme": "dark",\n  "plugins": [\n    "other-plugin"\n  ]\n}\n';
    const result = mergeCliJson(text);
    expect(result.state).toBe("add");
    if (result.state !== "add") return;
    expect(result.text).toContain("  // my theme\n");
    expect(result.text).toContain('  "theme": "dark",\n');
    expect(result.text).toContain('"other-plugin"');
    expect(result.text).toContain('"om-memory-system"');
  });

  it("keeps a file indented with tabs indented with tabs", () => {
    const result = mergeCliJson(
      '{\n\t"theme": "dark",\n\t"plugins": [\n\t\t"other-plugin"\n\t]\n}\n'
    );
    expect(result.state).toBe("add");
    if (result.state !== "add") return;
    expect(result.text).toBe(
      '{\n\t"theme": "dark",\n\t"plugins": [\n\t\t"other-plugin",\n\t\t"om-memory-system"\n\t]\n}\n'
    );
  });

  it("adds a plugins key when there is none", () => {
    const result = mergeCliJson('{ "theme": "dark" }');
    expect(result.state).toBe("add");
    if (result.state !== "add") return;
    expect(JSON.parse(result.text)).toEqual({ theme: "dark", plugins: ["om-memory-system"] });
  });

  it("leaves an entry with a version alone", () => {
    expect(mergeCliJson('{"plugins": ["om-memory-system@6.4.0"]}').state).toBe("present");
    expect(mergeCliJson('{"plugins": [{"package": "om-memory-system"}]}').state).toBe("present");
  });

  it("refuses a broken file or a plugins value that is not a list", () => {
    expect(mergeCliJson("not json").state).toBe("broken");
    expect(mergeCliJson("").state).toBe("broken");
    expect(mergeCliJson("[]").state).toBe("broken");
    expect(mergeCliJson('{"plugins": "om-memory-system"}').state).toBe("broken");
  });
});

describe("opencodeSetup.fileChecks", () => {
  const cliPath = (home: string) => join(home, ".config", "opencode", "cli.json");

  it("never creates a missing cli.json", () => {
    const home = scratch();
    const [check] = opencodeSetup.fileChecks(deps(home));
    expect(check?.state).toBe("missing");
    expect(check?.path).toBe(cliPath(home));
    expect(check?.fix).toContain("om-memory-system");
    expect(() => check?.apply()).toThrow();
    expect(existsSync(cliPath(home))).toBe(false);
  });

  it("writes the merged file in place and leaves no temporary file", () => {
    const home = scratch();
    const path = writeConfig(
      join(home, ".config", "opencode"),
      "cli.json",
      '{"theme": "dark", "plugins": ["other-plugin"]}'
    );
    const [check] = opencodeSetup.fileChecks(deps(home));
    expect(check?.state).toBe("add");
    check?.apply();
    expect(JSON.parse(readFileSync(path, "utf8")).plugins).toEqual([
      "other-plugin",
      "om-memory-system",
    ]);
    expect(opencodeSetup.fileChecks(deps(home))[0]?.state).toBe("present");
    expect(
      readdirSync(join(home, ".config", "opencode")).filter((name) => name !== "cli.json")
    ).toEqual([]);
  });

  it.skipIf(process.platform === "win32")(
    "writes through a symbolic link, so the link stays a link and its target gets the entry",
    () => {
      const home = scratch();
      const target = writeConfig(join(home, "dotfiles"), "cli.json", '{"plugins": []}');
      mkdirSync(join(home, ".config", "opencode"), { recursive: true });
      symlinkSync(target, cliPath(home));
      const [check] = opencodeSetup.fileChecks(deps(home));
      expect(check?.state).toBe("add");
      check?.apply();
      expect(lstatSync(cliPath(home)).isSymbolicLink()).toBe(true);
      expect(readlinkSync(cliPath(home))).toBe(target);
      expect(JSON.parse(readFileSync(target, "utf8")).plugins).toEqual(["om-memory-system"]);
      expect(readdirSync(join(home, "dotfiles"))).toEqual(["cli.json"]);
    }
  );

  it.skipIf(process.platform === "win32")("keeps the file mode", () => {
    const home = scratch();
    const path = writeConfig(join(home, ".config", "opencode"), "cli.json", '{"plugins": []}');
    chmodSync(path, 0o600);
    const [check] = opencodeSetup.fileChecks(deps(home));
    check?.apply();
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it("keeps a change made between detection and apply", () => {
    const home = scratch();
    const path = writeConfig(join(home, ".config", "opencode"), "cli.json", '{"plugins": []}');
    const [check] = opencodeSetup.fileChecks(deps(home));
    expect(check?.state).toBe("add");
    writeFileSync(path, '{"theme": "light", "plugins": ["newer-plugin"]}');
    check?.apply();
    const saved = JSON.parse(readFileSync(path, "utf8"));
    expect(saved.theme).toBe("light");
    expect(saved.plugins).toEqual(["newer-plugin", "om-memory-system"]);
  });

  it("writes nothing when the entry arrived between detection and apply", () => {
    const home = scratch();
    const path = writeConfig(join(home, ".config", "opencode"), "cli.json", '{"plugins": []}');
    const [check] = opencodeSetup.fileChecks(deps(home));
    const newer = '{\n  // added by hand\n  "plugins": ["om-memory-system@1.0.0"]\n}';
    writeFileSync(path, newer);
    check?.apply();
    expect(readFileSync(path, "utf8")).toBe(newer);
  });

  it("never creates a cli.json removed between detection and apply", () => {
    const home = scratch();
    const path = writeConfig(join(home, ".config", "opencode"), "cli.json", '{"plugins": []}');
    const [check] = opencodeSetup.fileChecks(deps(home));
    rmSync(path);
    expect(() => check?.apply()).toThrow();
    expect(existsSync(path)).toBe(false);
  });

  it("never tells the user to create cli.json by hand", () => {
    const [check] = opencodeSetup.fileChecks(deps(scratch()));
    expect(check?.state).toBe("missing");
    expect(check?.fix).toContain("Start OpenCode once");
    expect(check?.fix.toLowerCase()).not.toContain("create");
  });

  it("changes nothing in a broken file", () => {
    const home = scratch();
    const path = writeConfig(join(home, ".config", "opencode"), "cli.json", "{ broken");
    const [check] = opencodeSetup.fileChecks(deps(home));
    expect(check?.state).toBe("broken");
    expect(() => check?.apply()).toThrow();
    expect(readFileSync(path, "utf8")).toBe("{ broken");
  });

  it("reads cli.json under XDG_CONFIG_HOME", () => {
    const home = scratch();
    const xdg = join(home, "xdg");
    writeConfig(join(xdg, "opencode"), "cli.json", '{"plugins": ["om-memory-system"]}');
    const [check] = opencodeSetup.fileChecks(deps(home, { XDG_CONFIG_HOME: xdg }));
    expect(check?.state).toBe("present");
    expect(check?.path).toBe(join(xdg, "opencode", "cli.json"));
  });
});

describe("opencodeSetup.nextStep", () => {
  it("says to restart OpenCode and its service", () => {
    const step = opencodeSetup.nextStep({
      id: "opencode",
      version: "2.1.2",
      registered: true,
      changed: true,
      captureReady: true,
      settingsUrl: "http://127.0.0.1:4747/settings#settings-section-external-api",
    });
    expect(step).toContain("Restart OpenCode");
    expect(step).toContain("opencode service restart");
  });
});
