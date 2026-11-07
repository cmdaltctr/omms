import { beforeEach, expect, it, mock } from "bun:test";
import { existsSync } from "node:fs";
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
mock.module("../src/lib/power.ts", () => ({
  STATUS_POLL_MS: 15_000,
  readPowerStatus: async () => ({ version: "1", canControl: true }),
}));
mock.module("../src/lib/settings-navigation.ts", () => ({ revealPageAnchor: () => {} }));
// The browser decodes and crops the image; the spec only needs the PNG text it sends.
mock.module("../src/lib/avatar-image.ts", () => ({
  avatarPng: async () => "PNGDATA",
  checkAvatarFile: async () => null,
}));

const { SpacesView } = await import("../src/lib/components/spaces/SpacesView.tsx");
const { SpaceCard } = await import("../src/lib/components/spaces/SpaceCard.tsx");
const { SpaceChip } = await import("../src/lib/components/spaces/SpaceChip.tsx");
const { SpaceViewToggle } = await import("../src/lib/components/spaces/SpaceViewToggle.tsx");
const { SpaceBackups } = await import("../src/lib/components/spaces/SpaceBackups.tsx");
const { SpaceDeleteDialog } = await import("../src/lib/components/spaces/SpaceDeleteDialog.tsx");
const { SpaceEditDialog } = await import("../src/lib/components/spaces/SpaceEditDialog.tsx");
const { SpaceActionButton } = await import("../src/lib/components/spaces/SpaceActionButton.tsx");
const { AvatarEditorDialog } = await import("../src/lib/components/avatar/AvatarEditorDialog.tsx");
const { AvatarDialog } = await import("../src/lib/components/memory/AvatarDialog.tsx");
const { Button } = await import("../src/lib/components/ui/button.tsx");
const { Input } = await import("../src/lib/components/ui/input.tsx");
const { setLanguage } = await import("../src/lib/i18n/index.ts");
const { onSpacesChanged } = await import("../src/lib/spaces-store.ts");
const { Bot, Pencil } = await import("lucide-react");

const own = [
  SpacesView,
  SpaceCard,
  SpaceChip,
  SpaceViewToggle,
  SpaceBackups,
  SpaceDeleteDialog,
  SpaceEditDialog,
  SpaceActionButton,
  AvatarEditorDialog,
  AvatarDialog,
];
const page = <SpacesView />;

type Look = { kind: "default" } | { kind: "icon"; icon: string } | { kind: "image"; image: string };
type Row = { id: string; name: string; archived: boolean; sizeBytes: number; look: Look };
let rows: Row[] = [];
let failRename = "";
let failLook = "";
let requests: Request[] = [];

beforeEach(() => {
  resetRender();
  setLanguage("en");
  failRename = "";
  failLook = "";
  rows = [
    { id: "default", name: "Default", archived: false, sizeBytes: 10, look: { kind: "default" } },
    {
      id: "experiments",
      name: "Experiments",
      archived: false,
      sizeBytes: 20,
      look: { kind: "default" },
    },
  ];
  requests = installFetch(({ method, path, body }) => {
    if (method === "GET" && path === "/api/spaces") {
      return {
        body: {
          success: true,
          data: {
            activeSpaceId: "default",
            current: { id: "default", name: "Default", customStoragePath: false },
            backups: [],
            spaces: rows.map((row) => ({
              ...row,
              createdAt: row.id === "default" ? null : "2026-11-01T10:00:00.000Z",
              active: row.id === "default",
              disabled: row.id === "default" ? { archive: "default" } : {},
            })),
          },
        },
      };
    }
    const match = /^\/api\/spaces\/([^/]+)\/(rename|appearance)$/.exec(path);
    const row = rows.find((candidate) => candidate.id === match?.[1]);
    if (!match || !row) return { status: 404, body: { success: false, error: "No such space." } };
    if (match[2] === "rename") {
      if (failRename) return { status: 409, body: { success: false, error: failRename } };
      row.name = body.name;
      return { body: { success: true, data: {} } };
    }
    if (failLook) return { status: 400, body: { success: false, error: failLook } };
    row.look =
      method === "DELETE"
        ? { kind: "default" }
        : body.kind === "icon"
          ? { kind: "icon", icon: body.icon }
          : { kind: "image", image: `data:image/png;base64,${body.png}` };
    return { body: { success: true, data: { look: row.look } } };
  });
});

const isCard = (node: Node) =>
  typeof node.props.id === "string" && node.props.id.startsWith("space-card-");
function cardOf(tree: Node[], id: string): Node[] {
  const start = tree.findIndex((node) => node.props.id === `space-card-${id}`);
  expect(start, `card ${id}`).toBeGreaterThanOrEqual(0);
  const next = tree.findIndex((node, index) => index > start && isCard(node));
  return tree.slice(start, next < 0 ? undefined : next);
}
const pencil = (tree: Node[], id: string, name: string, label = "Edit space") =>
  byType(cardOf(tree, id), Button).find((n) => n.props["aria-label"] === `${label}: ${name}`)!;
const input = (tree: Node[], id: string) =>
  tree.find((n) => n.type === Input && n.props.id === id)!;
const buttonText = (tree: Node[], label: string) =>
  byType(tree, Button).find((n) => text(n.props.children) === label)!;
const iconButton = (tree: Node[], name: string) =>
  byType(tree, "button").find((n) => n.props["aria-label"] === name && n.props.title === name)!;
const type = (node: Node, value: string) => node.props.onChange({ target: { value } });
const open = async (id: string, name: string, label?: string) => {
  let tree = await settle(page, own);
  pencil(tree, id, name, label).props.onClick();
  tree = await settle(page, own);
  return tree;
};
const calls = () => requests.map((r) => `${r.method} ${r.path}`);

it("puts a pencil icon button at the top-end corner of every card", async () => {
  const tree = await settle(page, own);
  for (const [id, name] of [
    ["default", "Default"],
    ["experiments", "Experiments"],
  ]) {
    const button = pencil(tree, id!, name!);
    expect(button.props.variant).toBe("ghost");
    expect(button.props.size).toBe("icon-sm");
    expect(button.props.title).toBe("Edit");
    expect(button.props.className).toContain("absolute end-2 top-2");
    expect(byType(cardOf(tree, id!), Pencil).length).toBeGreaterThan(0);
  }
});

it("opens the edit dialog with a name field and the avatar controls of the host dialog", async () => {
  const tree = await open("experiments", "Experiments");
  const words = allText(tree);
  expect(words).toContain("Edit space: Experiments");
  expect(words).toContain(
    "Every avatar is shown at the same size. Images are cropped to a square."
  );
  expect(words).toContain("Upload image");
  expect(words).toContain("Reset to default");
  expect(words).toContain("PNG, JPEG, WebP or GIF, up to 20 MB.");
  expect(words).toContain("Cancel");
  expect(words).toContain("Save");
  expect(input(tree, "space-edit-name").props.value).toBe("Experiments");
  expect(input(tree, "space-edit-name").props.disabled).toBeFalsy();
  expect(tree.some((n) => n.type === Input && n.props["aria-label"] === "Search icons")).toBe(true);
  expect(iconButton(tree, "bot")).toBeDefined();
  expect(byType(tree, "input").some((n) => n.props.type === "file")).toBe(true);
});

it("keeps Save disabled until the name or the look changes", async () => {
  let tree = await open("experiments", "Experiments");
  expect(buttonText(tree, "Save").props.disabled).toBe(true);
  type(input(tree, "space-edit-name"), "Lab");
  tree = await settle(page, own);
  expect(buttonText(tree, "Save").props.disabled).toBe(false);
  type(input(tree, "space-edit-name"), "Experiments");
  tree = await settle(page, own);
  expect(buttonText(tree, "Save").props.disabled).toBe(true);
  iconButton(tree, "bot").props.onClick();
  tree = await settle(page, own);
  expect(buttonText(tree, "Save").props.disabled).toBe(false);
});

it("renames, then saves the icon, then reloads the list and tells the sidebar tree", async () => {
  let tree = await open("experiments", "Experiments");
  let announced = 0;
  const stop = onSpacesChanged(() => announced++);
  const before = requests.length;
  type(input(tree, "space-edit-name"), "Lab");
  tree = await settle(page, own);
  iconButton(tree, "bot").props.onClick();
  tree = await settle(page, own);
  buttonText(tree, "Save").props.onClick();
  tree = await settle(page, own);
  stop();
  expect(calls().slice(before)).toEqual([
    "POST /api/spaces/experiments/rename",
    "PUT /api/spaces/experiments/appearance",
    "GET /api/spaces",
  ]);
  expect(requests[before]!.body).toEqual({ name: "Lab" });
  expect(requests[before + 1]!.body).toEqual({ kind: "icon", icon: "bot" });
  expect(announced).toBe(1);
  expect(allText(tree)).not.toContain("Edit space:");
  expect(allText(tree)).toContain("Saved Lab.");
  expect(byType(cardOf(tree, "experiments"), Bot).length).toBeGreaterThan(0);
  expect(allText(cardOf(tree, "experiments"))).toContain("Lab");
});

it("saves only the icon when the name is unchanged", async () => {
  let tree = await open("experiments", "Experiments");
  const before = requests.length;
  iconButton(tree, "bot").props.onClick();
  tree = await settle(page, own);
  buttonText(tree, "Save").props.onClick();
  await settle(page, own);
  expect(calls().slice(before)).toEqual([
    "PUT /api/spaces/experiments/appearance",
    "GET /api/spaces",
  ]);
});

it("sends the cropped PNG when an image is chosen", async () => {
  let tree = await open("experiments", "Experiments");
  const before = requests.length;
  const file = byType(tree, "input").find((n) => n.props.type === "file")!;
  file.props.onChange({ target: { files: [new Blob(["x"])] } });
  tree = await settle(page, own);
  buttonText(tree, "Save").props.onClick();
  await settle(page, own);
  expect(requests[before]).toMatchObject({
    method: "PUT",
    path: "/api/spaces/experiments/appearance",
    body: { kind: "image", png: "PNGDATA" },
  });
});

it("resets the look with a DELETE", async () => {
  rows[1]!.look = { kind: "icon", icon: "bot" };
  let tree = await open("experiments", "Experiments");
  const before = requests.length;
  buttonText(tree, "Reset to default").props.onClick();
  tree = await settle(page, own);
  buttonText(tree, "Save").props.onClick();
  await settle(page, own);
  expect(calls().slice(before)).toEqual([
    "DELETE /api/spaces/experiments/appearance",
    "GET /api/spaces",
  ]);
});

// Reversal with rename-default-space: the old test here asserted the blocked field.
it("lets Default be renamed like any other space", async () => {
  let tree = await open("default", "Default");
  expect(input(tree, "space-edit-name").props.disabled).toBeFalsy();
  expect(
    byType(tree, "p").find((n) => text(n.props.children) === "The Default space cannot be renamed.")
  ).toBeUndefined();
  const before = requests.length;
  type(input(tree, "space-edit-name"), "Main");
  tree = await settle(page, own);
  buttonText(tree, "Save").props.onClick();
  tree = await settle(page, own);
  expect(calls().slice(before)).toEqual(["POST /api/spaces/default/rename", "GET /api/spaces"]);
  expect(requests[before]!.body).toEqual({ name: "Main" });
  expect(allText(tree)).toContain("Saved Main.");
});

it("keeps the dialog open and shows the server reason when the rename fails", async () => {
  failRename = "A space named Lab already exists.";
  let tree = await open("experiments", "Experiments");
  const before = requests.length;
  type(input(tree, "space-edit-name"), "Lab");
  tree = await settle(page, own);
  iconButton(tree, "bot").props.onClick();
  tree = await settle(page, own);
  buttonText(tree, "Save").props.onClick();
  tree = await settle(page, own);
  expect(allText(tree)).toContain("Edit space: Experiments");
  const alert = byType(tree, "p").find((n) => n.props.role === "alert")!;
  expect(text(alert.props.children)).toBe("A space named Lab already exists.");
  // The icon is not saved when the name is refused.
  expect(calls().slice(before)).toEqual(["POST /api/spaces/experiments/rename"]);
});

it("keeps the dialog open when the icon fails after a rename, and shows the new name", async () => {
  failLook = "That icon is not allowed.";
  let tree = await open("experiments", "Experiments");
  type(input(tree, "space-edit-name"), "Lab");
  tree = await settle(page, own);
  iconButton(tree, "bot").props.onClick();
  tree = await settle(page, own);
  buttonText(tree, "Save").props.onClick();
  tree = await settle(page, own);
  expect(allText(tree)).toContain("That icon is not allowed.");
  expect(allText(tree)).toContain("Edit space: Lab");
  expect(allText(cardOf(tree, "experiments"))).toContain("Lab");
});

it("closes without a request on Cancel", async () => {
  let tree = await open("experiments", "Experiments");
  const before = requests.length;
  buttonText(tree, "Cancel").props.onClick();
  tree = await settle(page, own);
  expect(allText(tree)).not.toContain("Edit space:");
  expect(requests.length).toBe(before);
});

it("has no Rename button and no rename dialog any more", async () => {
  const tree = await settle(page, own);
  expect(byType(tree, Button).filter((n) => text(n.props.children) === "Rename")).toHaveLength(0);
  expect(byType(tree, Button).filter((n) => n.props["aria-label"] === "Rename")).toHaveLength(0);
  expect(
    existsSync(new URL("../src/lib/components/spaces/SpaceRenameDialog.tsx", import.meta.url))
  ).toBe(false);
});

it("shows the edit dialog in Arabic", async () => {
  setLanguage("ar");
  const tree = await open("experiments", "Experiments", "تعديل المساحة");
  const words = allText(tree);
  expect(words).toContain("تعديل المساحة: Experiments");
  expect(words).toContain("رفع صورة");
  expect(words).toContain("حفظ");
  expect(words).toContain("الاسم");
  expect(words).not.toContain("Edit space");
});

// The host dialog shares its body with the space dialog. These checks keep its behaviour.
it("still saves a host icon through the shared dialog, and keeps it open on an error", async () => {
  let closed = 0;
  const sent: { path: string; method: string; body: unknown }[] = [];
  let reject = "";
  Object.assign(globalThis, {
    window: { __OMMS_TOKEN__: "token", location: { hash: "" } },
    fetch: async (path: string, options: RequestInit = {}) => {
      sent.push({
        path,
        method: options.method ?? "GET",
        body: options.body ? JSON.parse(String(options.body)) : undefined,
      });
      if (reject) return new Response(JSON.stringify({ error: reject }), { status: 400 });
      return new Response(JSON.stringify({ hosts: {} }));
    },
  });
  const dialog = <AvatarDialog host="pi" onClose={() => closed++} />;
  const hostOwn = [AvatarDialog, AvatarEditorDialog];
  let tree = await settle(dialog, hostOwn);
  expect(allText(tree)).toContain("Change icon: Pi");
  expect(buttonText(tree, "Save").props.disabled).toBe(true);
  iconButton(tree, "bot").props.onClick();
  tree = await settle(dialog, hostOwn);
  buttonText(tree, "Save").props.onClick();
  await settle(dialog, hostOwn);
  expect(sent.at(-1)).toMatchObject({
    path: "/api/host-appearance/pi",
    method: "PUT",
    body: { kind: "icon", icon: "bot" },
  });
  expect(closed).toBe(1);

  resetRender();
  reject = "No.";
  tree = await settle(dialog, hostOwn);
  buttonText(tree, "Reset to default").props.onClick();
  tree = await settle(dialog, hostOwn);
  buttonText(tree, "Save").props.onClick();
  tree = await settle(dialog, hostOwn);
  expect(sent.at(-1)).toMatchObject({ path: "/api/host-appearance/pi", method: "DELETE" });
  expect(closed).toBe(1);
  expect(text(byType(tree, "p").find((n) => n.props.role === "alert")!.props.children)).toBe("No.");
});

it("shows a pointer cursor on every icon button of the edit dialog", async () => {
  const tree = await open("experiments", "Experiments");
  const raw = byType(tree, "button");
  expect(raw.length).toBeGreaterThan(10);
  for (const button of raw)
    expect(button.props.className, button.props.title).toContain("cursor-pointer");
});
