import { describe, expect, mock, test } from "claude-code/testing";

// Run with `claude plugin test`. `bun test` does not run this file: the
// engine's own test kit supplies `claude-code/testing`.

const DEFAULT_HEALTH = "http://127.0.0.1:4747/api/health";
const HEALTH_MS = 30_000;
const STATUS_MS = 6 * 60 * 60 * 1000;
const UPDATE_COMMAND = "claude plugin update omms@omms";

type Launcher =
  | { exitCode: number; stdout: string }
  | { reject: string }
  | { hang: true }
  | { jsonVersion: string; latest: string | null; healthUrl?: string };
type Health = "ok" | "401" | "500" | "no-success" | "down" | "hang";

/** Stand-ins for the engine's process, HTTP, status, toast and footer calls. */
function world(
  on: any,
  start: { launcher: Launcher; health?: Health; clockNow?: number } = {
    launcher: { exitCode: 0, stdout: "" },
  }
) {
  const state = {
    launcher: start.launcher,
    health: start.health ?? "ok",
    healthFor: {} as Record<string, Health>,
  };
  const runs: { argv: readonly string[]; timeoutMs?: number }[] = [];
  const fetches: string[] = [];
  const statuses: (string | undefined)[] = [];
  const toasts: string[] = [];
  const clock = mock.clock(on);

  on("session.start", (_$: any, e: any) => ({ cwd: e.cwd }));
  on("process.run", (_$: any, e: any) => {
    runs.push({ argv: e.argv, timeoutMs: e.init?.timeoutMs });
    const launcher = state.launcher;
    if ("reject" in launcher) return { deny: launcher.reject };
    if ("hang" in launcher) return new Promise(() => {});
    const stdout =
      "jsonVersion" in launcher
        ? `${JSON.stringify({
            healthUrl: launcher.healthUrl ?? DEFAULT_HEALTH,
            version: launcher.jsonVersion,
            latest: launcher.latest,
          })}\n`
        : launcher.stdout;
    return {
      value: {
        exitCode: "exitCode" in launcher ? launcher.exitCode : 0,
        stdout,
        stderr: "",
        isStdoutTruncated: false,
        isStderrTruncated: false,
      },
    };
  });
  on("http.fetch", (_$: any, e: any) => {
    fetches.push(e.url);
    const health = state.healthFor[e.url] ?? state.health;
    if (health === "down") return { deny: "connection refused" };
    if (health === "hang") return new Promise(() => {});
    const status = health === "401" ? 401 : health === "500" ? 500 : 200;
    const body = health === "no-success" ? { success: false } : { success: true };
    return { value: { status, ok: status < 300, headers: {}, text: JSON.stringify(body) } };
  });
  on("ui.status", (_$: any, e: any) => {
    statuses.push(e.text);
    return { value: undefined };
  });
  // The engine's own footer: its mode labels, joined by ` & `.
  on("ui.render", { component: "SessionMode" }, (_$: any, e: any) => ({
    type: "Text",
    props: { dimColor: true },
    children: [e.props.modes.join(" & ")],
  }));
  on("ui.toast", (_$: any, e: any) => {
    toasts.push(e.text);
    return { value: undefined };
  });

  // `begin` mounts the footer.
  const footer = {} as Footer;
  return { state, runs, fetches, statuses, toasts, clock, footer };
}

const SESSION = { cwd: "/work", surface: "terminal", isInteractive: true } as const;

type Footer = { mounted?: { drawn: () => Promise<any> } };
type World = ReturnType<typeof world>;

/** Draws the prompt footer once, then starts the session. */
async function begin($: any, w: World, modes: string[] = []) {
  w.footer.mounted ??= await $.ui.mount({
    plugin: "omms",
    surface: "terminal",
    component: "SessionMode",
    props: { modes },
  });
  await $.session.start(SESSION);
  await w.clock.settle();
}

type Part = { text: string; color?: string; dimColor?: boolean };

/** The Text runs of a drawn tree, in order. */
function parts(node: any, inherited: Omit<Part, "text"> = {}): Part[] {
  if (typeof node === "string") return node ? [{ text: node, ...inherited }] : [];
  if (!node || !Array.isArray(node.children)) return [];
  const style =
    node.type === "Text"
      ? { ...inherited, color: node.props?.color, dimColor: node.props?.dimColor }
      : inherited;
  return node.children.flatMap((child: any) => parts(child, style));
}

/** The OMMS label as the footer shows it, from the dot on. */
async function last(w: World) {
  const text = parts(await w.footer.mounted!.drawn())
    .map((part) => part.text)
    .join("");
  const at = text.indexOf("● omms: ");
  return at < 0 ? undefined : text.slice(at + "● omms: ".length);
}

/** The colour of the dot and the state. */
async function colour(w: World) {
  const runs = parts(await w.footer.mounted!.drawn());
  const dot = runs.find((part) => part.text.includes("●"));
  const state = runs.find((part) => /omms: /.test(part.text));
  expect(state?.color).toBe(dot?.color);
  return dot?.color;
}

describe("omms status line", () => {
  test("reads connected when the health route answers", async ($, on) => {
    const w = world(on, { launcher: { jsonVersion: "4.3.3", latest: null } });
    await begin($, w);
    expect(await last(w)).toBe("connected");
    expect(await colour(w)).toBe("success");
  });

  test("never uses the plugin status row, which Claude Code draws with a warning sign", async ($, on) => {
    const w = world(on, { launcher: { jsonVersion: "4.3.3", latest: "4.4.0" } });
    await begin($, w);
    w.state.health = "down";
    await w.clock.advance(HEALTH_MS);
    expect(w.statuses).toEqual([]);
    const text = parts(await w.footer.mounted!.drawn())
      .map((part) => part.text)
      .join("");
    expect(text).not.toContain("⚠");
  });

  test("reads connecting in yellow until the first health check answers", async ($, on) => {
    const w = world(on, { launcher: { jsonVersion: "4.3.3", latest: null }, health: "hang" });
    await begin($, w);
    expect(await last(w)).toBe("connecting");
    expect(await colour(w)).toBe("warning");
  });

  test("keeps the engine's mode labels before the OMMS label", async ($, on) => {
    const w = world(on, { launcher: { jsonVersion: "4.3.3", latest: null } });
    await begin($, w, ["focus"]);
    const runs = parts(await w.footer.mounted!.drawn());
    expect(runs[0]).toEqual({ text: "focus", color: undefined, dimColor: true });
    expect(runs.map((part) => part.text).join("")).toBe("focus · ● omms: connected");
  });

  test("draws the label alone when the engine shows no mode", async ($, on) => {
    const w = world(on, { launcher: { jsonVersion: "4.3.3", latest: null } });
    await begin($, w);
    const text = parts(await w.footer.mounted!.drawn())
      .map((part) => part.text)
      .join("");
    expect(text).toBe("● omms: connected");
  });

  test("reads connected for a 401, because the server is running", async ($, on) => {
    const w = world(on, { launcher: { jsonVersion: "4.3.3", latest: null }, health: "401" });
    await begin($, w);
    expect(await last(w)).toBe("connected");
  });

  for (const health of ["down", "500", "no-success"] as const) {
    test(`reads web app off when the health route is ${health}`, async ($, on) => {
      const w = world(on, { launcher: { jsonVersion: "4.3.3", latest: null }, health });
      await begin($, w);
      expect(await last(w)).toBe("web app off");
      expect(await colour(w)).toBe("error");
    });
  }

  test("reads web app off when the health route does not answer in 3 seconds", async ($, on) => {
    const w = world(on, { launcher: { jsonVersion: "4.3.3", latest: null }, health: "hang" });
    await begin($, w);
    expect(await last(w)).toBe("connecting");
    await w.clock.advance(3_000);
    expect(await last(w)).toBe("web app off");
  });

  test("follows the web app within 30 seconds, off and on again", async ($, on) => {
    const w = world(on, { launcher: { jsonVersion: "4.3.3", latest: null } });
    await begin($, w);
    expect(await last(w)).toBe("connected");
    w.state.health = "down";
    await w.clock.advance(HEALTH_MS);
    expect(await last(w)).toBe("web app off");
    expect(await colour(w)).toBe("error");
    w.state.health = "ok";
    await w.clock.advance(HEALTH_MS);
    expect(await last(w)).toBe("connected");
    expect(await colour(w)).toBe("success");
  });

  test("polls the health URL the status command named", async ($, on) => {
    const url = "http://127.0.0.1:5151/api/health";
    const w = world(on, { launcher: { jsonVersion: "4.3.3", latest: null, healthUrl: url } });
    await begin($, w);
    // The first check runs before the launcher answers, on the default URL.
    expect(w.fetches.at(-1)).toBe(url);
    const before = w.fetches.length;
    await w.clock.advance(HEALTH_MS);
    expect(w.fetches.slice(before)).toEqual([url]);
  });

  test("a slow early check does not overwrite a newer one", async ($, on) => {
    const url = "http://127.0.0.1:5151/api/health";
    const w = world(on, { launcher: { jsonVersion: "4.3.3", latest: null, healthUrl: url } });
    w.state.healthFor[DEFAULT_HEALTH] = "hang";
    await begin($, w);
    expect(await last(w)).toBe("connected");
    // The early check on the default URL gives up after 3 seconds.
    await w.clock.advance(3_000);
    expect(await last(w)).toBe("connected");
  });

  test("shows the web app state while the launcher is still running", async ($, on) => {
    const w = world(on, { launcher: { hang: true } });
    await begin($, w);
    expect(await last(w)).toBe("connected");
    expect(w.fetches).toEqual([DEFAULT_HEALTH]);
  });

  test("asks the plugin launcher, built from the plugin root, with a 60 second timeout", async ($, on) => {
    const w = world(on, { launcher: { jsonVersion: "4.3.3", latest: null } });
    await begin($, w);
    expect(w.runs).toHaveLength(1);
    const { argv, timeoutMs } = w.runs[0]!;
    expect(argv[0]).toBe("node");
    expect(String(argv[1]).endsWith("/bin/omms-launch.mjs")).toBe(true);
    expect(argv.slice(2)).toEqual(["--at-least-own-version", "claude-hook", "status"]);
    expect(timeoutMs).toBe(60_000);
  });

  test("asks the launcher again every 6 hours, and polls health between", async ($, on) => {
    const w = world(on, { launcher: { jsonVersion: "4.3.3", latest: null } });
    await begin($, w);
    await w.clock.advance(STATUS_MS - 1);
    expect(w.runs).toHaveLength(1);
    await w.clock.advance(1);
    expect(w.runs).toHaveLength(2);
  });

  test("reads not installed when the launcher exits 1, with no update check", async ($, on) => {
    const w = world(on, { launcher: { exitCode: 1, stdout: "" } });
    await begin($, w);
    expect(await last(w)).toBe("not installed");
    expect(await colour(w)).toBe("error");
    expect(w.toasts).toEqual([]);
  });

  test("reads not installed when the launcher cannot start", async ($, on) => {
    const w = world(on, {
      launcher: {
        reject: "omms: $.process.run(node) failed to start: ENOENT: Executable not found",
      },
    });
    await begin($, w);
    expect(await last(w)).toBe("not installed");
  });

  test("keeps the health-only state when the launcher times out", async ($, on) => {
    const w = world(on, {
      launcher: { reject: "omms: $.process.run(node) aborted: still running after 60000ms" },
    });
    await begin($, w);
    expect(await last(w)).toBe("connected");
    expect(w.toasts).toEqual([]);
    expect(w.fetches.every((fetched) => fetched === DEFAULT_HEALTH)).toBe(true);
    // The next 6 hour step tries again and recovers.
    w.state.launcher = { jsonVersion: "4.3.3", latest: "4.4.0" };
    await w.clock.advance(STATUS_MS);
    expect(await last(w)).toBe("connected · 4.4.0 available");
  });

  test("falls back to the default health URL when the copy prints no status", async ($, on) => {
    const w = world(on, { launcher: { exitCode: 0, stdout: "" } });
    await begin($, w);
    expect(await last(w)).toBe("connected");
    expect(w.fetches.every((fetched) => fetched === DEFAULT_HEALTH)).toBe(true);
    expect(w.toasts).toEqual([]);
  });

  test("adds the newer release and shows one toast that names the plugin update", async ($, on) => {
    const w = world(on, { launcher: { jsonVersion: "4.3.3", latest: "4.4.0" } });
    await begin($, w);
    expect(await last(w)).toBe("connected · 4.4.0 available");
    expect(await colour(w)).toBe("success");
    const suffix = parts(await w.footer.mounted!.drawn()).find((part) =>
      part.text.includes("available")
    );
    expect(suffix?.dimColor).toBe(true);
    expect(suffix?.color).toBeUndefined();
    expect(w.toasts).toHaveLength(1);
    expect(w.toasts[0]).toContain("4.4.0");
    expect(w.toasts[0]).toContain(UPDATE_COMMAND);
    expect(w.toasts[0]).toContain("/reload-plugins");
    expect(w.toasts[0]).not.toContain("npm i -g");
    await w.clock.advance(STATUS_MS);
    expect(w.toasts).toHaveLength(1);
  });

  test("shows a new toast when a later release appears", async ($, on) => {
    const w = world(on, { launcher: { jsonVersion: "4.3.3", latest: "4.4.0" } });
    await begin($, w);
    w.state.launcher = { jsonVersion: "4.3.3", latest: "4.5.0" };
    await w.clock.advance(STATUS_MS);
    expect(w.toasts).toHaveLength(2);
    expect(w.toasts[1]).toContain("4.5.0");
  });

  for (const latest of ["4.4.0-next.1", "4.3.3", "4.3.2", null]) {
    test(`shows no update when npm latest is ${latest}`, async ($, on) => {
      const w = world(on, { launcher: { jsonVersion: "4.3.3", latest } });
      await begin($, w);
      expect(await last(w)).toBe("connected");
      expect(w.toasts).toEqual([]);
    });
  }

  test("treats a release as newer than the running prerelease of it", async ($, on) => {
    const w = world(on, { launcher: { jsonVersion: "4.4.0-next.1", latest: "4.4.0" } });
    await begin($, w);
    expect(await last(w)).toBe("connected · 4.4.0 available");
  });

  test("a second session start does not double the polling or the toast", async ($, on) => {
    const w = world(on, { launcher: { jsonVersion: "4.3.3", latest: "4.4.0" } });
    await begin($, w);
    await begin($, w);
    expect(w.toasts).toHaveLength(1);
    const before = w.fetches.length;
    await w.clock.advance(HEALTH_MS);
    expect(w.fetches.length - before).toBe(1);
  });
});
