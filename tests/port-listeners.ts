/**
 * Process ids that listen on a local TCP port. macOS and Linux use `lsof`.
 * Windows has no `lsof`, so it reads `netstat -ano` instead.
 */
export async function listeners(port: number): Promise<string[]> {
  if (process.platform === "win32")
    return parseNetstatListeners(await output(["netstat", "-ano", "-p", "TCP"]), port);
  return (await output(["lsof", "-ti", `tcp:${port}`, "-sTCP:LISTEN"])).split("\n").filter(Boolean);
}

/** Reads `netstat -ano` rows such as `TCP  127.0.0.1:4747  0.0.0.0:0  LISTENING  1234`. */
export function parseNetstatListeners(text: string, port: number): string[] {
  const pids = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const [protocol, local, , state, pid] = line.trim().split(/\s+/);
    if (protocol === "TCP" && state === "LISTENING" && local?.endsWith(`:${port}`) && pid) {
      pids.add(pid);
    }
  }
  return [...pids];
}

async function output(command: string[]): Promise<string> {
  const proc = Bun.spawn(command, { stdout: "pipe" });
  const text = await new Response(proc.stdout).text();
  await proc.exited;
  return text;
}
