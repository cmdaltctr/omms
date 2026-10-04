import { expect, it } from "bun:test";
import { resolve } from "node:path";
import { runBunTest, TEST_PARENT_TIMEOUT_MS } from "./test-process.js";

it(
  "runs the web language menu interaction tests",
  async () => {
    const web = resolve(import.meta.dir, "../web");
    const { exitCode, output } = await runBunTest(
      [
        `--tsconfig-override=${resolve(web, "tsconfig.app.json")}`,
        "tests/language-menu-interactions.spec.tsx",
      ],
      { cwd: web }
    );
    expect(exitCode, output).toBe(0);
  },
  TEST_PARENT_TIMEOUT_MS
);
