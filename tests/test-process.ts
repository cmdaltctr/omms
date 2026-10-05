import { join } from "node:path";

// A child test/hook gets the same default as the Windows suite. Process startup
// and cleanup have their own budget, and the parent can still report failures.
export const NESTED_TEST_TIMEOUT_MS = 30_000;
export const TEST_PROCESS_TIMEOUT_MS = 45_000;
export const TEST_PARENT_TIMEOUT_MS = 60_000;

/** Run a Bun child with a bounded deadline, both output streams, and its exit code. */
export async function runBunProcess(
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; timeout?: number } = {}
): Promise<{ exitCode: number; stdout: string; output: string }> {
  const child = Bun.spawn({
    cmd: [process.execPath, ...args],
    cwd: options.cwd ?? join(import.meta.dir, ".."),
    env: options.env ?? process.env,
    stdout: "pipe",
    stderr: "pipe",
    timeout: options.timeout ?? TEST_PROCESS_TIMEOUT_MS,
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { exitCode, stdout, output: `${stdout}\n${stderr}` };
}

/** Run nested Bun tests with explicit deadlines and drain both output pipes. */
export async function runBunTest(
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; timeout?: number } = {}
): Promise<{ exitCode: number; output: string }> {
  const { exitCode, output } = await runBunProcess(
    ["test", "--timeout", String(NESTED_TEST_TIMEOUT_MS), ...args],
    options
  );
  return { exitCode, output };
}
