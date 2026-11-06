import { beforeEach, expect, it, mock } from "bun:test";
import {
  allText,
  byType,
  installFetch,
  installReact,
  resetRender,
  settle,
  text,
  type Node,
} from "./space-kit.tsx";

installReact();

type Space = { id: string; name: string; archived: boolean; look?: unknown };
let status: Record<string, unknown> = {};
let spaces: Space[] = [];
let activeId = "default";
let custom = false;
const store = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
  },
});
mock.module("../src/lib/power.ts", () => ({
  STATUS_POLL_MS: 15_000,
  readPowerStatus: async () => status,
}));

const { SpaceNav } = await import("../src/lib/components/spaces/SpaceNav.tsx");
const { SpaceChip } = await import("../src/lib/components/spaces/SpaceChip.tsx");
const { SidebarNavLink } = await import("../src/lib/components/explorer/SidebarNavLink.tsx");
const { ProfileTree } = await import("../src/lib/components/explorer/ProfileTree.tsx");
const { announceSpacesChanged } = await import("../src/lib/spaces-store.ts");
const { refreshWebStatus } = await import("../src/lib/web-status.ts");
const { setLanguage } = await import("../src/lib/i18n/index.ts");
const { Boxes, Globe, Bot, Layers } = await import("lucide-react");
const { SharedMark } = await import("../src/lib/components/memory/HostAvatar.tsx");

const own = [SpaceNav, SidebarNavLink, ProfileTree, SpaceChip];
const calls: { to: string; prevented: boolean }[] = [];
const element = (collapsed = false, currentView = "project") => (
  <SpaceNav
    className="row"
    collapsed={collapsed}
    currentView={currentView as never}
    hideWhenCollapsed={collapsed ? "md:hidden" : ""}
    onNavigate={(event, to) => {
      event.preventDefault();
      calls.push({ to, prevented: true });
    }}
  />
);
const nameOf = (id: string) => spaces.find((space) => space.id === id)?.name ?? "";
function publishStatus() {
  status = {
    version: "1",
    canControl: true,
    activeSpace: { id: activeId, name: nameOf(activeId), customStoragePath: custom },
  };
}
const link = (tree: Node[]) => byType(tree, "a")[0]!;
/** The tree rows for spaces. The Archive child is last and has its own address. */
const children = (tree: Node[]) =>
  byType(tree, "a")
    .slice(1)
    .filter((node) => node.props.href !== "/spaces/archive");
const archiveChild = (tree: Node[]) =>
  byType(tree, "a").find((node) => node.props.href === "/spaces/archive")!;
/** The nodes of one child, from its link to the next link. */
function part(tree: Node[], child: Node): Node[] {
  const start = tree.indexOf(child);
  const next = tree.findIndex((node, index) => index > start && node.type === "a");
  return tree.slice(start, next < 0 ? undefined : next);
}
const marks = (tree: Node[], child: Node) =>
  part(tree, child).filter((node) => node.type === "span" && node.props.role === "img");

let requests: ReturnType<typeof installFetch> = [];
beforeEach(async () => {
  resetRender();
  store.clear();
  setLanguage("en");
  calls.length = 0;
  spaces = [
    { id: "default", name: "Default", archived: false },
    { id: "experiments", name: "Experiments", archived: false },
    { id: "old", name: "Old work", archived: true },
  ];
  activeId = "default";
  custom = false;
  requests = installFetch(({ method, path }) => {
    if (method === "GET" && path === "/api/spaces") {
      return {
        body: {
          success: true,
          data: {
            activeSpaceId: activeId,
            current: { id: activeId, name: nameOf(activeId), customStoragePath: custom },
            backups: [],
            spaces: spaces.map((space) => ({
              look: { kind: "default" },
              ...space,
              createdAt: null,
              active: space.id === activeId,
              sizeBytes: 0,
              disabled: {},
            })),
          },
        },
      };
    }
    return { status: 404, body: { success: false, error: "not found" } };
  });
  publishStatus();
  await refreshWebStatus();
});

it("is labelled Spaces, with the Boxes icon, and never shows the active space name", async () => {
  activeId = "experiments";
  publishStatus();
  await refreshWebStatus();
  const tree = await settle(element(), own);
  expect(byType(tree, Boxes)).toHaveLength(1);
  expect(byType(tree, Globe)).toHaveLength(0);
  expect(link(tree).props.href).toBe("/spaces");
  expect(text(link(tree).props.children)).toContain("Spaces");
  expect(text(link(tree).props.children)).not.toContain("Experiments");
  expect(link(tree).props.className).toBe("row");
});

it("keeps the label for screen readers on a collapsed sidebar and names the active space on hover", async () => {
  activeId = "experiments";
  publishStatus();
  await refreshWebStatus();
  const open = link(await settle(element(false), own));
  const shut = link(await settle(element(true), own));
  const label = (node: Node) => (node.props.children as Node[])[1]!.props.className;
  expect(label(open)).not.toContain("md:sr-only");
  expect(label(shut)).toContain("md:sr-only");
  expect(open.props.title).toBeUndefined();
  expect(shut.props.title).toBe("Spaces. Active space: Experiments");
});

it("says that a custom storage folder is in use", async () => {
  custom = true;
  publishStatus();
  await refreshWebStatus();
  const tree = await settle(element(), own);
  expect(text(link(tree).props.children)).toContain("Custom storage folder");
  const shut = link(await settle(element(true), own));
  expect(shut.props.title).toContain("A custom storage folder is in use.");
  custom = false;
  publishStatus();
  await refreshWebStatus();
  expect(text(link(await settle(element(), own)).props.children)).not.toContain("Custom storage");
});

it("lists the spaces that are not archived, each with a chip, its name and the active mark", async () => {
  activeId = "experiments";
  publishStatus();
  await refreshWebStatus();
  const tree = await settle(element(false, "spaces"), own);
  const items = children(tree);
  expect(items.map((node) => node.props.title)).toEqual(["Default", "Experiments"]);
  expect(allText(tree)).not.toContain("Old work");
  expect(allText(part(tree, items[0]!))).toContain("DE");
  expect(allText(part(tree, items[1]!))).toContain("EX");
  expect(marks(tree, items[0]!)).toHaveLength(0);
  expect(marks(tree, items[1]!)).toHaveLength(1);
  expect(marks(tree, items[1]!)[0]!.props["aria-label"]).toBe("Active space");
  expect(marks(tree, items[1]!)[0]!.props.className).toContain("bg-status-success");
  expect(marks(tree, items[1]!)[0]!.props.className).not.toContain("bg-primary");
  const name = part(tree, items[1]!).find((node) =>
    String(node.props.className).includes("truncate")
  );
  expect(text(name!.props.children)).toBe("Experiments");
});

it("is closed on other pages until the user opens it, and open on the Spaces page", async () => {
  expect(children(await settle(element(false, "project"), own))).toHaveLength(0);
  resetRender();
  expect(children(await settle(element(false, "spaces"), own))).toHaveLength(2);
});

it("moves the active mark when the status shows another space, and loads the list again", async () => {
  const markedOf = (nodes: Node[]) =>
    children(nodes)
      .filter((node) => marks(nodes, node).length > 0)
      .map((node) => node.props.title);
  expect(markedOf(await settle(element(false, "spaces"), own))).toEqual(["Default"]);
  const loads = requests.filter((r) => r.path === "/api/spaces").length;
  activeId = "experiments";
  publishStatus();
  await refreshWebStatus();
  const after = await settle(element(false, "spaces"), own);
  expect(markedOf(after)).toEqual(["Experiments"]);
  expect(requests.filter((r) => r.path === "/api/spaces").length).toBe(loads + 1);
});

it("lists a space again when the spaces page announces a change", async () => {
  await settle(element(false, "spaces"), own);
  spaces.push({ id: "client-work", name: "Client work", archived: false });
  announceSpacesChanged();
  const after = await settle(element(false, "spaces"), own);
  expect(children(after).map((node) => node.props.title)).toContain("Client work");
});

it("opens the card of a child and never switches", async () => {
  const tree = await settle(element(false, "spaces"), own);
  const child = children(tree).find((node) => node.props.title === "Experiments")!;
  expect(child.props.href).toBe("/spaces#space-card-experiments");
  child.props.onClick({ preventDefault() {}, button: 0 });
  expect(calls).toEqual([{ to: "/spaces#space-card-experiments", prevented: true }]);
  await settle(element(false, "spaces"), own);
  expect(requests.some((r) => r.method !== "GET")).toBe(false);
});

it("shows the Spaces item in Arabic", async () => {
  setLanguage("ar");
  activeId = "experiments";
  publishStatus();
  await refreshWebStatus();
  const tree = await settle(element(true, "spaces"), own);
  expect(text(link(tree).props.children)).toContain("المساحات");
  expect(link(tree).props.title).toBe("المساحات. المساحة النشطة: Experiments");
  expect(allText(tree)).not.toContain("Spaces");
});

it("keeps the Boxes icon on a collapsed sidebar", async () => {
  const tree = await settle(element(true), own);
  expect(byType(tree, Boxes)).toHaveLength(1);
  expect(byType(tree, Globe)).toHaveLength(0);
});

it("draws each tree child with the look of its space, at the small size", async () => {
  spaces[0]!.look = { kind: "icon", icon: "bot" };
  spaces[1]!.look = { kind: "image", image: "data:image/png;base64,AAAA" };
  const tree = await settle(element(false, "spaces"), own);
  const [first, second] = children(tree);
  const one = part(tree, first!);
  const two = part(tree, second!);
  expect(byType(one, Bot).length).toBeGreaterThan(0);
  expect(byType(one, Bot)[0]!.props.className).toContain("size-3");
  expect(allText(one)).not.toContain("DE");
  expect(byType(two, "img")[0]!.props.src).toBe("data:image/png;base64,AAAA");
  expect(allText(two)).not.toContain("EX");
  spaces[1]!.look = { kind: "default" };
  resetRender();
  const again = await settle(element(false, "spaces"), own);
  expect(allText(part(again, children(again)[1]!))).toContain("EX");
});

it("shows a changed look after the spaces page announces a change", async () => {
  await settle(element(false, "spaces"), own);
  spaces[1]!.look = { kind: "icon", icon: "bot" };
  announceSpacesChanged();
  const after = await settle(element(false, "spaces"), own);
  expect(byType(part(after, children(after)[1]!), Bot).length).toBeGreaterThan(0);
});

it("shows a pointer cursor on the arrow that opens the tree and on every tree row", async () => {
  const tree = await settle(element(false, "spaces"), own);
  const toggle = byType(tree, "button").find(
    (n) => n.props["aria-controls"] === "sidebar-spaces-tree"
  )!;
  expect(toggle.props.className).toContain("cursor-pointer");
  // A row is a link with an address, which the browser already shows with a pointer.
  for (const row of children(tree)) expect(row.props.href).toContain("/spaces#");
});

it("ends the tree with an Archive child that has the icon of Shared, last after the spaces", async () => {
  const tree = await settle(element(false, "spaces"), own);
  const links = byType(tree, "a").slice(1);
  expect(links.at(-1)).toBe(archiveChild(tree));
  const child = part(tree, archiveChild(tree));
  expect(text(archiveChild(tree).props.children)).toContain("Archive");
  // The same component and icon that the Shared item has in the Memory tree, not a lookalike.
  const mark = byType(child, SharedMark);
  expect(mark).toHaveLength(1);
  expect(mark[0]!.props.iconClassName).toBe("size-3");
  const drawn = SharedMark(mark[0]!.props as never) as unknown as Node;
  expect(byType([drawn, ...[drawn.props.children as Node]], Layers).length).toBeGreaterThan(0);
  // It is a neutral chip, not a coloured two-letter chip.
  expect(byType(child, SpaceChip)).toHaveLength(0);
  expect(archiveChild(tree).props.href).toBe("/spaces/archive");
});

it("shows the Archive child when nothing is archived, and never lists an archived space", async () => {
  spaces.splice(0, spaces.length, ...spaces.filter((space) => !space.archived));
  const empty = await settle(element(false, "spaces"), own);
  expect(archiveChild(empty)).toBeDefined();
  expect(children(empty).map((node) => node.props.title)).toEqual(["Default", "Experiments"]);
  spaces.push({ id: "old", name: "Old work", archived: true });
  announceSpacesChanged();
  const withOld = await settle(element(false, "spaces"), own);
  expect(archiveChild(withOld)).toBeDefined();
  expect(children(withOld).map((node) => node.props.title)).toEqual(["Default", "Experiments"]);
  expect(allText(withOld)).not.toContain("Old work");
});

it("marks Archive as the current page on /spaces/archive, and keeps the Spaces item current too", async () => {
  const on = await settle(element(false, "spaces-archive"), own);
  expect(archiveChild(on).props["aria-current"]).toBe("page");
  expect(link(on).props["aria-current"]).toBe("page");
  resetRender();
  const off = await settle(element(false, "spaces"), own);
  expect(archiveChild(off).props["aria-current"]).toBeUndefined();
});

it("starts open on the Archive page", async () => {
  expect(children(await settle(element(false, "spaces-archive"), own))).toHaveLength(2);
});

it("opens the Archive page without a hash when the child is chosen", async () => {
  const tree = await settle(element(false, "spaces"), own);
  archiveChild(tree).props.onClick({ preventDefault() {}, button: 0 });
  expect(calls.at(-1)).toEqual({ to: "/spaces/archive", prevented: true });
  expect(requests.some((r) => r.method !== "GET")).toBe(false);
});

it("names the Archive child in Arabic", async () => {
  setLanguage("ar");
  const tree = await settle(element(false, "spaces"), own);
  expect(text(archiveChild(tree).props.children)).toContain("الأرشيف");
  expect(text(archiveChild(tree).props.children)).not.toContain("Archive");
});
