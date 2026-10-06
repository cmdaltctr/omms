import { afterEach, beforeEach, expect, it, mock } from "bun:test";
import type { ReactElement, ReactNode } from "react";
import * as react from "react";

let states: unknown[] = [];
let refs: { current: unknown }[] = [];
let cursor = 0;
let refCursor = 0;
let effects: (() => unknown)[] = [];
mock.module("react", () => ({
  ...react,
  useContext: () => null,
  useMemo: (factory: () => unknown) => factory(),
  useEffect: (effect: () => unknown) => effects.push(effect),
  useRef: (value: unknown) => (refs[refCursor++] ??= { current: value }),
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
  useState: (initial: unknown) => {
    const index = cursor++;
    if (!(index in states)) states[index] = initial;
    return [
      states[index],
      (value: unknown) => {
        states[index] = typeof value === "function" ? value(states[index]) : value;
      },
    ];
  },
}));
const { DirectoryMapsSection } =
  await import("../src/lib/components/settings/DirectoryMapsSection.tsx");
const { publishSettingsSnapshot } = await import("../src/lib/settings-api.ts");
type Node = ReactElement<{ children?: ReactNode; [key: string]: unknown }>;
type PathMap = { from: string; to: string };
type Call = {
  url: string;
  method: string;
  body?: {
    revision: string;
    edits: { importPathMaps?: PathMap[]; importIgnoredDirectories?: string[] };
  };
};
const originalFetch = globalThis.fetch;
let calls: Call[] = [];
let saved: PathMap[];
let ignored: string[];
let revision: string;
let cleans: (() => void)[] = [];
const toMain = { kind: "map", target: "/main", confidence: "name" } as const;
const hostRows = {
  pi: [
    { directory: "/pi-old", sessions: 3, suggestion: toMain },
    { directory: "/tmp/scratch", sessions: 6, suggestion: { kind: "ignore", reason: "temporary" } },
    { directory: "/missing", sessions: 2, suggestion: null },
    { directory: "", sessions: 4, suggestion: null },
  ],
  opencode: [{ directory: "/opencode-old", sessions: 1, suggestion: toMain }],
  "claude-code": [
    { directory: "/claude-old", sessions: 1, suggestion: toMain },
    {
      directory: "/ext/long-name",
      sessions: 1,
      suggestion: { kind: "map", target: "/ext/ln", confidence: "guess" },
    },
  ],
} as Record<string, unknown[]> as Record<
  "pi" | "opencode" | "claude-code",
  { directory: string; sessions: number; suggestion: unknown }[]
>;
let reply: (call: Call) => Response | Promise<Response>;
function defaultReply(call: Call) {
  if (call.method === "PATCH") {
    saved = call.body!.edits.importPathMaps ?? saved;
    ignored = call.body!.edits.importIgnoredDirectories ?? ignored;
    revision = "rev-2";
    return Response.json({ migratedLegacy: false });
  }
  if (call.url === "/api/settings") return Response.json({ revision });
  return Response.json({
    saved,
    ignored,
    ...Object.fromEntries(
      Object.entries(hostRows).map(([host, rows]) => [
        host,
        rows.filter(
          (row) =>
            !saved.some((map) => map.from === row.directory) && !ignored.includes(row.directory)
        ),
      ])
    ),
  });
}
function walk(value: ReactNode): Node[] {
  if (Array.isArray(value)) return value.flatMap(walk);
  if (!react.isValidElement(value)) return [];
  const node = value as Node;
  const name = typeof node.type === "function" ? node.type.name : "";
  if (["DirectoryMapHost", "DirectoryMapReviewDialog"].includes(name)) {
    return [node, ...walk((node.type as (props: Node["props"]) => ReactNode)(node.props))];
  }
  return [node, ...walk(node.props.children)];
}
function tree() {
  cursor = 0;
  refCursor = 0;
  return walk(DirectoryMapsSection());
}
function text(value: ReactNode): string {
  if (Array.isArray(value)) return value.map(text).join("");
  if (react.isValidElement(value)) return text((value as Node).props.children);
  return value == null ? "" : String(value);
}
function button(label: string) {
  const node = tree().find(
    (node) => text(node.props.children) === label && typeof node.props.onClick === "function"
  );
  expect(node).toBeDefined();
  return node!;
}
function host(name: string) {
  return tree().find(
    (node) => node.props.host === name && typeof node.props.onResolve === "function"
  )!;
}
function review() {
  const node = tree().find(
    (node) => typeof node.type === "function" && node.type.name === "DirectoryMapReviewDialog"
  );
  expect(node?.props.review).toBeDefined();
  expect(tree().some((node) => node.props.open === true)).toBe(true);
  return node!;
}
const click = (node: Node) => (node.props.onClick as () => void)();
const flush = async () => {
  for (let i = 0; i < 6; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};
async function mount() {
  tree();
  for (const effect of effects.splice(0)) {
    const clean = effect();
    if (typeof clean === "function") cleans.push(clean as () => void);
  }
  await flush();
}
function open(name = "pi") {
  (host(name).props.onResolve as () => void)();
  return review();
}
function decisions(name = "pi") {
  return host(name).props.decisions as Record<string, { target: string }>;
}
function edit(name: keyof typeof hostRows, target: string) {
  const node = host(name);
  (node.props.onDecide as (row: unknown, target: string) => void)(hostRows[name][0], target);
}
function tick(label: string, checked: boolean) {
  const box = tree().find((node) => node.props["aria-label"] === label);
  expect(box).toBeDefined();
  (box!.props.onChange as (event: unknown) => void)({ target: { checked } });
}
function patches() {
  return calls.filter((call) => call.method === "PATCH");
}
beforeEach(() => {
  states = [];
  refs = [];
  effects = [];
  calls = [];
  cleans = [];
  revision = "rev-1";
  saved = [{ from: "/saved", to: "/keep" }];
  ignored = [];
  reply = defaultReply;
  Object.assign(globalThis, { window: { __OMMS_TOKEN__: "synthetic" } });
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const call: Call = {
      url: String(url),
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(call);
    return reply(call);
  }) as typeof fetch;
});
afterEach(() => {
  cleans.forEach((clean) => clean());
  globalThis.fetch = originalFetch;
});

for (const name of ["pi", "opencode", "claude-code"] as const) {
  it(`opens ${name} review without changing selections and saves only on Confirm`, async () => {
    await mount();
    const before = structuredClone(decisions());
    const node = open(name);
    expect(node.props.host).toBe(name);
    expect(JSON.stringify(node.props.review)).toContain(hostRows[name][0].directory);
    expect(decisions()).toEqual(before);
    expect(patches()).toHaveLength(0);
    click(button("Confirm"));
    await flush();
    expect(patches()).toHaveLength(1);
    // One save holds the ticked maps and, for Pi, the ticked ignore proposal; the guess stays out.
    expect(patches()[0].body).toEqual({
      revision: "rev-1",
      edits: {
        importPathMaps: [
          { from: "/saved", to: "/keep" },
          { from: hostRows[name][0].directory, to: "/main" },
        ],
        ...(name === "pi" ? { importIgnoredDirectories: ["/tmp/scratch"] } : {}),
      },
    });
    expect(host(name).props.rows).not.toContainEqual(hostRows[name][0]);
    expect(
      calls.every((call) => ["/api/settings", "/api/settings/import-maps"].includes(call.url))
    ).toBe(true);
    expect(text(tree().find((node) => node.props.role === "status")?.props.children)).toContain(
      "next import or backfill"
    );
  });
}
it("Cancel and Escape keep selections, edited targets and pending removals", async () => {
  await mount();
  edit("pi", "/edited");
  click(button("Remove"));
  const before = structuredClone(decisions());
  open();
  click(button("Cancel"));
  expect(decisions()).toEqual(before);
  expect(button("Keep")).toBeDefined();
  open();
  const dialog = tree().find((node) => node.props.open === true)!;
  (dialog.props.onOpenChange as (open: boolean) => void)(false);
  expect(decisions()).toEqual(before);
  expect(patches()).toHaveLength(0);
  expect(tree().some((node) => node.props.open === true)).toBe(false);
});
it("shows edited targets and disables Confirm when all targets are cleared", async () => {
  await mount();
  edit("opencode", "/edited");
  expect(JSON.stringify(open("opencode").props.review)).toContain("/edited");
  click(button("Cancel"));
  edit("opencode", "");
  open("opencode");
  expect(button("Confirm").props.disabled).toBe(true);
  expect(tree().some((node) => text(node.props.children).includes("Nothing to save."))).toBe(true);
  click(button("Confirm"));
  await flush();
  expect(patches()).toHaveLength(0);
});
it("retains unrelated drafts and pending removals, retiring confirmed shared sources", async () => {
  await mount();
  edit("opencode", "/edited-other");
  edit("pi", "/reviewed");
  click(button("Remove"));
  open();
  click(button("Confirm"));
  await flush();
  expect(patches()[0].body!.edits.importPathMaps).toEqual([
    { from: "/saved", to: "/keep" },
    { from: "/pi-old", to: "/reviewed" },
  ]);
  expect(decisions()["/opencode-old"]).toEqual({
    directory: "/opencode-old",
    target: "/edited-other",
  });
  expect(decisions()["/pi-old"]).toBeUndefined();
  expect(button("Keep")).toBeDefined();
});
it("blocks duplicate confirmation and dismissal while a save is pending", async () => {
  await mount();
  let release!: (response: Response) => void;
  reply = (call) =>
    call.method === "PATCH"
      ? new Promise((resolve) => {
          release = resolve;
        })
      : defaultReply(call);
  open();
  const confirm = button("Confirm");
  click(confirm);
  click(confirm);
  const dialog = tree().find((node) => node.props.open === true)!;
  (dialog.props.onOpenChange as (open: boolean) => void)(false);
  expect(patches()).toHaveLength(1);
  expect(tree().some((node) => node.props.open === true)).toBe(true);
  expect(button("Cancel").props.disabled).toBe(true);
  release(Response.json({ migratedLegacy: false }));
  await flush();
});
it("retains the review and drafts after a rejected save until explicit retry", async () => {
  await mount();
  edit("opencode", "/unsaved");
  reply = (call) =>
    call.method === "PATCH"
      ? Response.json({ error: "Target unavailable" }, { status: 400 })
      : defaultReply(call);
  const before = open().props.review;
  click(button("Confirm"));
  await flush();
  expect(review().props.review).toEqual(before);
  expect(decisions()["/opencode-old"].target).toBe("/unsaved");
  expect(tree().some((node) => node.props.role === "alert")).toBe(true);
  expect(patches()).toHaveLength(1);
  reply = defaultReply;
  click(button("Confirm"));
  await flush();
  expect(patches()).toHaveLength(2);
});
it("refreshes conflicting settings and saved maps without silently retrying", async () => {
  await mount();
  let conflict = true;
  reply = (call) => {
    if (call.method === "PATCH" && conflict) {
      revision = "rev-newer";
      saved.push({ from: "/newer", to: "/retain" });
      conflict = false;
      return Response.json({ error: "Changed elsewhere" }, { status: 409 });
    }
    return defaultReply(call);
  };
  open();
  click(button("Confirm"));
  await flush();
  expect(review()).toBeDefined();
  expect(patches()).toHaveLength(1);
  expect(
    tree().some(
      (node) =>
        node.props.role === "alert" && text(node.props.children).includes("Settings changed")
    )
  ).toBe(true);
  click(button("Confirm"));
  await flush();
  expect(patches()[1].body!.revision).toBe("rev-newer");
  expect(patches()[1].body!.edits.importPathMaps).toContainEqual({ from: "/newer", to: "/retain" });
});
it("reports successful persistence separately and recovers with GET only after a refresh failure", async () => {
  await mount();
  let failRefresh = true;
  reply = (call) =>
    call.url === "/api/settings/import-maps" && failRefresh
      ? Response.json({ error: "Offline" }, { status: 503 })
      : defaultReply(call);
  open();
  click(button("Confirm"));
  await flush();
  expect(patches()).toHaveLength(1);
  expect(saved).toContainEqual({ from: "/pi-old", to: "/main" });
  expect(
    tree().some(
      (node) => node.props.role === "status" && text(node.props.children).includes("saved")
    )
  ).toBe(true);
  const refresh = button("Refresh list");
  failRefresh = false;
  click(refresh);
  await flush();
  expect(patches()).toHaveLength(1);
  expect(host("pi").props.rows).not.toContainEqual(hostRows.pi[0]);
});
it("requires refresh and another review when a conflict refresh also fails", async () => {
  await mount();
  let failed = false;
  reply = (call) => {
    if (call.method === "PATCH") {
      failed = true;
      revision = "rev-newer";
      return Response.json({ error: "Changed elsewhere" }, { status: 409 });
    }
    if (failed && call.url === "/api/settings/import-maps")
      return Response.json({ error: "Offline" }, { status: 503 });
    return defaultReply(call);
  };
  open();
  click(button("Confirm"));
  await flush();
  expect(button("Confirm").props.disabled).toBe(true);
  expect(patches()).toHaveLength(1);
  reply = defaultReply;
  click(button("Refresh list"));
  await flush();
  expect(button("Confirm").props.disabled).toBe(false);
  expect(patches()).toHaveLength(1);
  click(button("Confirm"));
  await flush();
  expect(patches()[1].body!.revision).toBe("rev-newer");
});
it("retains maps from the latest published global snapshot", async () => {
  await mount();
  publishSettingsSnapshot({
    revision: "rev-latest",
    settings: {
      importPathMaps: {
        globalValue: [
          { from: "/saved", to: "/keep" },
          { from: "/newer", to: "/retain" },
        ],
      },
    },
  });
  open();
  click(button("Confirm"));
  await flush();
  expect(patches()[0].body!.revision).toBe("rev-latest");
  expect(patches()[0].body!.edits.importPathMaps).toContainEqual({ from: "/newer", to: "/retain" });
});
it("never reports a saved result when cancelling a failed conflict before recovery", async () => {
  await mount();
  let failed = false;
  reply = (call) => {
    if (call.method === "PATCH") {
      failed = true;
      return Response.json({ error: "Changed elsewhere" }, { status: 409 });
    }
    if (failed && call.url === "/api/settings/import-maps")
      return Response.json({ error: "Offline" }, { status: 503 });
    return defaultReply(call);
  };
  open();
  click(button("Confirm"));
  await flush();
  click(button("Cancel"));
  reply = defaultReply;
  click(button("Refresh list"));
  await flush();
  expect(saved).toEqual([{ from: "/saved", to: "/keep" }]);
  expect(patches()).toHaveLength(1);
  const status = tree().find((node) => node.props.role === "status");
  expect(text(status?.props.children)).not.toContain("Saved.");
  expect(text(status?.props.children)).toContain("refreshed");
});

it("shared source confirmation removes its drafts and unresolved rows for every host", async () => {
  const original = hostRows.opencode;
  hostRows.opencode = [hostRows.pi[0]];
  try {
    await mount();
    edit("opencode", "/shared");
    open();
    click(button("Confirm"));
    await flush();
    expect(saved.filter((map) => map.from === "/pi-old")).toHaveLength(1);
    expect(decisions()["/pi-old"]).toBeUndefined();
    expect(host("opencode").props.rows).toEqual([]);
  } finally {
    hostRows.opencode = original;
  }
});

it("starts guesses unticked and saves only the items left ticked", async () => {
  await mount();
  open("claude-code");
  expect(button("Confirm").props.disabled).toBe(false);
  tick("Save this map /claude-old", false);
  expect(button("Confirm").props.disabled).toBe(true);
  tick("Save this map /ext/long-name", true);
  click(button("Confirm"));
  await flush();
  expect(patches()[0].body!.edits).toEqual({
    importPathMaps: [
      { from: "/saved", to: "/keep" },
      { from: "/ext/long-name", to: "/ext/ln" },
    ],
  });
  expect(host("claude-code").props.rows).toContainEqual(hostRows["claude-code"][0]);
});

it("ignores a row at once and restores it from Ignored directories", async () => {
  await mount();
  (host("pi").props.onIgnore as (row: unknown) => void)(hostRows.pi[2]);
  await flush();
  expect(patches()[0].body).toEqual({
    revision: "rev-1",
    edits: { importIgnoredDirectories: ["/missing"] },
  });
  expect(host("pi").props.rows).not.toContainEqual(hostRows.pi[2]);
  click(button("Restore"));
  await flush();
  expect(patches()[1].body).toEqual({ revision: "rev-2", edits: { importIgnoredDirectories: [] } });
  expect(host("pi").props.rows).toContainEqual(hostRows.pi[2]);
  expect(patches().every((call) => !call.body!.edits.importPathMaps)).toBe(true);
});

it("keeps the row after a failed Ignore and does not retry", async () => {
  await mount();
  reply = (call) =>
    call.method === "PATCH"
      ? Response.json({ error: "Changed elsewhere" }, { status: 409 })
      : defaultReply(call);
  (host("pi").props.onIgnore as (row: unknown) => void)(hostRows.pi[2]);
  await flush();
  expect(patches()).toHaveLength(1);
  expect(host("pi").props.rows).toContainEqual(hostRows.pi[2]);
  const status = tree().find((node) => node.props.role === "status");
  expect(text(status?.props.children)).toContain("Settings changed elsewhere");
});

it("saves removals only through Save removals", async () => {
  await mount();
  expect(button("Save removals").props.disabled).toBe(true);
  click(button("Remove"));
  edit("pi", "/unsaved");
  click(button("Save removals"));
  await flush();
  expect(patches()[0].body!.edits).toEqual({ importPathMaps: [] });
  expect(decisions()["/pi-old"]).toEqual({ directory: "/pi-old", target: "/unsaved" });
  expect(tree().some((node) => text(node.props.children) === "Save maps")).toBe(false);
});

it("restores an ignored directory written in another form in the config file", async () => {
  ignored = ["/scratch"];
  await mount();
  // The file holds "/scratch/"; the server shows the resolved "/scratch".
  publishSettingsSnapshot({
    revision: "rev-1",
    settings: { importIgnoredDirectories: { globalValue: ["/scratch/"] } },
  });
  click(button("Restore"));
  await flush();
  expect(patches()[0].body!.edits).toEqual({ importIgnoredDirectories: [] });
});

it("refreshes the list after a conflicting Ignore, so a retry keeps ignores saved elsewhere", async () => {
  await mount();
  let conflict = true;
  reply = (call) => {
    if (call.method === "PATCH" && conflict) {
      conflict = false;
      revision = "rev-newer";
      ignored = ["/elsewhere"];
      return Response.json({ error: "Changed elsewhere" }, { status: 409 });
    }
    return defaultReply(call);
  };
  (host("pi").props.onIgnore as (row: unknown) => void)(hostRows.pi[2]);
  await flush();
  (host("pi").props.onIgnore as (row: unknown) => void)(hostRows.pi[2]);
  await flush();
  expect(patches()).toHaveLength(2);
  expect(patches()[1].body).toEqual({
    revision: "rev-newer",
    edits: { importIgnoredDirectories: ["/elsewhere", "/missing"] },
  });
});

it("blocks Ignore after a conflict until the list is refreshed", async () => {
  await mount();
  let offline = false;
  reply = (call) => {
    if (call.method === "PATCH") {
      offline = true;
      return Response.json({ error: "Changed elsewhere" }, { status: 409 });
    }
    if (offline && call.url === "/api/settings/import-maps")
      return Response.json({ error: "Offline" }, { status: 503 });
    return defaultReply(call);
  };
  (host("pi").props.onIgnore as (row: unknown) => void)(hostRows.pi[2]);
  await flush();
  expect(host("pi").props.busy).toBe(true);
  (host("pi").props.onIgnore as (row: unknown) => void)(hostRows.pi[2]);
  await flush();
  expect(patches()).toHaveLength(1);
  offline = false;
  reply = defaultReply;
  click(button("Refresh list"));
  await flush();
  expect(host("pi").props.busy).toBe(false);
});

it("removes a saved map written as ~/x in the config file", async () => {
  await mount();
  // The file holds "~/saved"; the server shows the resolved "/saved".
  publishSettingsSnapshot({
    revision: "rev-1",
    settings: { importPathMaps: { globalValue: [{ from: "~/saved", to: "/keep" }] } },
  });
  click(button("Remove"));
  click(button("Save removals"));
  await flush();
  expect(patches()[0].body!.edits).toEqual({ importPathMaps: [] });
});

it("reloads the list when another section saves, so Ignore keeps newer ignores", async () => {
  await mount();
  // Another tab or section saved: the server now holds a newer ignored list.
  ignored = ["/elsewhere"];
  revision = "rev-newer";
  publishSettingsSnapshot({ revision: "rev-newer" });
  await flush();
  (host("pi").props.onIgnore as (row: unknown) => void)(hostRows.pi[2]);
  await flush();
  expect(patches()[0].body).toEqual({
    revision: "rev-newer",
    edits: { importIgnoredDirectories: ["/elsewhere", "/missing"] },
  });
});
