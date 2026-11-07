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
  readPowerStatus: async () => {
    return { version: "1", canControl: true };
  },
}));

const { SpacesView } = await import("../src/lib/components/spaces/SpacesView.tsx");
const { SpaceCard } = await import("../src/lib/components/spaces/SpaceCard.tsx");
const { SpaceActionButton } = await import("../src/lib/components/spaces/SpaceActionButton.tsx");
const { TransferDialog, Field } = await import("../src/lib/components/spaces/TransferDialog.tsx");
const { TransferPreview } = await import("../src/lib/components/spaces/TransferPreview.tsx");
const { Button } = await import("../src/lib/components/ui/button.tsx");
const { DialogTitle } = await import("../src/lib/components/ui/dialog.tsx");
const { Input } = await import("../src/lib/components/ui/input.tsx");
const { Select } = await import("../src/lib/components/ui/select.tsx");
const { setLanguage } = await import("../src/lib/i18n/index.ts");

// The page, the cards and the two transfer components expand; the library controls stay as elements.
const own = [SpacesView, SpaceCard, SpaceActionButton, TransferDialog, TransferPreview, Field];
const page = <SpacesView />;

type Row = {
  id: string;
  name: string;
  archived: boolean;
  createdAt: string | null;
  sizeBytes: number;
};
const rows: Row[] = [
  { id: "default", name: "Default", archived: false, createdAt: null, sizeBytes: 1572864 },
  {
    id: "experiments",
    name: "Experiments",
    archived: false,
    createdAt: "2026-11-01T10:00:00.000Z",
    sizeBytes: 2048,
  },
];
let active = "default";
let requests: Request[] = [];
let hold: Promise<void> | null = null;
/** The route reply shape: `matched` counts the filter, `toCopy` removes the duplicates. */
let previewCount = 20;
const previewData = () =>
  previewCount === 0
    ? { matched: 0, toCopy: 0, duplicates: 0, groups: [], examples: [] }
    : {
        matched: previewCount,
        toCopy: 17,
        duplicates: 3,
        groups: [
          { name: "Client work", count: 15 },
          { name: "Personal", count: 5 },
        ],
        examples: [{ id: "a", text: "First example memory" }],
      };
let busyApply = false;

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
  requests = [];
  previewCount = 20;
  busyApply = false;
  hold = null;
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
    if (method === "POST" && path === "/api/spaces/transfer/preview") {
      await hold;
      return { body: { success: true, data: { preview: previewData() } } };
    }
    if (method === "POST" && path === "/api/spaces/transfer") {
      if (busyApply) {
        return {
          status: 409,
          body: { success: false, code: "transfer-busy", error: "Another transfer is running." },
        };
      }
      const mode = (body as { mode?: string }).mode === "move" ? "move" : "copy";
      return {
        body: {
          success: true,
          data: {
            result: {
              ok: true,
              mode,
              copied: 17,
              skipped: 3,
              removed: mode === "move" ? 16 : 0,
              changedFromPreview: 0,
              embeddedAgain: false,
            },
          },
        },
      };
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
const selectOf = (tree: Node[], id: string) =>
  tree.find((n) => n.type === Select && n.props.id === id)!;
const inputOf = (tree: Node[], id: string) =>
  tree.find((n) => n.type === Input && n.props.id === id)!;
const type = (node: Node, value: string) => node.props.onChange({ target: { value } });
const choose = (node: Node, value: string) => node.props.onChange({ target: { value } });
/** The nodes of the open dialog, from its title on. */
const dialogOf = (tree: Node[]) => {
  const at = tree.findIndex((node) => node.type === DialogTitle);
  return at < 0 ? [] : tree.slice(at);
};
/** The confirm dialog renders after the transfer dialog, so it owns the second title. */
const confirmOf = (tree: Node[]) => {
  const titles = tree.filter((n) => n.type === DialogTitle);
  if (titles.length < 2) return [];
  return tree.slice(tree.lastIndexOf(titles[1]!));
};
const dialogButton = (nodes: Node[], label: string) =>
  byType(nodes, Button).find((n) => text(n.props.children) === label)!;
const applies = () =>
  requests.filter((r) => r.method === "POST" && r.path === "/api/spaces/transfer");
const previews = () =>
  requests.filter((r) => r.method === "POST" && r.path === "/api/spaces/transfer/preview");
const reads = () => requests.filter((r) => r.method === "GET" && r.path === "/api/spaces").length;
/** The form of the transfer dialog: the last form before one of its fields. */
const formOf = (tree: Node[], id: string) => {
  const at = tree.findIndex((n) => n.type === Input && n.props.id === id);
  return byType(tree, "form")
    .filter((form) => tree.indexOf(form) < at)
    .pop()!;
};
const runPreview = (tree: Node[]) =>
  formOf(tree, "space-transfer-since").props.onSubmit({ preventDefault() {} });

/** Open the Transfer dialog from the card of `name`. */
async function openTransfer(name: string) {
  const tree = await settle(page, own);
  buttonOf(rowOf(tree, name), "Transfer").props.onClick();
  return settle(page, own);
}
/** Fill the range, run one preview and return the tree. */
async function previewed(mode: "copy" | "move" = "copy") {
  let tree = await openTransfer("Experiments");
  choose(selectOf(tree, "space-transfer-mode"), mode);
  type(inputOf(tree, "space-transfer-since"), "2026-10-01");
  type(inputOf(tree, "space-transfer-until"), "2026-10-31");
  tree = await settle(page, own);
  runPreview(tree);
  return settle(page, own);
}

it("opens from the card's Transfer button with the source preset and the source out of the target picker", async () => {
  const tree = await openTransfer("Experiments");
  expect(text(dialogOf(tree)[0]?.props.children)).toBe("Transfer memories");
  const source = selectOf(tree, "space-transfer-source");
  expect(source.props.value).toBe("experiments");
  expect(source.props.disabled).toBe(true);
  const target = selectOf(tree, "space-transfer-target");
  expect(target.props.value).toBe("default");
  expect(dialogButton(dialogOf(tree), "Apply").props.disabled).toBe(true);
  expect(applies()).toEqual([]);
  expect(previews()).toEqual([]);
});

it("shows the count, the source projects, the examples and the duplicates after Preview, then enables Apply", async () => {
  const tree = await previewed();
  const words = allText(dialogOf(tree));
  expect(words).toContain("20 memories match the filter.");
  expect(words).toContain("Projects in the result:");
  expect(words).toContain("Client work: 15");
  expect(words).toContain("Personal: 5");
  expect(words).toContain("Examples:");
  expect(words).toContain("First example memory");
  expect(words).toContain("Exact duplicates already in the target will be skipped: 3.");
  expect(dialogButton(dialogOf(tree), "Apply").props.disabled).toBe(false);
  expect(previews().map((r) => r.body)).toEqual([
    { from: "experiments", to: "default", mode: "copy", since: "2026-10-01", until: "2026-10-31" },
  ]);
});

it("shows progress while the preview runs and keeps Apply off", async () => {
  let release: () => void = () => {};
  hold = new Promise<void>((resolve) => (release = resolve));
  let tree = await openTransfer("Experiments");
  runPreview(tree);
  tree = await settle(page, own);
  expect(allText(dialogOf(tree))).toContain("Checking what matches…");
  expect(dialogButton(dialogOf(tree), "Apply").props.disabled).toBe(true);
  release();
  tree = await settle(page, own);
  expect(allText(dialogOf(tree))).toContain("20 memories match the filter.");
});

it("clears the preview on any filter change and keeps Apply disabled until a new preview", async () => {
  let tree = await previewed();
  expect(dialogButton(dialogOf(tree), "Apply").props.disabled).toBe(false);
  type(inputOf(tree, "space-transfer-until"), "2026-10-15");
  tree = await settle(page, own);
  let words = allText(dialogOf(tree));
  expect(words).not.toContain("20 memories match the filter.");
  expect(words).toContain("The filter changed, so the preview was cleared. Run Preview again.");
  expect(dialogButton(dialogOf(tree), "Apply").props.disabled).toBe(true);

  // A mode change clears a fresh preview too.
  runPreview(tree);
  tree = await settle(page, own);
  expect(dialogButton(dialogOf(tree), "Apply").props.disabled).toBe(false);
  choose(selectOf(tree, "space-transfer-mode"), "move");
  tree = await settle(page, own);
  words = allText(dialogOf(tree));
  expect(words).toContain("The filter changed, so the preview was cleared. Run Preview again.");
  expect(dialogButton(dialogOf(tree), "Apply").props.disabled).toBe(true);
  expect(applies()).toEqual([]);
});

it("says that nothing matches when the preview count is zero and keeps Apply disabled", async () => {
  previewCount = 0;
  const tree = await previewed();
  const words = allText(dialogOf(tree));
  expect(words).toContain("No memory matches the filter.");
  expect(words).not.toContain("The filter changed");
  expect(dialogButton(dialogOf(tree), "Apply").props.disabled).toBe(true);
});

it("Apply with Move opens a confirm that names the source, the target, the count and the removal", async () => {
  const tree = await previewed("move");
  dialogButton(dialogOf(tree), "Apply").props.onClick();
  const after = await settle(page, own);
  const words = allText(confirmOf(after));
  expect(words).toContain("Move 17 memories?");
  expect(words).toContain(
    "OMMS copies 17 memories from Experiments to Default and checks the copy. The memories leave Experiments only after the check passes."
  );
  expect(words).toContain("Move memories");
  expect(applies()).toEqual([]);
});

it("Apply with Copy uses the same dialog without the removal sentence", async () => {
  const tree = await previewed();
  dialogButton(dialogOf(tree), "Apply").props.onClick();
  const after = await settle(page, own);
  const words = allText(confirmOf(after));
  expect(words).toContain("Copy 17 memories?");
  expect(words).toContain("OMMS copies 17 memories from Experiments to Default.");
  expect(words).not.toContain("only after the check passes");
  expect(words).toContain("Copy memories");
});

it("Cancel in the move confirm sends no apply and keeps the preview", async () => {
  let tree = await previewed("move");
  dialogButton(dialogOf(tree), "Apply").props.onClick();
  tree = await settle(page, own);
  const cancels = byType(confirmOf(tree), Button).filter(
    (n) => text(n.props.children) === "Cancel"
  );
  cancels[cancels.length - 1]!.props.onClick();
  tree = await settle(page, own);
  expect(applies()).toEqual([]);
  expect(confirmOf(tree)).toEqual([]);
  expect(allText(dialogOf(tree))).toContain("20 memories match the filter.");
  expect(dialogButton(dialogOf(tree), "Apply").props.disabled).toBe(false);
});

it("a confirmed move sends the apply with confirm and shows moved and skipped kept in the source", async () => {
  const readsBefore = reads();
  let tree = await previewed("move");
  dialogButton(dialogOf(tree), "Apply").props.onClick();
  tree = await settle(page, own);
  dialogButton(confirmOf(tree), "Move memories").props.onClick();
  tree = await settle(page, own);
  expect(applies().map((r) => r.body)).toEqual([
    {
      from: "experiments",
      to: "default",
      mode: "move",
      since: "2026-10-01",
      until: "2026-10-31",
      confirm: true,
    },
  ]);
  const words = allText(dialogOf(tree));
  expect(words).toContain(
    "Moved 16 memories. 3 exact duplicates were skipped and stay in Experiments."
  );
  expect(reads()).toBeGreaterThan(readsBefore);
});

it("a copy result says copied and that the duplicates stay in the source", async () => {
  let tree = await previewed();
  dialogButton(dialogOf(tree), "Apply").props.onClick();
  tree = await settle(page, own);
  dialogButton(confirmOf(tree), "Copy memories").props.onClick();
  tree = await settle(page, own);
  expect(allText(dialogOf(tree))).toContain(
    "Copied 17 memories. 3 exact duplicates were skipped and stay in Experiments."
  );
});

it("a transfer-busy answer says so in words, keeps the preview and leaves Apply available", async () => {
  busyApply = true;
  let tree = await previewed();
  dialogButton(dialogOf(tree), "Apply").props.onClick();
  tree = await settle(page, own);
  dialogButton(confirmOf(tree), "Copy memories").props.onClick();
  tree = await settle(page, own);
  const words = allText(dialogOf(tree));
  expect(words).toContain("Another transfer is running. The preview is kept. Try again.");
  expect(words).toContain("20 memories match the filter.");
  expect(confirmOf(tree)).toEqual([]);
  expect(dialogButton(dialogOf(tree), "Apply").props.disabled).toBe(false);
  // A retry opens the confirm again, so the user can try once the other transfer ends.
  dialogButton(dialogOf(tree), "Apply").props.onClick();
  tree = await settle(page, own);
  expect(allText(confirmOf(tree))).toContain("Copy 17 memories?");
});

it("shows the transfer dialog in Arabic", async () => {
  setLanguage("ar");
  let tree = await settle(page, own);
  // The icon-only button carries its Arabic name.
  buttonOf(rowOf(tree, "Experiments"), "نقل").props.onClick();
  tree = await settle(page, own);
  const words = allText(dialogOf(tree));
  expect(text(dialogOf(tree)[0]?.props.children)).toBe("نقل الذكريات");
  expect(words).toContain("المساحة المصدر");
  expect(words).toContain("المساحة الهدف");
  expect(words).not.toContain("Source space");
});
