import { afterEach, beforeEach, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installProblem as launcherProblem } from "../bin/omms-launch.mjs";
import { installProblem } from "../src/services/install-check.js";

// The install check finds a half-written copy, such as the global install of
// 14 November whose `js-base64` folder was empty. The launcher holds the same
// logic, because it cannot import src/, so every case runs through both.

let base: string;
beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "omms-install-check-"));
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

function pkg(folder: string, body: Record<string, unknown> = {}): void {
  mkdirSync(folder, { recursive: true });
  writeFileSync(
    join(folder, "package.json"),
    JSON.stringify({ name: "x", version: "1.0.0", ...body })
  );
}

/** An OMMS copy with its entry file and the given `package.json` fields. */
function copy(root: string, fields: Record<string, unknown> = {}): string {
  pkg(root, { name: "om-memory-system", version: "6.4.0", ...fields });
  mkdirSync(join(root, "dist", "cli"), { recursive: true });
  writeFileSync(join(root, "dist", "cli", "index.js"), "");
  return root;
}

const deps = { dependencies: { hono: "^4", "@libsql/client": "^0.17" } };

/** Each case builds a folder and names the problem both checks must report. */
const cases: [string, () => string, string | null][] = [
  [
    "a complete copy with nested packages",
    () => {
      const root = copy(join(base, "complete"), deps);
      pkg(join(root, "node_modules", "hono"));
      pkg(join(root, "node_modules", "@libsql", "client"));
      pkg(join(root, "node_modules", "js-base64"));
      mkdirSync(join(root, "node_modules", ".bin"), { recursive: true });
      writeFileSync(join(root, "node_modules", ".package-lock.json"), "{}");
      return root;
    },
    null,
  ],
  [
    "an empty dependency folder",
    () => {
      const root = copy(join(base, "empty-dep"), deps);
      mkdirSync(join(root, "node_modules", "hono"), { recursive: true });
      pkg(join(root, "node_modules", "@libsql", "client"));
      return root;
    },
    "hono",
  ],
  [
    "an empty folder of a dependency's dependency (the js-base64 case)",
    () => {
      const root = copy(join(base, "empty-nested"), deps);
      pkg(join(root, "node_modules", "hono"));
      pkg(join(root, "node_modules", "@libsql", "client"));
      mkdirSync(join(root, "node_modules", "js-base64"), { recursive: true });
      return root;
    },
    "js-base64",
  ],
  [
    "an empty scoped dependency folder",
    () => {
      const root = copy(join(base, "empty-scoped"), deps);
      pkg(join(root, "node_modules", "hono"));
      mkdirSync(join(root, "node_modules", "@libsql", "client"), { recursive: true });
      return root;
    },
    "@libsql/client",
  ],
  [
    "a dependency that is not installed anywhere",
    () => copy(join(base, "missing"), { dependencies: { hono: "^4" } }),
    "hono",
  ],
  [
    "dependencies hoisted to a parent node_modules, as in a host cache",
    () => {
      const modules = join(base, "cache", "node_modules");
      const root = copy(join(modules, "om-memory-system"), deps);
      pkg(join(modules, "hono"));
      pkg(join(modules, "@libsql", "client"));
      // An unrelated empty folder beside the copy belongs to someone else.
      mkdirSync(join(modules, "other"), { recursive: true });
      return root;
    },
    null,
  ],
  [
    "a missing optional dependency",
    () =>
      copy(join(base, "optional"), {
        dependencies: { fsevents: "^2" },
        optionalDependencies: { fsevents: "^2" },
      }),
    null,
  ],
  [
    "a copy without its entry file",
    () => {
      const root = copy(join(base, "no-entry"));
      rmSync(join(root, "dist"), { recursive: true });
      return root;
    },
    "dist/cli/index.js",
  ],
  [
    "a copy without package.json",
    () => {
      const root = copy(join(base, "no-package"));
      rmSync(join(root, "package.json"));
      return root;
    },
    "package.json",
  ],
];

for (const [name, build, expected] of cases) {
  it(`reports ${expected ?? "nothing"} for ${name}, in src and in the launcher`, () => {
    const root = build();
    expect(installProblem(root)).toBe(expected);
    expect(launcherProblem(root)).toBe(expected);
  });
}
