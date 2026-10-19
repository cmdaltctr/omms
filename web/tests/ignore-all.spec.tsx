import { afterAll, beforeEach, expect, it, mock } from "bun:test";
import * as react from "react";
import type { ReactElement, ReactNode } from "react";

// The same hook harness as the other Memory interaction specs.
let state: unknown[] = [];
let refs: { current: unknown }[] = [];
let deps: unknown[][] = [];
let cursor = 0;
let refCursor = 0;
let effectCursor = 0;
let effects: (() => unknown)[] = [];
mock.module("react", () => ({
  ...react,
  useContext: () => null,
  useMemo: (factory: () => unknown) => factory(),
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
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

const originalFetch = globalThis.fetch;
const originalWindow = globalThis.window;
Object.assign(globalThis, { window: { location: { pathname: "/memory", hash: "" } } });
const patches: { edits: Record<string, unknown>; revision: string }[] = [];
let patchStatus = 200;
// What the server has saved; a real save hides these directories from the list.
let serverIgnored: string[] = [];
const rows = [
  { directory: "/private/tmp/oc-mem-phase1/project", sessions: 7, suggestion: null },
  { directory: "/Users/me/Open Design/x", sessions: 13, suggestion: null },
  { directory: "", sessions: 1, suggestion: null },
];
globalThis.fetch = (async (path: string, options: RequestInit = {}) => {
  if (options.method === "PATCH") {
    const sent = JSON.parse(String(options.body));
    patches.push(sent);
    if (patchStatus === 200 && sent.edits.importIgnoredDirectories) {
      serverIgnored = sent.edits.importIgnoredDirectories;
    }
    return new Response(JSON.stringify(patchStatus === 200 ? {} : { error: "stale" }), {
      status: patchStatus,
    });
  }
  const value =
    path === "/api/settings"
      ? { revision: "r1", settings: { importPathMaps: { globalValue: [] } } }
      : {
          saved: [],
          ignored: serverIgnored,
          pi: [],
          opencode: rows.filter((row) => !serverIgnored.includes(row.directory)),
          "claude-code": [],
        };
  return new Response(JSON.stringify(value));
}) as typeof fetch;

const { DirectoryMapsSection } =
  await import("../src/lib/components/memory/DirectoryMapsSection.tsx");
const { DirectoryMapHost } = await import("../src/lib/components/settings/DirectoryMapHost.tsx");
const { IgnoreAllDialog } = await import("../src/lib/components/settings/IgnoreAllDialog.tsx");

type Node = ReactElement<{ children?: ReactNode; [key: string]: any }>;
function nodes(node: ReactNode): Node[] {
  if (!react.isValidElement(node)) return Array.isArray(node) ? node.flatMap(nodes) : [];
  const element = node as Node;
  return [element, ...nodes(element.props.children)];
}
function render() {
  cursor = refCursor = effectCursor = 0;
  const tree = nodes(DirectoryMapsSection({ hosts: ["opencode"], saved: false }));
  for (const effect of effects.splice(0)) effect();
  return tree;
}
async function settle() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}
const host = (tree: Node[]) => tree.find((node) => node.type === DirectoryMapHost)!;
const dialog = (tree: Node[]) => tree.find((node) => node.type === IgnoreAllDialog);

async function open() {
  render();
  await settle();
  const tree = render();
  host(tree).props.onIgnoreAll();
  return render();
}

beforeEach(() => {
  state = [];
  refs = [];
  deps = [];
  effects = [];
  patches.length = 0;
  patchStatus = 200;
  serverIgnored = ["/old/ignored"];
});

it("lists every directory, without the no-directory entry, before anything is saved", async () => {
  const tree = await open();
  const shown = dialog(tree)!;
  expect(shown.props.host).toBe("opencode");
  expect(shown.props.rows.map((row: { directory: string }) => row.directory)).toEqual([
    "/private/tmp/oc-mem-phase1/project",
    "/Users/me/Open Design/x",
  ]);
  expect(patches).toHaveLength(0);
});

it("saves all listed directories in one settings save when confirmed", async () => {
  const tree = await open();
  dialog(tree)!.props.onConfirm();
  await settle();
  expect(patches).toHaveLength(1);
  expect(patches[0].revision).toBe("r1");
  expect(patches[0].edits).toEqual({
    importIgnoredDirectories: [
      "/old/ignored",
      "/private/tmp/oc-mem-phase1/project",
      "/Users/me/Open Design/x",
    ],
  });
  expect(patches[0].edits.importPathMaps).toBeUndefined();
});

it("saves nothing when cancelled", async () => {
  const tree = await open();
  dialog(tree)!.props.onCancel();
  await settle();
  expect(dialog(render())).toBeUndefined();
  expect(patches).toHaveLength(0);
});

it("keeps the list and does not retry by itself when settings changed elsewhere", async () => {
  patchStatus = 409;
  const tree = await open();
  dialog(tree)!.props.onConfirm();
  await settle();
  await settle();
  expect(patches).toHaveLength(1);
  const after = render();
  expect(host(after).props.rows.map((row: { directory: string }) => row.directory)).toContain(
    "/private/tmp/oc-mem-phase1/project"
  );
  expect(patches).toHaveLength(1);
});

const rowPaths = (tree: Node[]) =>
  host(tree).props.rows.map((row: { directory: string }) => row.directory);
const texts = (tree: Node[]) =>
  tree.flatMap((node) => (typeof node.props.children === "string" ? [node.props.children] : []));

it("closes the dialog and drops every ignored directory from the list once saved", async () => {
  const tree = await open();
  dialog(tree)!.props.onConfirm();
  await settle();
  await settle();
  const after = render();
  expect(dialog(after)).toBeUndefined();
  expect(rowPaths(after)).toEqual([""]);
});

it("drops a single ignored directory from the list once saved", async () => {
  await open();
  const tree = render();
  const row = host(tree).props.rows[0];
  host(tree).props.onIgnore(row);
  await settle();
  await settle();
  expect(rowPaths(render())).not.toContain(row.directory);
});

it("keeps the dialog open and says why when the save fails", async () => {
  patchStatus = 400;
  const tree = await open();
  dialog(tree)!.props.onConfirm();
  await settle();
  await settle();
  const after = render();
  expect(dialog(after)).toBeDefined();
  expect(texts(after)).toContain("The directories could not be ignored. Try again.");
});

it("says so, and keeps the dialog open, when the list is not ready to save", async () => {
  render();
  const tree = render();
  host(tree).props.onIgnore({ directory: "/private/tmp/x", sessions: 1, suggestion: null });
  await settle();
  expect(patches).toHaveLength(0);
  expect(texts(render())).toContain("The list is still loading. Try again in a moment.");
});

afterAll(() => {
  globalThis.fetch = originalFetch;
  Object.assign(globalThis, { window: originalWindow });
});
