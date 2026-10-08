import { afterEach, beforeEach, expect, it, mock } from "bun:test";
import * as react from "react";
import type { ReactElement, ReactNode } from "react";
import { setLanguage } from "../src/lib/i18n/index.ts";
import { useSettingsText } from "../src/lib/i18n/settings.ts";

let state: unknown[] = [],
  refs: { current: unknown }[] = [],
  deps: unknown[][] = [];
let cursor = 0,
  refCursor = 0,
  effectCursor = 0;
let effects: (() => unknown)[] = [];
const cleanups: (() => void)[] = [];
let poll: (() => void) | undefined;
mock.module("react", () => ({
  ...react,
  useContext: () => null,
  useMemo: (factory: () => unknown) => factory(),
  useSyncExternalStore: (_s: unknown, snapshot: () => unknown) => snapshot(),
  useRef: (value: unknown) => (refs[refCursor++] ??= { current: value }),
  useEffect: (effect: () => unknown, dependencies: unknown[] = []) => {
    const index = effectCursor++;
    if (!deps[index] || dependencies.some((value, i) => value !== deps[index][i]))
      effects.push(effect);
    deps[index] = dependencies;
  },
  useState: (initial: unknown) => {
    const index = cursor++;
    if (!(index in state)) state[index] = typeof initial === "function" ? initial() : initial;
    return [
      state[index],
      (value: unknown) => {
        state[index] = typeof value === "function" ? value(state[index]) : value;
      },
    ];
  },
}));
const requests: { path: string; body?: Record<string, any> }[] = [];
let current: any = null;
let confirmText = "";
let preset = 0;
let previewReply: Record<string, any> | null = null;
let rejectedPreflight = "";
let totalSessions = 1;
let currentRead: ((value: Response) => void) | undefined;
let piAvailable = true;
let externalState = "ready";
let deferred: ((value: Response) => void) | undefined;
const response = (value: unknown) => new Response(JSON.stringify(value));
Object.assign(globalThis, {
  window: {
    location: { pathname: "/memory", hash: "" },
    confirm: (text: string) => {
      confirmText = text;
      return true;
    },
  },
  setInterval: (callback: () => void) => {
    poll = callback;
    return 1;
  },
  clearInterval: () => {
    poll = undefined;
  },
  fetch: async (path: string, options: RequestInit = {}) => {
    const body = options.body ? JSON.parse(String(options.body)) : undefined;
    requests.push({ path, body });
    if (path.endsWith("/readiness"))
      return response({
        external: { state: externalState, provider: "synthetic", model: "model" },
        opencode: { available: false, models: [] },
        piReader: { available: piAvailable },
      });
    if (path.endsWith("/current")) {
      if (currentRead)
        return new Promise<Response>((resolve) => {
          currentRead = resolve;
        });
      return response({ job: current });
    }
    if (path.endsWith("/sessions"))
      return response({
        source: { sourceToken: `token-${body.host}`, displayPath: `/synthetic/${body.host}` },
        total: totalSessions,
        offset: body.offset,
        rows: [
          {
            key: body.offset ? "later" : "same-id",
            sessionId: body.offset ? "later" : "same-id",
            directory: "/project",
            via: "recorded",
            selectable: true,
          },
        ],
        unresolvedCount: 0,
        revision: `revision-${body.host}`,
        listedAt: 100,
      });
    if (path.endsWith("/current/cancel"))
      return response({ job: { ...current, state: "cancelling" } });
    if (path === "/api/settings/imports") {
      if (rejectedPreflight)
        return new Response(JSON.stringify({ error: rejectedPreflight }), { status: 409 });
      if (deferred)
        return new Promise<Response>((resolve) => {
          deferred = resolve;
        });
      if (previewReply && body.options.dryRun) return response(previewReply);
      return response({
        id: "group",
        dryRun: body.options.dryRun,
        state: "done",
        hosts: body.hosts?.map((child: any) => ({
          host: child.host,
          state: "done",
          sessions: 1,
          processed: 2,
          total: 2,
        })),
        sessions: 1,
        processed: 2,
        total: 2,
      });
    }
    return response({});
  },
});
const { ImportSection } = await import("../src/lib/components/settings/ImportSection.tsx");
type Node = ReactElement<{ children?: ReactNode; [key: string]: any }>;
function nodes(node: ReactNode): Node[] {
  if (!react.isValidElement(node)) return Array.isArray(node) ? node.flatMap(nodes) : [];
  const element = node as Node;
  if (element.props.hidden) return [];
  if (
    typeof element.type === "function" &&
    ["ImportOptions", "HostSessionSelection", "ImportResults"].includes(element.type.name)
  )
    return nodes(element.type(element.props));
  return [element, ...nodes(element.props.children)];
}
function render() {
  cursor = 0;
  refCursor = 0;
  effectCursor = 0;
  return nodes(ImportSection({ profilePreset: preset }));
}
const text = (node: ReactNode): string =>
  react.isValidElement(node)
    ? text((node as Node).props.children)
    : Array.isArray(node)
      ? node.map(text).join("")
      : typeof node === "boolean"
        ? ""
        : String(node ?? "");
const button = (name: string) =>
  render().find((node) => node.type === "button" && text(node) === name)!;
const input = (label: string) => render().find((node) => node.props["aria-label"] === label)!;
async function click(name: string) {
  const node = button(name);
  expect(node).toBeDefined();
  await node.props.onClick();
  await settle();
}
async function settle() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}
function runEffects() {
  for (const effect of effects.splice(0)) {
    const cleanup = effect();
    if (typeof cleanup === "function") cleanups.push(cleanup as () => void);
  }
}
async function mount() {
  render();
  runEffects();
  await settle();
}
async function choosePi() {
  await click("List sessions");
  await click("Select all matching (1)");
}
beforeEach(() => {
  state = [];
  refs = [];
  deps = [];
  effects = [];
  requests.length = 0;
  current = null;
  confirmText = "";
  deferred = undefined;
  preset = 0;
  previewReply = null;
  rejectedPreflight = "";
  totalSessions = 1;
  currentRead = undefined;
  piAvailable = true;
  externalState = "ready";
  setLanguage("en");
});
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});
for (const language of ["zh", "ar", "en"] as const) {
  for (const [host, reason] of [
    ["Pi", "The session list is out of date. Refresh the list and try again."],
    ["Claude Code", "The history source changed. Choose it again."],
    ["OpenCode", "An OpenCode import is already running"],
    ["Pi", "future-code. Refresh the preview and retry."],
    ["OpenCode", "provider/model-v2 unavailable [REDACTED]"],
  ]) {
    it(`${language}: localises HTTP-rejected preflight feedback for ${host}: ${reason}`, async () => {
      setLanguage(language);
      const s = useSettingsText();
      await mount();
      await click(s("List sessions"));
      await click(`${s("Select all matching")} (1)`);
      rejectedPreflight = `${host}: ${reason}`;
      expect(button(s("Preview (dry run)")).props.disabled).toBe(false);
      await click(s("Preview (dry run)"));
      const alert = render().find((node) => node.props.role === "alert")!;
      expect(alert).toBeDefined();
      const retry = "Refresh the preview and retry.";
      const expected = reason!.startsWith("future-code.") ? `future-code. ${s(retry)}` : s(reason!);
      expect(text(alert)).toBe(`${host}: ${expected}`);
      expect(
        nodes(alert).some(
          (node) => node.type === "bdi" && node.props.dir === "ltr" && text(node) === host
        )
      ).toBe(true);
      if (reason!.startsWith("future-code."))
        expect(
          nodes(alert).some(
            (node) =>
              node.type === "bdi" && node.props.dir === "ltr" && text(node) === "future-code"
          )
        ).toBe(true);
      expect(button(s("Start import")).props.disabled).toBe(true);
      expect(requests.filter((request) => request.path === "/api/settings/imports")).toHaveLength(
        1
      );
      expect(confirmText).toBe("");
    });
  }
}

it("keeps a new preview when an older reconnect response finishes late", async () => {
  currentRead = () => {};
  await mount();
  await choosePi();
  await click("Preview (dry run)");
  expect(button("Start import").props.disabled).toBe(false);
  currentRead!(response({ job: null }));
  await settle();
  expect(button("Start import").props.disabled).toBe(false);
});
it("defaults to Pi/current project and positive outputs outside Advanced, and refuses no outputs", async () => {
  await mount();
  expect(input("Project memories").props.checked).toBe(true);
  expect(input("User profile").props.checked).toBe(true);
  expect(input("Scope").props.value).toBe("current-project");
  expect(input("Pi").props.checked).toBe(true);
  input("Project memories").props.onChange({ target: { checked: false } });
  input("User profile").props.onChange({ target: { checked: false } });
  expect(button("Preview (dry run)").props.disabled).toBe(true);
  expect(button("Start import").props.disabled).toBe(true);
  expect(
    render().some(
      (node) => node.props.role === "alert" && text(node).includes("Choose at least one output.")
    )
  ).toBe(true);
});
it("requires current preview, maps positive outputs to skip flags, and confirms all paid-work details", async () => {
  await mount();
  await choosePi();
  expect(button("Start import").props.disabled).toBe(true);
  input("Project memories").props.onChange({ target: { checked: false } });
  await click("Preview (dry run)");
  const preview = requests.find((request) => request.path === "/api/settings/imports")!.body!;
  expect(preview.hosts.map((child: any) => child.host)).toEqual(["pi"]);
  expect(preview.options).toMatchObject({
    skipMemories: true,
    skipProfile: false,
    scope: "current-project",
    dryRun: true,
  });
  expect(button("Start import").props.disabled).toBe(false);
  await click("Start import");
  for (const part of [
    "Pi",
    "Current project",
    "User profile",
    "Saved external API",
    "synthetic/model",
    "model calls",
    "1",
  ])
    expect(confirmText).toContain(part);
});
it("invalidates preview on output, force, date, batch, map, model and scope changes", async () => {
  await mount();
  await choosePi();
  await click("Preview (dry run)");
  input("User profile").props.onChange({ target: { checked: false } });
  expect(button("Start import").props.disabled).toBe(true);
  await click("Preview (dry run)");
  await click("Advanced options");
  for (const [label, value] of [
    ["Re-analyse handled history", true],
    ["Prompt date from", "2026-01-01"],
    ["Prompt date to", "2026-01-02"],
    ["Profile batch size", "25"],
  ] as const) {
    input(label).props.onChange({ target: { value, checked: value } });
    expect(button("Start import").props.disabled).toBe(true);
    await click("Preview (dry run)");
  }
  input("Import model").props.onChange({ target: { value: "" } });
  expect(button("Start import").props.disabled).toBe(true);
  input("Import model").props.onChange({ target: { value: "external" } });
  await click("Preview (dry run)");
  input("Directory maps (old=new, one per line)").props.onChange({
    target: { value: "/old=/new" },
  });
  expect(button("Start import").props.disabled).toBe(true);
  expect(button("Preview (dry run)").props.disabled).toBe(true);
  await click("Refresh list");
  await click("Select all matching (1)");
  await click("Preview (dry run)");
  input("Scope").props.onChange({ target: { value: "all-projects" } });
  expect(button("Start import").props.disabled).toBe(true);
  expect(button("Preview (dry run)").props.disabled).toBe(true);
});
it("preserves independent host selections when deselected and submits canonical grouped children", async () => {
  await mount();
  await choosePi();
  await click("All hosts");
  const lists = render().filter(
    (node) => node.type === "button" && ["List sessions", "Refresh list"].includes(text(node))
  );
  for (const node of lists.slice(1)) {
    await node.props.onClick();
    await settle();
  }
  for (const node of render().filter(
    (node) => node.type === "button" && text(node) === "Select all matching (1)"
  ))
    node.props.onClick();
  input("Pi").props.onChange({ target: { checked: false } });
  input("Pi").props.onChange({ target: { checked: true } });
  await click("Preview (dry run)");
  const body = requests.filter((request) => request.path === "/api/settings/imports").at(-1)!.body!;
  expect(body.hosts.map((child: any) => child.host)).toEqual(["pi", "opencode", "claude-code"]);
  expect(body.hosts.map((child: any) => child.selection.revision)).toEqual([
    "revision-pi",
    "revision-opencode",
    "revision-claude-code",
  ]);
  expect(body.options.scope).toBe("current-project");
  setLanguage("ar");
  expect(input("Pi").props.checked).toBe(true);
  setLanguage("en");
});
it("keeps explicit selections across pages and invalidates a source override", async () => {
  totalSessions = 60;
  await mount();
  await click("List sessions");
  input("Pi: Select same-id").props.onChange();
  await click("Next");
  input("Pi: Select later").props.onChange();
  await click("Preview (dry run)");
  const selected = requests.filter((request) => request.path === "/api/settings/imports").at(-1)!
    .body!.hosts[0].selection;
  expect(selected.sessions.map((session: any) => session.key)).toEqual(["same-id", "later"]);
  expect(selected.listedAt).toBe(100);
  await click("Advanced options");
  const picker = render().find(
    (node) => typeof node.type === "function" && node.type.name === "ImportSourcePicker"
  )!;
  picker.props.onChoose({ sourceToken: "new-source", displayPath: "/backup", kind: "pi-folder" });
  expect(button("Start import").props.disabled).toBe(true);
  expect(button("Preview (dry run)").props.disabled).toBe(true);
});
it("maps default and memory-only outputs without changing importer flag meanings", async () => {
  await mount();
  await choosePi();
  await click("Preview (dry run)");
  expect(
    requests.filter((request) => request.path === "/api/settings/imports").at(-1)!.body!.options
  ).toMatchObject({ skipMemories: false, skipProfile: false });
  input("User profile").props.onChange({ target: { checked: false } });
  await click("Preview (dry run)");
  expect(
    requests.filter((request) => request.path === "/api/settings/imports").at(-1)!.body!.options
  ).toMatchObject({ skipMemories: false, skipProfile: true });
});
it("requires an explicit host, lets an unavailable reader be removed, and still previews without a ready model", async () => {
  piAvailable = false;
  externalState = "missing-url";
  await mount();
  expect(button("List sessions").props.disabled).toBe(true);
  expect(render().map(text).join(" ")).toContain("Fix the reader or deselect Pi");
  input("Pi").props.onChange({ target: { checked: false } });
  expect(button("Preview (dry run)").props.disabled).toBe(true);
  expect(render().map(text).join(" ")).toContain("Choose at least one host.");
  input("OpenCode").props.onChange({ target: { checked: true } });
  await click("List sessions");
  await click("Select all matching (1)");
  expect(button("Preview (dry run)").props.disabled).toBe(false);
  await click("Preview (dry run)");
  expect(button("Start import").props.disabled).toBe(true);
  expect(render().map(text).join(" ")).toContain("memoryApiUrl");
});
it("invalidates preview on shared config revisions while keeping selections", async () => {
  await mount();
  await choosePi();
  await click("Preview (dry run)");
  const { publishSettingsSnapshot } = await import("../src/lib/settings-api.ts");
  publishSettingsSnapshot({ revision: "new-revision" });
  await settle();
  expect(button("Start import").props.disabled).toBe(true);
  expect(render().map(text).join(" ")).toContain("Selected: 1 / 1");
});
it("applies a forced profile-only preset without starting work and still requires review", async () => {
  await mount();
  await choosePi();
  await click("Preview (dry run)");
  const before = requests.filter((request) => request.path === "/api/settings/imports").length;
  preset = 1;
  render();
  for (const effect of effects.splice(0)) effect();
  await settle();
  expect(input("Project memories").props.checked).toBe(false);
  expect(input("User profile").props.checked).toBe(true);
  expect(button("Start import").props.disabled).toBe(true);
  expect(requests.filter((request) => request.path === "/api/settings/imports")).toHaveLength(
    before
  );
  await click("Preview (dry run)");
  expect(
    requests.filter((request) => request.path === "/api/settings/imports").at(-1)!.body!.options
  ).toMatchObject({ force: true, skipMemories: true, skipProfile: false });
});
it("refuses duplicate preview requests even from the same render", async () => {
  await mount();
  await choosePi();
  deferred = () => {};
  const start = button("Preview (dry run)").props.onClick;
  const pending = start();
  const duplicate = start();
  await settle();
  expect(requests.filter((request) => request.path === "/api/settings/imports")).toHaveLength(1);
  deferred!(response({ id: "preview", dryRun: true, state: "done", hosts: [] }));
  await pending;
  await duplicate;
});
it("accepts a valid no-work host and blocks a preview with a per-host blocker", async () => {
  totalSessions = 0;
  await mount();
  await click("List sessions");
  previewReply = {
    id: "empty",
    dryRun: true,
    state: "done",
    hosts: [{ host: "pi", state: "no-work", sessions: 0, total: 0 }],
  };
  expect(button("Preview (dry run)").props.disabled).toBe(false);
  await click("Preview (dry run)");
  expect(render().map(text).join(" ")).toContain("No work to process");
  previewReply = {
    id: "blocked",
    dryRun: true,
    state: "done",
    hosts: [{ host: "pi", state: "done", blocker: "Synthetic model blocker" }],
  };
  await click("Preview (dry run)");
  expect(button("Start import").props.disabled).toBe(true);
  expect(render().map(text).join(" ")).toContain("Synthetic model blocker");
});
it("reconnects a server-owned job without submission or advancing hosts", async () => {
  current = {
    id: "existing",
    dryRun: false,
    state: "running",
    activeHost: "opencode",
    hosts: [
      { host: "pi", state: "done" },
      {
        host: "opencode",
        state: "running",
        phase: "profile",
        profileProcessed: 1,
        profileTotal: 2,
      },
      { host: "claude-code", state: "queued" },
    ],
  };
  await mount();
  expect(requests.filter((request) => request.path === "/api/settings/imports")).toHaveLength(0);
  expect(render().map(text).join(" ")).toContain("Learning profile");
  expect(render().map(text).join(" ")).toContain("queued");
  expect(button("Start import").props.disabled).toBe(true);
  render();
  runEffects();
  current = {
    ...current,
    state: "running",
    hosts: [
      { host: "pi", state: "done", total: 3, processed: 3 },
      {
        host: "opencode",
        state: "running",
        phase: "profile",
        profileProcessed: 2,
        profileTotal: 4,
      },
      { host: "claude-code", state: "queued" },
    ],
  };
  poll!();
  await settle();
  expect(render().map(text).join(" ")).toContain("Profile batches: 2/4");
  await click("Cancel after current unit");
  expect(requests.filter((request) => request.path.endsWith("/current/cancel"))).toHaveLength(1);
  expect(render().map(text).join(" ")).toContain("Pi · done");
  expect(requests.filter((request) => request.path === "/api/settings/imports")).toHaveLength(0);
});
