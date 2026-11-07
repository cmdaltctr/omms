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
  type Request,
} from "./space-kit.tsx";

installReact();
mock.module("../src/lib/settings-navigation.ts", () => ({ revealPageAnchor: () => {} }));
mock.module("../src/lib/power.ts", () => ({
  STATUS_POLL_MS: 15_000,
  readPowerStatus: async () => ({ version: "1", canControl: true }),
}));

const { SpacesView } = await import("../src/lib/components/spaces/SpacesView.tsx");
const { SpaceCard } = await import("../src/lib/components/spaces/SpaceCard.tsx");
const { SpaceActionButton } = await import("../src/lib/components/spaces/SpaceActionButton.tsx");
const { SpaceLinks } = await import("../src/lib/components/spaces/SpaceLinks.tsx");
const { Button } = await import("../src/lib/components/ui/button.tsx");
const { DialogTitle } = await import("../src/lib/components/ui/dialog.tsx");
const { Select } = await import("../src/lib/components/ui/select.tsx");
const { setLanguage } = await import("../src/lib/i18n/index.ts");

const own = [SpacesView, SpaceCard, SpaceActionButton, SpaceLinks];
const page = <SpacesView />;

type Link = { id: string; name: string; available: boolean };
type Row = {
  id: string;
  name: string;
  archived: boolean;
  createdAt: string | null;
  sizeBytes: number;
  links?: Link[];
};
const baseRows = (): Row[] => [
  { id: "default", name: "Default", archived: false, createdAt: null, sizeBytes: 1572864 },
  {
    id: "experiments",
    name: "Experiments",
    archived: false,
    createdAt: "2026-11-01T10:00:00.000Z",
    sizeBytes: 2048,
    links: [
      { id: "default", name: "Default", available: true },
      { id: "old-laptop", name: "Old laptop", available: false },
    ],
  },
  {
    id: "teammate",
    name: "Teammate",
    archived: false,
    createdAt: "2026-11-02T10:00:00.000Z",
    sizeBytes: 512,
    links: [],
  },
];
const rows = baseRows();
let active = "default";
let requests: Request[] = [];
let refuseLinks = false;

const stored = new Map<string, string>();
(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: (key: string) => stored.get(key) ?? null,
  setItem: (key: string, value: string) => stored.set(key, value),
};

beforeEach(() => {
  resetRender();
  stored.clear();
  setLanguage("en");
  active = "default";
  rows.length = 0;
  rows.push(...baseRows());
  refuseLinks = false;
  requests = installFetch(async (request) => {
    const { method, path, body } = request;
    if (method === "GET" && path === "/api/spaces") {
      return {
        body: {
          success: true,
          data: {
            activeSpaceId: active,
            current: { id: active, name: "Default", customStoragePath: false },
            spaces: rows.map((row) => ({
              look: { kind: "default" },
              ...row,
              active: row.id === active,
              disabled: {},
            })),
            backups: [],
          },
        },
      };
    }
    if (method === "POST" && /\/api\/spaces\/[\w-]+\/links$/.test(path)) {
      if (refuseLinks) {
        return { status: 500, body: { success: false, error: "The link store is closed." } };
      }
      const spaceId = path.split("/")[3]!;
      const row = rows.find((candidate) => candidate.id === spaceId);
      if (body.add) {
        const added = rows.find((candidate) => candidate.id === body.add);
        row!.links = [...(row?.links ?? []), { id: body.add, name: added!.name, available: true }];
      } else if (body.remove) {
        row!.links = (row?.links ?? []).filter((link) => link.id !== body.remove);
      }
      // The route answers with the space's links; the page refetches its rows anyway.
      return { body: { success: true, data: { links: row?.links ?? [] } } };
    }
    return { status: 404, body: { success: false, error: "unknown route" } };
  });
});

const isCard = (node: Node) =>
  typeof node.props.id === "string" && node.props.id.startsWith("space-card-");
function rowOf(tree: Node[], name: string): Node[] {
  const cards = tree.filter(isCard);
  const card = cards.find((node) => {
    const heading = tree.slice(tree.indexOf(node)).find((n) => n.type === "h3");
    return heading !== undefined && text(heading.props.children) === name;
  });
  expect(card, `card of ${name}`).toBeDefined();
  const start = tree.indexOf(card!);
  const next = tree.findIndex((node, index) => index > start && isCard(node));
  return tree.slice(start, next < 0 ? undefined : next);
}
const buttonOf = (nodes: Node[], label: string) =>
  byType(nodes, Button).find(
    (node) => text(node.props.children) === label || node.props["aria-label"] === label
  )!;
const choose = (node: Node, value: string) => node.props.onChange({ target: { value } });
const dialogOf = (tree: Node[]) => {
  const at = tree.findIndex((node) => node.type === DialogTitle);
  return at < 0 ? [] : tree.slice(at);
};
const linkPosts = () =>
  requests.filter((request) => request.method === "POST" && request.path.endsWith("/links"));
const reads = () =>
  requests.filter((request) => request.method === "GET" && request.path === "/api/spaces").length;

it("lists the linked spaces by name, marks the unavailable one in words, and stays off Default", async () => {
  const tree = await settle(page, own);
  const card = rowOf(tree, "Experiments");
  const words = allText(card);
  expect(words).toContain("Linked spaces");
  expect(words).toContain("Default");
  expect(words).toContain("Old laptop");
  expect(words).toContain("Unavailable");
  // The Default card carries no linked-spaces section at all.
  const standard = rowOf(tree, "Default");
  expect(allText(standard)).not.toContain("Linked spaces");
  expect(byType(standard, "ul")).toHaveLength(0);
});

it("says so in words when a space has no links yet", async () => {
  const tree = await settle(page, own);
  expect(allText(rowOf(tree, "Teammate"))).toContain("No linked spaces yet.");
});

it("links a space through the picker and a confirmation, then reloads the list", async () => {
  const readsBefore = reads();
  let tree = await settle(page, own);
  const card = rowOf(tree, "Experiments");
  choose(
    card.find((node) => node.type === Select && node.props.id === "space-links-picker")!,
    "teammate"
  );
  buttonOf(card, "Link a space").props.onClick();
  tree = await settle(page, own);
  const words = allText(dialogOf(tree));
  expect(words).toContain("Link Teammate to Experiments?");
  expect(words).toContain(
    "Searches in Experiments can then also read the memories of Teammate. Nothing is copied, moved or deleted."
  );
  expect(linkPosts()).toEqual([]);
  buttonOf(dialogOf(tree), "Link").props.onClick();
  tree = await settle(page, own);
  expect(linkPosts().map((request) => [request.path, request.body])).toEqual([
    ["/api/spaces/experiments/links", { add: "teammate" }],
  ]);
  expect(allText(rowOf(tree, "Experiments"))).toContain("Teammate");
  expect(reads()).toBeGreaterThan(readsBefore);
});

it("Cancel in the link confirmation sends nothing", async () => {
  let tree = await settle(page, own);
  const card = rowOf(tree, "Experiments");
  choose(
    card.find((node) => node.type === Select && node.props.id === "space-links-picker")!,
    "teammate"
  );
  buttonOf(card, "Link a space").props.onClick();
  tree = await settle(page, own);
  const cancels = byType(dialogOf(tree), Button).filter(
    (node) => text(node.props.children) === "Cancel"
  );
  cancels[cancels.length - 1]!.props.onClick();
  tree = await settle(page, own);
  expect(linkPosts()).toEqual([]);
  expect(dialogOf(tree)).toEqual([]);
});

it("unlinks through a confirmation and says that no memory was deleted", async () => {
  let tree = await settle(page, own);
  buttonOf(rowOf(tree, "Experiments"), "Unlink Old laptop").props.onClick();
  tree = await settle(page, own);
  const words = allText(dialogOf(tree));
  expect(words).toContain("Unlink Old laptop?");
  expect(words).toContain("The link is removed. The memories of both spaces stay as they are.");
  expect(linkPosts()).toEqual([]);
  buttonOf(dialogOf(tree), "Unlink").props.onClick();
  tree = await settle(page, own);
  expect(linkPosts().map((request) => [request.path, request.body])).toEqual([
    ["/api/spaces/experiments/links", { remove: "old-laptop" }],
  ]);
  const card = allText(rowOf(tree, "Experiments"));
  expect(card).toContain("Unlinked Old laptop. No memory was deleted.");
  expect(card).not.toContain("Old laptop: Unlink");
});

it("shows a refused link change in words and keeps the dialog usable", async () => {
  refuseLinks = true;
  let tree = await settle(page, own);
  buttonOf(rowOf(tree, "Experiments"), "Unlink Old laptop").props.onClick();
  tree = await settle(page, own);
  buttonOf(dialogOf(tree), "Unlink").props.onClick();
  tree = await settle(page, own);
  expect(allText(rowOf(tree, "Experiments"))).toContain("The link store is closed.");
});
