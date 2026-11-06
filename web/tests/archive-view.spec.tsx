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
const stored = new Map<string, string>();
(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: (key: string) => stored.get(key) ?? null,
  setItem: (key: string, value: string) => void stored.set(key, value),
};
mock.module("../src/lib/power.ts", () => ({
  STATUS_POLL_MS: 15_000,
  readPowerStatus: async () => ({ version: "1", canControl: true }),
}));

const { ArchiveView } = await import("../src/lib/components/spaces/ArchiveView.tsx");
const { ArchivedSpaces } = await import("../src/lib/components/spaces/ArchivedSpaces.tsx");
const { SpaceChip } = await import("../src/lib/components/spaces/SpaceChip.tsx");
const { SpaceActionButton } = await import("../src/lib/components/spaces/SpaceActionButton.tsx");
const { SpaceConfirmDialog } = await import("../src/lib/components/spaces/SpaceConfirmDialog.tsx");
const { SpaceDeleteDialog } = await import("../src/lib/components/spaces/SpaceDeleteDialog.tsx");
const { PagedList } = await import("../src/lib/components/paged-list/index.ts");
const { Button } = await import("../src/lib/components/ui/button.tsx");
const { DialogTitle } = await import("../src/lib/components/ui/dialog.tsx");
const { Input } = await import("../src/lib/components/ui/input.tsx");
const { Tooltip } = await import("../src/lib/components/ui/tooltip.tsx");
const { onSpacesChanged } = await import("../src/lib/spaces-store.ts");
const { setLanguage } = await import("../src/lib/i18n/index.ts");
const { ArchiveRestore, DatabaseBackup, Trash2 } = await import("lucide-react");

const own = [
  ArchiveView,
  ArchivedSpaces,
  SpaceChip,
  SpaceActionButton,
  SpaceConfirmDialog,
  SpaceDeleteDialog,
];
const page = <ArchiveView />;
const BACKUP_PATH = "/home/someone/.omms/backups/space-experiments-20261105T100000Z";

type Row = {
  id: string;
  name: string;
  archived: boolean;
  archivedAt: string | null;
  createdAt: string | null;
  sizeBytes: number;
};
let rows: Row[] = [];
let refuse = "";
let requests: Request[] = [];

const row = (id: string, name: string, over: Partial<Row> = {}): Row => ({
  id,
  name,
  archived: true,
  archivedAt: "2026-11-02T09:30:00.000Z",
  createdAt: "2026-10-01T08:00:00.000Z",
  sizeBytes: 2048,
  ...over,
});

beforeEach(() => {
  resetRender();
  stored.clear();
  setLanguage("en");
  refuse = "";
  rows = [
    row("default", "Default", { archived: false, archivedAt: null, createdAt: null }),
    row("client-work", "Client work", { archived: false, archivedAt: null }),
    row("experiments", "Experiments", {
      archivedAt: "2026-11-05T12:00:00.000Z",
      sizeBytes: 1572864,
    }),
    row("old-work", "Old work", { archivedAt: "2026-11-02T09:30:00.000Z" }),
    row("legacy", "Legacy", { archivedAt: null, sizeBytes: 0 }),
  ];
  requests = installFetch(async ({ method, path, body }) => {
    if (method === "GET" && path === "/api/spaces") {
      return {
        body: {
          success: true,
          data: {
            activeSpaceId: "default",
            current: { id: "default", name: "Default", customStoragePath: false },
            backups: [],
            spaces: rows.map((r) => ({
              look: { kind: "default" },
              ...r,
              active: r.id === "default",
              disabled: r.id === "default" ? { delete: "default", archive: "default" } : {},
            })),
          },
        },
      };
    }
    const match = /^\/api\/spaces\/([^/]+)(?:\/(\w+))?$/.exec(path);
    const target = rows.find((r) => r.id === match?.[1]);
    if (!match || !target)
      return { status: 404, body: { success: false, error: "No such space." } };
    if (refuse) return { status: 409, body: { success: false, code: "locked", error: refuse } };
    if (method === "DELETE") {
      if (body.confirmName !== target.name) {
        return { status: 400, body: { success: false, error: "Type the space name." } };
      }
      rows = rows.filter((r) => r !== target);
      return {
        body: {
          success: true,
          data: { backup: { folder: "space-x", path: BACKUP_PATH } },
        },
      };
    }
    if (match[2] === "unarchive") {
      target.archived = false;
      target.archivedAt = null;
    }
    if (match[2] === "backup") {
      return { body: { success: true, data: { backup: { folder: "b", path: BACKUP_PATH } } } };
    }
    return { body: { success: true, data: {} } };
  });
});

const rowsOf = (tree: Node[]) =>
  tree.filter(
    (n) => n.type === "li" && String(n.props.className).includes("rounded-xl border border-border")
  );
const namesOf = (tree: Node[]) => byType(tree, "h3").map((n) => text(n.props.children));
/** The nodes of one row, from its item to the next item. */
function rowFor(tree: Node[], name: string): Node[] {
  const items = rowsOf(tree);
  const item = items.find((li) => {
    const heading = tree.slice(tree.indexOf(li)).find((n) => n.type === "h3");
    return heading !== undefined && text(heading.props.children) === name;
  });
  expect(item, `row of ${name}`).toBeDefined();
  const start = tree.indexOf(item!);
  const next = tree.findIndex((n, index) => index > start && items.includes(n));
  return tree.slice(start, next < 0 ? undefined : next);
}
const buttonOf = (nodes: Node[], label: string) =>
  byType(nodes, Button).find(
    (n) => text(n.props.children) === label || n.props["aria-label"] === label
  )!;
const tipOf = (nodes: Node[], button: Node) =>
  nodes
    .slice(0, nodes.indexOf(button))
    .reverse()
    .find((n) => n.type === Tooltip)!;
const dialogOf = (tree: Node[]) => {
  const at = tree.findIndex((n) => n.type === DialogTitle);
  return at < 0 ? [] : tree.slice(at);
};
const titleOf = (tree: Node[]) => text(dialogOf(tree)[0]?.props.children);
const dialogButton = (tree: Node[], label: string) =>
  byType(dialogOf(tree), Button).find((n) => text(n.props.children) === label)!;
const changes = () => requests.filter((r) => r.method !== "GET");

it("lists only the archived spaces, in the style of the Backups list", async () => {
  const tree = await settle(page, own);
  expect(namesOf(tree)).toEqual(["Experiments", "Old work", "Legacy"]);
  expect(allText(tree)).not.toContain("Default");
  expect(allText(tree)).not.toContain("Client work");
  const list = byType(tree, "ul").find((n) => n.props["aria-label"] === "Archived spaces")!;
  expect(list.props.className).toBe("space-y-3");
  const first = rowsOf(tree)[0]!;
  expect(first.props.className).toBe(
    "min-w-0 space-y-2 rounded-xl border border-border bg-card p-3"
  );
  expect(byType(tree, PagedList)).toHaveLength(1);
});

it("shows the avatar and name, then one details line with the archive date, the creation date and the size", async () => {
  const tree = await settle(page, own);
  const one = rowFor(tree, "Experiments");
  expect(byType(one, SpaceChip)).toHaveLength(0); // expanded into its span
  expect(allText(one)).toContain("EX");
  const line = one.find((n) => n.type === "p" && text(n.props.children).includes("Archived:"))!;
  const words = text(line.props.children);
  expect(words).toMatch(/^Archived: .*Nov.*2026.* · Created: .*Oct.*2026.* · Size: 1\.5 MB$/);
  expect(line.props.className).toContain("text-xs text-muted-foreground");
});

it("reads 'not recorded' when the archive date is missing", async () => {
  const tree = await settle(page, own);
  const line = rowFor(tree, "Legacy").find(
    (n) => n.type === "p" && text(n.props.children).includes("Archived:")
  )!;
  expect(text(line.props.children)).toContain("Archived: not recorded");
  expect(text(line.props.children)).toContain("Size: 0 byte");
});

it("sorts by the archive date, newest first, with the missing date last", async () => {
  const tree = await settle(page, own);
  const list = byType(tree, PagedList)[0]!;
  const view = list.props.view as { sort: string; order: string; sorts: { value: string }[] };
  expect(view.sort).toBe("archived");
  expect(view.order).toBe("desc");
  expect(view.sorts.map((sort) => sort.value)).toEqual(["archived", "name", "created", "size"]);
  expect(namesOf(tree)).toEqual(["Experiments", "Old work", "Legacy"]);
  expect(list.props.totalLabel).toBe("Archived spaces: 3");
});

it("uses the archive date, not the creation date, for the sort", async () => {
  rows.find((r) => r.id === "experiments")!.createdAt = "2025-01-01T00:00:00.000Z";
  rows.find((r) => r.id === "old-work")!.createdAt = "2026-12-01T00:00:00.000Z";
  const tree = await settle(page, own);
  expect(namesOf(tree)).toEqual(["Experiments", "Old work", "Legacy"]);
});

it("shows Restore as a text button, and Back up and Delete as icon-only buttons with tooltips", async () => {
  const tree = await settle(page, own);
  const one = rowFor(tree, "Experiments");
  const restore = buttonOf(one, "Restore");
  expect(restore.props.variant).toBe("outline");
  expect([restore.props.children].flat().some((c) => (c as Node)?.type === ArchiveRestore)).toBe(
    true
  );
  const backup = buttonOf(one, "Back up");
  expect(backup.props.size).toBe("icon-sm");
  expect(backup.props["aria-label"]).toBe("Back up");
  expect(tipOf(one, backup).props.content).toBe("Back up");
  expect([backup.props.children].flat().some((c) => (c as Node)?.type === DatabaseBackup)).toBe(
    true
  );
  const del = buttonOf(one, "Delete");
  expect(del.props.variant).toBe("destructive");
  expect(del.props.size).toBe("icon-sm");
  expect(tipOf(one, del).props.content).toBe("Delete");
  expect([del.props.children].flat().some((c) => (c as Node)?.type === Trash2)).toBe(true);
});

it("opens a confirmation on Restore, sends nothing until confirmed, then unarchives and the row leaves", async () => {
  let announced = 0;
  const stop = onSpacesChanged(() => announced++);
  let tree = await settle(page, own);
  buttonOf(rowFor(tree, "Experiments"), "Restore").props.onClick();
  tree = await settle(page, own);
  expect(titleOf(tree)).toBe("Restore Experiments?");
  expect(allText(dialogOf(tree))).toContain(
    "The space returns to the sidebar tree and can be activated again. Its memories are unchanged."
  );
  expect(dialogOf(tree).some((n) => n.type === Input)).toBe(false);
  expect(changes()).toEqual([]);
  expect(announced).toBe(0);
  dialogButton(tree, "Restore").props.onClick();
  tree = await settle(page, own);
  stop();
  expect(changes().map((r) => `${r.method} ${r.path}`)).toEqual([
    "POST /api/spaces/experiments/unarchive",
  ]);
  expect(titleOf(tree)).toBe("");
  expect(namesOf(tree)).toEqual(["Old work", "Legacy"]);
  expect(announced).toBe(1);
  expect(allText(tree)).toContain("Restored Experiments. It is back in the sidebar tree.");
});

it("closes on Cancel without a request", async () => {
  let tree = await settle(page, own);
  buttonOf(rowFor(tree, "Experiments"), "Restore").props.onClick();
  tree = await settle(page, own);
  dialogButton(tree, "Cancel").props.onClick();
  tree = await settle(page, own);
  expect(titleOf(tree)).toBe("");
  expect(changes()).toEqual([]);
  expect(namesOf(tree)).toContain("Experiments");
});

it("keeps the dialog open and shows the server reason when a restore fails", async () => {
  refuse = "Another process holds the space.";
  let tree = await settle(page, own);
  buttonOf(rowFor(tree, "Experiments"), "Restore").props.onClick();
  tree = await settle(page, own);
  dialogButton(tree, "Restore").props.onClick();
  tree = await settle(page, own);
  expect(titleOf(tree)).toBe("Restore Experiments?");
  expect(allText(dialogOf(tree))).toContain("Another process holds the space.");
  expect(namesOf(tree)).toContain("Experiments");
});

it("backs a space up from the list after a confirmation", async () => {
  let tree = await settle(page, own);
  buttonOf(rowFor(tree, "Old work"), "Back up").props.onClick();
  tree = await settle(page, own);
  expect(titleOf(tree)).toBe("Back up Old work?");
  expect(changes()).toEqual([]);
  dialogButton(tree, "Back up").props.onClick();
  tree = await settle(page, own);
  expect(changes().map((r) => `${r.method} ${r.path}`)).toEqual([
    "POST /api/spaces/old-work/backup",
  ]);
  expect(allText(tree)).toContain(`Backup saved to ${BACKUP_PATH}`);
});

it("deletes from the list only after the exact name is typed", async () => {
  let tree = await settle(page, own);
  buttonOf(rowFor(tree, "Old work"), "Delete").props.onClick();
  tree = await settle(page, own);
  expect(titleOf(tree)).toContain("Delete Old work?");
  const confirmButton = () =>
    byType(dialogOf(tree), Button).find((n) => text(n.props.children) === "Delete space")!;
  const field = () =>
    dialogOf(tree).find((n) => n.type === Input && n.props.id === "space-delete-name")!;
  expect(confirmButton().props.disabled).toBe(true);
  field().props.onChange({ target: { value: "old work" } });
  tree = await settle(page, own);
  expect(confirmButton().props.disabled).toBe(true);
  field().props.onChange({ target: { value: "Old work" } });
  tree = await settle(page, own);
  expect(confirmButton().props.disabled).toBe(false);
  tree
    .find((n) => n.type === "form" && n.props.className === "grid gap-6")!
    .props.onSubmit({
      preventDefault() {},
    });
  tree = await settle(page, own);
  expect(changes()[0]).toMatchObject({
    method: "DELETE",
    path: "/api/spaces/old-work",
    body: { confirmName: "Old work" },
  });
  expect(allText(tree)).toContain(BACKUP_PATH);
});

it("says that no space is archived, with no toolbar, when the list is empty", async () => {
  rows = rows.filter((r) => !r.archived);
  const tree = await settle(page, own);
  expect(allText(tree)).toContain("No space is archived.");
  expect(byType(tree, PagedList)).toHaveLength(0);
  expect(rowsOf(tree)).toHaveLength(0);
});

it("pages the list at 5 rows, with the total on the toolbar", async () => {
  for (let i = 0; i < 6; i++) {
    rows.push(row(`extra-${i}`, `Extra ${i}`, { archivedAt: `2026-10-0${i + 1}T00:00:00.000Z` }));
  }
  const tree = await settle(page, own);
  const list = byType(tree, PagedList)[0]!;
  const view = list.props.view as { total: number; perPage: number; to: number; page: number };
  expect(view).toMatchObject({ total: 9, perPage: 5, page: 1, to: 5 });
  expect(rowsOf(tree)).toHaveLength(5);
  expect(list.props.totalLabel).toBe("Archived spaces: 9");
});

it("shows the Archive page in Arabic", async () => {
  setLanguage("ar");
  const tree = await settle(page, own);
  const words = allText(tree);
  expect(words).toContain("المساحات المؤرشفة تبقى على القرص");
  expect(words).toContain("الأرشفة: غير مسجل");
  expect(words).toContain("الحجم:");
  expect(buttonOf(rowFor(tree, "Experiments"), "استعادة")).toBeDefined();
  expect(buttonOf(rowFor(tree, "Experiments"), "حذف")).toBeDefined();
  const list = byType(tree, PagedList)[0]!;
  expect(list.props.totalLabel).toBe("المساحات المؤرشفة: 3");
  expect(words).not.toContain("Archived");
  rows = rows.filter((r) => !r.archived);
  resetRender();
  expect(allText(await settle(page, own))).toContain("لا توجد مساحة مؤرشفة.");
});

it("keeps a missing archive date last when the sort runs the other way", async () => {
  let tree = await settle(page, own);
  const view = byType(tree, PagedList)[0]!.props.view as {
    setSort: (sort: string, order: string) => void;
  };
  view.setSort("archived", "asc");
  tree = await settle(page, own);
  expect(namesOf(tree)).toEqual(["Old work", "Experiments", "Legacy"]);
});
