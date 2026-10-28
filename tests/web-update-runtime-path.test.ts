import { expect, it } from "bun:test";
import { nodeInstallDeps } from "../src/services/web-update-runtime.js";

it("runs npm with the PATH the installer chose", async () => {
  const child = nodeInstallDeps().spawn(
    process.execPath,
    ["-e", "process.stderr.write(process.env.PATH ?? '')"],
    { shell: false, path: "/omms-test-marker:/usr/bin" }
  );
  let stderr = "";
  child.stderr?.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
  await new Promise((resolve) => child.on("exit", resolve));
  expect(stderr).toBe("/omms-test-marker:/usr/bin");
});
