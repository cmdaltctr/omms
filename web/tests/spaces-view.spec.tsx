import { beforeEach, expect, it, mock } from "bun:test";
import { Archive, DatabaseBackup, Play, Trash2, Bot } from "lucide-react";
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
let statusReads = 0;
const revealed: string[] = [];
mock.module("../src/lib/settings-navigation.ts", () => ({
  revealPageAnchor: (hash: string) => void revealed.push(hash),
}));
mock.module("../src/lib/power.ts", () => ({
  STATUS_POLL_MS: 15_000,
  readPowerStatus: async () => {
    statusReads++;
    return { version: "1", canControl: true };
  },
}));

const { SpacesView } = await import("../src/lib/components/spaces/SpacesView.tsx");
const { SpaceCard } = await import("../src/lib/components/spaces/SpaceCard.tsx");
const { SpaceChip } = await import("../src/lib/components/spaces/SpaceChip.tsx");
const { SpaceViewToggle } = await import("../src/lib/components/spaces/SpaceViewToggle.tsx");
const { SpaceBackups } = await import("../src/lib/components/spaces/SpaceBackups.tsx");
const { SpaceEditDialog } = await import("../src/lib/components/spaces/SpaceEditDialog.tsx");
const { SpaceActionButton } = await import("../src/lib/components/spaces/SpaceActionButton.tsx");
const { AvatarEditorDialog } = await import("../src/lib/components/avatar/AvatarEditorDialog.tsx");
const { Tooltip } = await import("../src/lib/components/ui/tooltip.tsx");
const { SpaceDeleteDialog } = await import("../src/lib/components/spaces/SpaceDeleteDialog.tsx");
const { Button } = await import("../src/lib/components/ui/button.tsx");
const { Dialog, DialogTitle } = await import("../src/lib/components/ui/dialog.tsx");
const { SpaceConfirmDialog } = await import("../src/lib/components/spaces/SpaceConfirmDialog.tsx");
const { buttonVariants } = await import("../src/lib/components/ui/button.tsx");
const { Input } = await import("../src/lib/components/ui/input.tsx");
const { setLanguage } = await import("../src/lib/i18n/index.ts");
const { onSpacesChanged } = await import("../src/lib/spaces-store.ts");

const own = [
  SpacesView,
  SpaceCard,
  SpaceChip,
  SpaceViewToggle,
  SpaceBackups,
  SpaceEditDialog,
  SpaceActionButton,
  AvatarEditorDialog,
  SpaceDeleteDialog,
  SpaceConfirmDialog,
];
const page = <SpacesView />;
const BACKUP_PATH = "/home/someone/.omms/backups/space-experiments-20261101T100000Z";

type Row = {
  id: string;
  name: string;
  archived: boolean;
  createdAt: string | null;
  sizeBytes: number;
  look?: unknown;
};
let rows: Row[] = [];
let backups: { folder: string; spaceName: string }[] = [];
let active = "default";
let hold: Promise<void> | null = null;
let leftover: string | undefined;
let customFolder = false;
let refuseSwitch = "";
let refuseAction = "";
let restoreError = "";
let requests: Request[] = [];

function disabledFor(row: Row) {
  const isDefault = row.id === "default";
  const isActive = row.id === active;
  const reasons = {
    rename: isDefault ? "default" : undefined,
    archive: isDefault ? "default" : isActive ? "active" : undefined,
    delete: isDefault ? "default" : isActive ? "active" : undefined,
    switch: row.archived ? "archived" : isActive ? "active" : undefined,
  };
  return Object.fromEntries(Object.entries(reasons).filter(([, code]) => code));
}

const stored = new Map<string, string>();
let storageBlocked = false;
(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: (key: string) => {
    if (storageBlocked) throw new Error("blocked");
    return stored.get(key) ?? null;
  },
  setItem: (key: string, value: string) => {
    if (storageBlocked) throw new Error("blocked");
    stored.set(key, value);
  },
};

beforeEach(() => {
  resetRender();
  stored.clear();
  storageBlocked = false;
  setLanguage("en");
  active = "default";
  hold = null;
  leftover = undefined;
  customFolder = false;
  refuseSwitch = "";
  refuseAction = "";
  restoreError = "";
  rows = [
    { id: "default", name: "Default", archived: false, createdAt: null, sizeBytes: 1572864 },
    {
      id: "experiments",
      name: "Experiments",
      archived: false,
      createdAt: "2026-11-01T10:00:00.000Z",
      sizeBytes: 2048,
    },
    {
      id: "old-work",
      name: "Old work",
      archived: true,
      createdAt: "2026-10-01T10:00:00.000Z",
      sizeBytes: 4096,
    },
  ];
  backups = [{ folder: "space-experiments-20261101T100000Z", spaceName: "Experiments" }];
  requests = installFetch(async (request) => {
    const { method, path, body } = request;
    if (method === "GET" && path === "/api/spaces") {
      return {
        body: {
          success: true,
          data: {
            activeSpaceId: active,
            current: { id: active, name: "Default", customStoragePath: customFolder },
            spaces: rows.map((row) => ({
              look: { kind: "default" },
              ...row,
              active: row.id === active,
              disabled: disabledFor(row),
            })),
            backups: backups.map((backup) => ({
              ...backup,
              path: `/x/${backup.folder}`,
              spaceId: "experiments",
              createdAt: "2026-11-02T09:30:00.000Z",
              sizeBytes: 4096,
              fileCount: 3,
            })),
          },
        },
      };
    }
    if (method === "POST" && path === "/api/spaces") {
      if (body.name === "Default") {
        return {
          status: 409,
          body: { success: false, code: "name-taken", error: "A space named Default exists." },
        };
      }
      rows.push({
        id: "client-work",
        name: body.name,
        archived: false,
        createdAt: "2026-11-06T08:00:00.000Z",
        sizeBytes: 0,
      });
      return { body: { success: true, data: { space: { id: "client-work", name: body.name } } } };
    }
    if (path === "/api/spaces/backups/restore") {
      if (restoreError) {
        return { status: 500, body: { success: false, code: "unreadable", error: restoreError } };
      }
      const name = "Experiments (restored 2026-11-06)";
      rows.push({
        id: "experiments-restored",
        name,
        archived: false,
        createdAt: null,
        sizeBytes: 10,
      });
      return { body: { success: true, data: { space: { id: "experiments-restored", name } } } };
    }
    const match = /^\/api\/spaces\/([^/]+)(?:\/(\w+))?$/.exec(path);
    const row = rows.find((candidate) => candidate.id === match?.[1]);
    if (!match || !row)
      return { status: 404, body: { success: false, code: "unknown", error: "No such space." } };
    if (method === "DELETE") {
      await hold;
      rows = rows.filter((candidate) => candidate !== row);
      return {
        body: {
          success: true,
          data: {
            backup: { folder: "space-experiments-20261101T100000Z", path: BACKUP_PATH },
            ...(leftover ? { leftoverFolder: leftover } : {}),
          },
        },
      };
    }
    if (match[2] && match[2] !== "rename") {
      await hold;
      if (refuseAction) {
        return { status: 409, body: { success: false, code: "locked", error: refuseAction } };
      }
    }
    if (match[2] === "rename") row.name = body.name;
    if (match[2] === "archive") row.archived = true;
    if (match[2] === "unarchive") row.archived = false;
    if (match[2] === "switch") {
      if (refuseSwitch) {
        return { status: 409, body: { success: false, code: "archived", error: refuseSwitch } };
      }
      active = row.id;
    }
    if (match[2] === "backup") {
      return { body: { success: true, data: { backup: { folder: "b", path: BACKUP_PATH } } } };
    }
    return { body: { success: true, data: {} } };
  });
});

const isCard = (node: Node) =>
  typeof node.props.id === "string" && node.props.id.startsWith("space-card-");
/** The nodes of one space's card, from the card to the start of the next card. */
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
/** A button by its text, or by its aria-label for the icon-only ones. */
const buttonOf = (nodes: Node[], label: string) =>
  byType(nodes, Button).find(
    (node) => text(node.props.children) === label || node.props["aria-label"] === label
  )!;
/** The tooltip that wraps a button: the nearest Tooltip before it in the tree. */
function tipOf(nodes: Node[], button: Node) {
  const at = nodes.indexOf(button);
  return nodes
    .slice(0, at)
    .reverse()
    .find((n) => n.type === Tooltip)!;
}
const openDialog = (tree: Node[], inputId: string) => {
  const index = tree.findIndex((node) => node.type === Input && node.props.id === inputId);
  expect(index).toBeGreaterThanOrEqual(0);
  return tree[index]!;
};
const input = (tree: Node[], id: string) =>
  tree.find((n) => n.type === Input && n.props.id === id)!;
const type = (node: Node, value: string) => node.props.onChange({ target: { value } });
/** The nodes of the open dialog, from its title on. Empty while no dialog is open. */
const dialogOf = (tree: Node[]) => {
  const at = tree.findIndex((node) => node.type === DialogTitle);
  return at < 0 ? [] : tree.slice(at);
};
const titleOf = (tree: Node[]) => text(dialogOf(tree)[0]?.props.children);
const dialogButton = (tree: Node[], label: string) =>
  byType(dialogOf(tree), Button).find((n) => text(n.props.children) === label)!;
const changes = () => requests.filter((r) => r.method !== "GET");
/** Press a card button, which only opens a confirmation. */
async function ask(spaceName: string, label: string, tree?: Node[]) {
  const shown = tree ?? (await settle(page, own));
  buttonOf(rowOf(shown, spaceName), label).props.onClick();
  return settle(page, own);
}
async function confirm(tree: Node[], label: string) {
  dialogButton(tree, label).props.onClick();
  return settle(page, own);
}

it("lists Default as active and another space, with blocked actions disabled and explained", async () => {
  const tree = await settle(page, own);
  const names = byType(tree, "h3").map((node) => text(node.props.children));
  expect(names).toContain("Default");
  expect(names).toContain("Experiments");

  const standard = rowOf(tree, "Default");
  expect(allText(standard)).toContain("Active");
  expect(allText(standard)).toContain("Size: 1.5 MB");
  expect(allText(standard)).toContain("Created: not recorded");
  for (const label of ["Archive", "Delete"]) {
    expect(buttonOf(standard, label).props.disabled).toBe(true);
  }
  // The pencil dialog replaces the Rename button.
  expect(buttonOf(standard, "Rename")).toBeUndefined();
  // The active space needs no Activate button: its state line says it is active.
  expect(buttonOf(standard, "Activate")).toBeUndefined();
  expect(buttonOf(standard, "Back up").props.disabled).toBe(false);

  const other = rowOf(tree, "Experiments");
  expect(allText(other)).toContain("State: Available");
  expect(allText(other)).toContain("Size: 2 kB");
  expect(allText(other)).toMatch(/Created: .*2026/);
  expect(buttonOf(other, "Activate").props.disabled).toBe(false);
});

const TOOLTIP_REASONS: [string, string, string][] = [
  ["Default", "Archive", "The Default space cannot be archived."],
  ["Default", "Delete", "The Default space cannot be deleted."],
];

it("shows the reason in the tooltip of a blocked button, and keeps no visible reasons list", async () => {
  const tree = await settle(page, own);
  for (const [space, label, reason] of TOOLTIP_REASONS) {
    const card = rowOf(tree, space!);
    const button = buttonOf(card, label!);
    expect(button.props.disabled).toBe(true);
    expect(tipOf(card, button).props.content).toBe(reason);
  }
  const standard = rowOf(tree, "Default");
  expect(byType(standard, "ul")).toHaveLength(0);
});

it("points each blocked button at its reason through aria-describedby, in an sr-only element", async () => {
  const tree = await settle(page, own);
  for (const [space, label, reason] of TOOLTIP_REASONS) {
    const card = rowOf(tree, space!);
    const button = buttonOf(card, label!);
    const ids = String(button.props["aria-describedby"]).split(" ");
    const target = card.find(
      (n) => ids.includes(n.props.id as string) && text(n.props.children) === reason
    );
    expect(target, `${space} ${label}`).toBeDefined();
    expect(target!.props.className).toContain("sr-only");
  }
});

it("makes a blocked button reachable by keyboard so its tooltip can show", async () => {
  const tree = await settle(page, own);
  const card = rowOf(tree, "Default");
  const tip = tipOf(card, buttonOf(card, "Archive"));
  const holder = card[card.indexOf(tip) + 1]!;
  expect(holder.type).toBe("span");
  expect(holder.props.tabIndex).toBe(0);
});

it("shows only the action name in the tooltip of an allowed button", async () => {
  const tree = await settle(page, own);
  const card = rowOf(tree, "Default");
  expect(tipOf(card, buttonOf(card, "Back up")).props.content).toBe("Back up");
});

it("draws Archive, Back up and Delete as icon-only buttons with a name, and Delete in red", async () => {
  rows[1]!.archived = false;
  active = "default";
  const tree = await settle(page, own);
  const card = rowOf(tree, "Experiments");
  const find = (label: string) => buttonOf(card, label);
  for (const [label, Icon] of [
    ["Archive", Archive],
    ["Back up", DatabaseBackup],
    ["Delete", Trash2],
  ] as const) {
    const button = find(label);
    expect(button.props.size).toBe("icon-sm");
    expect(button.props["aria-label"]).toBe(label);
    expect(text(button.props.children)).toBe("");
    expect([button.props.children].flat().some((c) => (c as Node | undefined)?.type === Icon)).toBe(
      true
    );
  }
  expect(find("Delete").props.variant).toBe("destructive");
  expect(find("Archive").props.variant).toBe("outline");
  expect(find("Back up").props.variant).toBe("outline");
  const archivedCard = rowOf(tree, "Default");
  expect(archivedCard.length).toBeGreaterThan(0);
  expect(
    [buttonOf(archivedCard, "Delete").props.children]
      .flat()
      .some((c) => (c as Node)?.type === Trash2)
  ).toBe(true);
});

it("shows only spaces that are not archived, and no Unarchive button", async () => {
  const tree = await settle(page, own);
  expect(tree.filter(isCard).map((n) => n.props.id)).toEqual([
    "space-card-default",
    "space-card-experiments",
  ]);
  expect(allText(tree)).not.toContain("Old work");
  expect(buttonOf(tree, "Unarchive")).toBeUndefined();
  expect(allText(tree)).not.toContain("Archived");
});

it("keeps a card that was archived out of the page and says where it went", async () => {
  let tree = await ask("Experiments", "Archive");
  tree = await confirm(tree, "Archive");
  expect(tree.filter(isCard).map((n) => n.props.id)).toEqual(["space-card-default"]);
  expect(allText(tree)).toContain("Archived Experiments. It is now in the Archive.");
  const link = byType(tree, "a").find((n) => n.props.href === "/spaces/archive")!;
  expect(link).toBeDefined();
  expect(text(link.props.children)).toBe("Open the Archive");
});

it("renders the space look on the card: default letters, a chosen icon, or an uploaded image", async () => {
  rows[0]!.look = { kind: "icon", icon: "bot" };
  rows[1]!.look = { kind: "image", image: "data:image/png;base64,AAAA" };
  rows.push({
    id: "plain",
    name: "Plain",
    archived: false,
    createdAt: "2026-11-05T08:00:00.000Z",
    sizeBytes: 0,
    look: { kind: "default" },
  });
  const tree = await settle(page, own);
  const standard = rowOf(tree, "Default");
  expect(byType(standard, Bot).length).toBeGreaterThan(0);
  expect(allText(standard)).not.toContain("DE");
  const image = byType(rowOf(tree, "Experiments"), "img")[0]!;
  expect(image.props.src).toBe("data:image/png;base64,AAAA");
  expect(allText(rowOf(tree, "Experiments"))).not.toContain("EX");
  expect(allText(rowOf(tree, "Plain"))).toContain("PL");
  expect(byType(rowOf(tree, "Plain"), "img")).toHaveLength(0);
});

it("uses a page heading hierarchy of H2 sections and H3 spaces", async () => {
  const tree = await settle(page, own);
  expect(byType(tree, "h1")).toHaveLength(0);
  expect(byType(tree, "h2").map((node) => text(node.props.children))).toEqual([
    "Create a space",
    "All spaces",
    "Backups",
  ]);
});

it("lays the spaces out as cards in the Memory page grid, Default first then in creation order", async () => {
  rows.push({
    id: "client-work",
    name: "Client work",
    archived: false,
    createdAt: "2026-11-03T08:00:00.000Z",
    sizeBytes: 0,
  });
  rows.unshift(rows.pop()!);
  const tree = await settle(page, own);
  const grid = byType(tree, "ul").find((node) => String(node.props.className).includes("grid"))!;
  expect(grid.props.className).toBe("grid grid-cols-1 items-stretch gap-3 sm:grid-cols-2");
  const cards = tree.filter(isCard);
  expect(cards.map((node) => node.props.id)).toEqual([
    "space-card-default",
    "space-card-experiments",
    "space-card-client-work",
  ]);
  const first = cards[1]!;
  for (const word of ["rounded-xl", "bg-card", "p-4", "border-border"]) {
    expect(first.props.className).toContain(word);
  }
  const heading = tree.slice(tree.indexOf(first)).find((n) => n.type === "h3")!;
  expect(heading.props.className).toContain("text-subsection-title font-semibold");
});

const viewButton = (tree: Node[], label: string) =>
  byType(tree, Button).find((node) => node.props["aria-label"] === label)!;

it("starts in grid view with a grid and a list button, and the grid button is pressed", async () => {
  const tree = await settle(page, own);
  const grid = viewButton(tree, "Grid view");
  const list = viewButton(tree, "List view");
  expect(grid.props["aria-pressed"]).toBe(true);
  expect(list.props["aria-pressed"]).toBe(false);
  expect(byType(tree, "ul").some((n) => String(n.props.className).includes("sm:grid-cols-2"))).toBe(
    true
  );
});

it("switches to a list of rows, keeps every card id, and saves the choice", async () => {
  let tree = await settle(page, own);
  viewButton(tree, "List view").props.onClick();
  tree = await settle(page, own);
  expect(viewButton(tree, "List view").props["aria-pressed"]).toBe(true);
  expect(viewButton(tree, "Grid view").props["aria-pressed"]).toBe(false);
  const list = byType(tree, "ul").find((n) => n.props["aria-label"] === "Memory spaces")!;
  expect(list.props.className).toBe("flex flex-col gap-3");
  expect(tree.filter(isCard).map((n) => n.props.id)).toEqual([
    "space-card-default",
    "space-card-experiments",
  ]);
  expect(tree.filter(isCard)[0]!.props.className).toContain("sm:flex-row");
  expect(stored.get("omms-spaces-view")).toBe("list");
});

it("opens in the saved view after a reload", async () => {
  stored.set("omms-spaces-view", "list");
  const tree = await settle(page, own);
  expect(viewButton(tree, "List view").props["aria-pressed"]).toBe(true);
  expect(tree.filter(isCard)[0]!.props.className).toContain("sm:flex-row");
});

it("keeps the toggle working when the browser blocks storage", async () => {
  storageBlocked = true;
  let tree = await settle(page, own);
  viewButton(tree, "List view").props.onClick();
  tree = await settle(page, own);
  expect(viewButton(tree, "List view").props["aria-pressed"]).toBe(true);
});

it("names the view buttons in Arabic", async () => {
  setLanguage("ar");
  const tree = await settle(page, own);
  const labels = byType(tree, Button)
    .map((n) => n.props["aria-label"])
    .filter(Boolean) as string[];
  expect(labels.some((l) => /[\u0600-\u06FF]/.test(l))).toBe(true);
  expect(labels).not.toContain("Grid view");
});

it("activates with a Play button like the host cards, and the active card shows a success outline and state", async () => {
  rows[1]!.archived = false;
  const tree = await settle(page, own);
  const activate = buttonOf(rowOf(tree, "Experiments"), "Activate")!;
  const kids = [activate.props.children].flat();
  expect(kids.some((child) => (child as Node | undefined)?.type === Play)).toBe(true);
  expect(activate.props.variant).toBeUndefined();
  const [activeCard, otherCard] = [rowOf(tree, "Default")[0]!, rowOf(tree, "Experiments")[0]!];
  expect(activeCard.props.className).toContain("border-status-success");
  expect(activeCard.props.className).not.toContain("border-border");
  expect(otherCard.props.className).toContain("border-border");
  expect(otherCard.props.className).not.toContain("border-status-success");
  const state = (card: Node[]) =>
    card.find((n) => n.type === "p" && text(n.props.children).startsWith("State:"))!;
  expect(text(state(rowOf(tree, "Default")).props.children)).toBe("State: Active");
  expect(state(rowOf(tree, "Default")).props.className).toContain("text-status-success");
  expect(text(state(rowOf(tree, "Experiments")).props.children)).toBe("State: Available");
  expect(state(rowOf(tree, "Experiments")).props.className).not.toContain("text-status-success");
});

it("keeps the name field narrow", async () => {
  const tree = await settle(page, own);
  const field = [byType(tree, "form")[0]!.props.children].flat()[0] as Node;
  expect(field.props.className).toContain("w-72");
  expect(field.props.className).toContain("max-w-full");
  expect(field.props.className).not.toContain("flex-1");
});

it("scrolls to the card named by the page address once the cards have loaded", async () => {
  revealed.length = 0;
  (globalThis.window as unknown as { location: { hash: string } }).location.hash =
    "#space-card-experiments";
  expect(revealed).toEqual([]);
  await settle(page, own);
  expect(revealed).toEqual(["#space-card-experiments"]);
  (globalThis.window as unknown as { location: { hash: string } }).location.hash = "";
});

it("draws a two-letter chip on each card", async () => {
  const tree = await settle(page, own);
  expect(allText(rowOf(tree, "Default"))).toContain("DE");
  expect(allText(rowOf(tree, "Experiments"))).toContain("EX");
});

it("says that a custom storage folder is in use", async () => {
  customFolder = true;
  let tree = await settle(page, own);
  expect(allText(tree)).toContain("A config file sets a custom storage folder for this project.");
  resetRender();
  customFolder = false;
  tree = await settle(page, own);
  expect(allText(tree)).not.toContain("custom storage folder");
});

it("switches from a card after a confirmation, asks for the status again and shows the new active card", async () => {
  rows[1]!.archived = false;
  const reads = statusReads;
  let tree = await ask("Experiments", "Activate");
  expect(changes()).toEqual([]);
  tree = await confirm(tree, "Activate");
  expect(changes().map((r) => `${r.method} ${r.path}`)).toEqual([
    "POST /api/spaces/experiments/switch",
  ]);
  expect(statusReads).toBeGreaterThan(reads);
  expect(titleOf(tree)).toBe("");
  expect(allText(tree)).toContain("Experiments is now the active space.");
  expect(allText(rowOf(tree, "Experiments"))).toContain("Active");
  expect(buttonOf(rowOf(tree, "Default"), "Activate").props.disabled).toBe(false);
});

it("keeps the previous space and shows the server reason when a switch fails", async () => {
  rows[1]!.archived = false;
  refuseSwitch = "Experiments is locked by another process.";
  let tree = await ask("Experiments", "Activate");
  tree = await confirm(tree, "Activate");
  expect(allText(tree)).toContain("The space did not change.");
  expect(allText(dialogOf(tree))).toContain("Experiments is locked by another process.");
  expect(allText(rowOf(tree, "Default"))).toContain("Active");
  expect(allText(rowOf(tree, "Experiments"))).not.toContain("Active");
});

it("tells the sidebar tree that the spaces changed after a confirmed action", async () => {
  let announced = 0;
  const unsubscribe = onSpacesChanged(() => announced++);
  const tree = await ask("Experiments", "Archive");
  expect(announced).toBe(0);
  await confirm(tree, "Archive");
  unsubscribe();
  expect(announced).toBe(1);
});

it("creates a space, lists it and offers to activate it, after a confirmation", async () => {
  let tree = await settle(page, own);
  type(input(tree, "space-new-name"), "Client work");
  tree = await settle(page, own);
  const form = byType(tree, "form")[0]!;
  form.props.onSubmit({ preventDefault() {} });
  tree = await settle(page, own);
  expect(requests.find((r) => r.method === "POST" && r.path === "/api/spaces")?.body).toEqual({
    name: "Client work",
  });
  expect(byType(tree, "h3").map((node) => text(node.props.children))).toContain("Client work");
  expect(allText(tree)).toContain("Created Client work.");
  const offer = byType(tree, Button).find(
    (n) => text(n.props.children) === "Switch to Client work"
  )!;
  offer.props.onClick();
  tree = await settle(page, own);
  expect(titleOf(tree)).toBe("Activate Client work?");
  expect(requests.some((r) => r.path.endsWith("/switch"))).toBe(false);
  tree = await confirm(tree, "Activate");
  expect(requests.some((r) => r.path === "/api/spaces/client-work/switch")).toBe(true);
  expect(allText(tree)).toContain("Client work is now the active space.");
});

it("shows the server reason when a space cannot be created", async () => {
  let tree = await settle(page, own);
  type(input(tree, "space-new-name"), "Default");
  tree = await settle(page, own);
  byType(tree, "form")[0]!.props.onSubmit({ preventDefault() {} });
  tree = await settle(page, own);
  expect(allText(tree)).toContain("A space named Default exists.");
});

async function askToDelete() {
  let tree = await settle(page, own);
  buttonOf(rowOf(tree, "Experiments"), "Delete").props.onClick();
  tree = await settle(page, own);
  return tree;
}
const deleteForm = (tree: Node[]) =>
  byType(tree, "form").find((node) => node.props.className === "grid gap-6")!;
const confirmButton = (tree: Node[]) =>
  byType(tree, Button).find((node) => text(node.props.children) === "Delete space")!;

it("tells the user about the backup and keeps Delete disabled until the exact name is typed", async () => {
  let tree = await askToDelete();
  expect(allText(tree)).toContain(
    "OMMS makes a backup of this space first. Then it removes the space and its folder."
  );
  expect(confirmButton(tree).props.disabled).toBe(true);

  type(input(tree, "space-delete-name"), "experiments");
  tree = await settle(page, own);
  expect(confirmButton(tree).props.disabled).toBe(true);
  deleteForm(tree).props.onSubmit({ preventDefault() {} });
  await settle(page, own);
  expect(requests.some((r) => r.method === "DELETE")).toBe(false);

  type(input(tree, "space-delete-name"), "Experiments");
  tree = await settle(page, own);
  expect(confirmButton(tree).props.disabled).toBe(false);
});

it("shows progress while the delete runs, then the backup location", async () => {
  let release: () => void = () => {};
  hold = new Promise<void>((resolve) => (release = resolve));
  leftover = "/home/someone/.omms/spaces/experiments";
  let tree = await askToDelete();
  type(input(tree, "space-delete-name"), "Experiments");
  tree = await settle(page, own);
  deleteForm(tree).props.onSubmit({ preventDefault() {} });
  tree = await settle(page, own);

  expect(allText(tree)).toContain("Backing up and deleting Experiments…");
  expect(confirmButton(tree).props.disabled).toBe(true);
  expect(input(tree, "space-delete-name").props.disabled).toBe(true);
  const sent = requests.find((r) => r.method === "DELETE")!;
  expect(sent.path).toBe("/api/spaces/experiments");
  expect(sent.body).toEqual({ confirmName: "Experiments" });

  release();
  tree = await settle(page, own);
  expect(allText(tree)).toContain("Experiments is deleted");
  expect(allText(tree)).toContain(BACKUP_PATH);
  expect(allText(tree)).toContain("OMMS could not remove all of the space folder.");
  expect(allText(tree)).toContain(leftover);
  const listed = byType(tree, "h3").filter((node) => String(node.props.id).startsWith("space-"));
  expect(listed.map((node) => text(node.props.children))).toEqual(["Default"]);
});

it("backs a space up after a confirmation and shows where the backup is", async () => {
  let tree = await ask("Default", "Back up");
  expect(changes()).toEqual([]);
  tree = await confirm(tree, "Back up");
  expect(requests.some((r) => r.method === "POST" && r.path === "/api/spaces/default/backup")).toBe(
    true
  );
  expect(allText(tree)).toContain(`Backup saved to ${BACKUP_PATH}`);
});

const CONFIRMS = [
  {
    name: "Activate",
    space: "Experiments",
    label: "Activate",
    prepare: () => void (rows[1]!.archived = false),
    title: "Activate Experiments?",
    body: "Every host (Pi, OpenCode and Claude Code) and the web app will use this space from their next turn. Nothing is moved or deleted.",
    request: "POST /api/spaces/experiments/switch",
    working: "Switching to Experiments…",
  },
  {
    name: "Archive",
    space: "Experiments",
    label: "Archive",
    prepare: () => void (rows[1]!.archived = false),
    title: "Archive Experiments?",
    body: "The space leaves the sidebar tree and cannot be activated. Its memories stay on disk. You can restore it from the Archive at any time.",
    request: "POST /api/spaces/experiments/archive",
    working: "Archiving Experiments…",
  },
  {
    name: "Back up",
    space: "Default",
    label: "Back up",
    prepare: () => {},
    title: "Back up Default?",
    body: "OMMS copies the space to a backup folder and checks the copy. The space itself does not change.",
    request: "POST /api/spaces/default/backup",
    working: "Backing up Default…",
  },
] as const;

for (const c of CONFIRMS) {
  it(`${c.name}: opens a confirmation with the title and the effect, and sends nothing yet`, async () => {
    c.prepare();
    const tree = await ask(c.space, c.label);
    expect(titleOf(tree)).toBe(c.title);
    expect(allText(dialogOf(tree))).toContain(c.body);
    expect(allText(dialogOf(tree))).toContain("Cancel");
    expect(dialogButton(tree, c.label).props.disabled).toBeFalsy();
    // The confirmation has no typed-name field, unlike Delete.
    expect(dialogOf(tree).some((n) => n.type === Input)).toBe(false);
    expect(changes()).toEqual([]);
  });

  it(`${c.name}: sends the request only after the confirm button`, async () => {
    c.prepare();
    let tree = await ask(c.space, c.label);
    tree = await confirm(tree, c.label);
    expect(changes().map((r) => `${r.method} ${r.path}`)).toEqual([c.request]);
    expect(titleOf(tree)).toBe("");
  });

  it(`${c.name}: Cancel closes the dialog and sends nothing`, async () => {
    c.prepare();
    let tree = await ask(c.space, c.label);
    dialogButton(tree, "Cancel").props.onClick();
    tree = await settle(page, own);
    expect(titleOf(tree)).toBe("");
    expect(changes()).toEqual([]);
  });

  it(`${c.name}: shows the server reason inside the dialog and stays open`, async () => {
    c.prepare();
    refuseAction = "Another process holds the space.";
    refuseSwitch = refuseAction;
    let tree = await ask(c.space, c.label);
    tree = await confirm(tree, c.label);
    expect(titleOf(tree)).toBe(c.title);
    const alert = dialogOf(tree).find((n) => n.props.tone === "danger");
    expect(text(alert!.props.children)).toBe("Another process holds the space.");
    expect(dialogButton(tree, c.label).props.disabled).toBe(false);
  });

  it(`${c.name}: shows progress while the request runs and blocks a second press`, async () => {
    c.prepare();
    let release: () => void = () => {};
    hold = new Promise<void>((resolve) => (release = resolve));
    let tree = await ask(c.space, c.label);
    dialogButton(tree, c.label).props.onClick();
    tree = await settle(page, own);
    expect(allText(dialogOf(tree))).toContain(c.working);
    expect(dialogOf(tree).some((n) => n.type === "p" && n.props.role === "status")).toBe(true);
    expect(dialogButton(tree, c.label).props.disabled).toBe(true);
    expect(dialogButton(tree, "Cancel").props.disabled).toBe(true);
    release();
    tree = await settle(page, own);
    expect(titleOf(tree)).toBe("");
    expect(changes()).toHaveLength(1);
  });
}

it("shows the confirmations in Arabic", async () => {
  setLanguage("ar");
  rows[1]!.archived = false;
  let tree = await settle(page, own);
  buttonOf(rowOf(tree, "Experiments"), "تفعيل").props.onClick();
  tree = await settle(page, own);
  const words = allText(dialogOf(tree));
  expect(titleOf(tree)).toBe("تفعيل Experiments؟");
  expect(words).toContain("ستستخدم كل التطبيقات المضيفة");
  expect(words).toContain("إلغاء");
  expect(words).not.toContain("Activate");
  expect(words).not.toContain("Every host");
});

it("gives every Button a pointer cursor, and a disabled one no pointer events", () => {
  const classes = buttonVariants({});
  expect(classes).toContain("cursor-pointer");
  expect(classes).toContain("disabled:pointer-events-none");
  expect(classes).not.toContain("disabled:cursor-pointer");
});

it("lists backups and restores one as a new space", async () => {
  let tree = await settle(page, own);
  expect(allText(tree)).toContain("Backed up:");
  const restore = byType(tree, Button).find(
    (n) => text(n.props.children) === "Restore as new space"
  )!;
  restore.props.onClick();
  tree = await settle(page, own);
  expect(requests.find((r) => r.path === "/api/spaces/backups/restore")?.body).toEqual({
    backup: "space-experiments-20261101T100000Z",
  });
  expect(allText(tree)).toContain("Restored as Experiments (restored 2026-11-06).");
  expect(byType(tree, "h3").map((node) => text(node.props.children))).toContain(
    "Experiments (restored 2026-11-06)"
  );
});

it("shows the server message, which names the damaged file, when a restore fails", async () => {
  restoreError = "Backup is damaged: cold-buffer.json does not match its checksum.";
  let tree = await settle(page, own);
  byType(tree, Button)
    .find((n) => text(n.props.children) === "Restore as new space")!
    .props.onClick();
  tree = await settle(page, own);
  expect(allText(tree)).toContain("cold-buffer.json");
});

it("shows the Spaces page in Arabic", async () => {
  setLanguage("ar");
  let tree = await settle(page, own);
  const words = allText(tree);
  for (const phrase of ["إنشاء مساحة", "كل المساحات", "النسخ الاحتياطية", "استعادة كمساحة جديدة"]) {
    expect(words).toContain(phrase);
  }
  expect(words).not.toContain("Create a space");
  expect(words).not.toContain("Restore as new space");
  // The icon-only buttons carry Arabic names, and the blocked one a Arabic reason.
  const standard = rowOf(tree, "Default");
  expect(buttonOf(standard, "أرشفة").props.disabled).toBe(true);
  expect(tipOf(standard, buttonOf(standard, "أرشفة")).props.content).toBe(
    "لا يمكن أرشفة المساحة الافتراضية."
  );
  buttonOf(rowOf(tree, "Experiments"), "حذف").props.onClick();
  tree = await settle(page, own);
  expect(allText(tree)).toContain("ينشئ OMMS نسخة احتياطية من هذه المساحة أولًا.");
  expect(openDialog(tree, "space-delete-name")).toBeTruthy();
  expect(byType(tree, Dialog).some((node) => node.props.open === true)).toBe(true);
});
