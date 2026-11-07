import { beforeEach, expect, it, mock } from "bun:test";
import {
  allText,
  byType,
  installReact,
  resetRender,
  settle,
  text,
  type Node,
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
const { ExportDialog } = await import("../src/lib/components/spaces/ExportDialog.tsx");
const { ImportDialog } = await import("../src/lib/components/spaces/ImportDialog.tsx");
const { Button } = await import("../src/lib/components/ui/button.tsx");
const { Checkbox } = await import("../src/lib/components/ui/checkbox.tsx");
const { DialogTitle } = await import("../src/lib/components/ui/dialog.tsx");
const { Input } = await import("../src/lib/components/ui/input.tsx");
const { setLanguage } = await import("../src/lib/i18n/index.ts");

const own = [SpacesView, SpaceCard, SpaceActionButton, ExportDialog, ImportDialog];
const page = <SpacesView />;

type Row = {
  id: string;
  name: string;
  archived: boolean;
  createdAt: string | null;
  sizeBytes: number;
};
const baseRows = (): Row[] => [
  { id: "default", name: "Default", archived: false, createdAt: null, sizeBytes: 1572864 },
  {
    id: "experiments",
    name: "Experiments",
    archived: false,
    createdAt: "2026-11-01T10:00:00.000Z",
    sizeBytes: 2048,
  },
];
const rows: Row[] = baseRows();
let active = "default";
let requests: { method: string; path: string; body: any }[] = [];
let exportWritten = true;
let checkReply: unknown = null;
let checkCode = "";
let checkError = "";
let importCode = "";
const exportFile =
  '{\n  "format": "omms-space-export",\n  "schemaVersion": 1,\n  "memories": []\n}';
const exportDocument = JSON.parse(exportFile);

const stored = new Map<string, string>();
(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: (key: string) => stored.get(key) ?? null,
  setItem: (key: string, value: string) => stored.set(key, value),
};

/**
 * The spaces routes plus the import routes. The import routes take the parsed file as
 * JSON, and a written export answers with the file bytes and headers, not an envelope.
 */
function installRoutes(
  handlerExtras: (request: { method: string; path: string; body: any }) => unknown
) {
  requests = [];
  Object.assign(globalThis, {
    window: { __OMMS_TOKEN__: "token", location: { hash: "" } },
    fetch: async (path: string, options: RequestInit = {}) => {
      const raw = options.body;
      const body = raw ? JSON.parse(String(raw)) : undefined;
      const request = { method: options.method ?? "GET", path, body };
      requests.push(request);
      const reply = await route(request, handlerExtras);
      return reply.raw !== undefined
        ? new Response(reply.raw, { status: reply.status ?? 200, headers: reply.headers })
        : new Response(JSON.stringify(reply.body), { status: reply.status ?? 200 });
    },
  });
}

/** A route answer: an envelope body, or `raw` file bytes with response headers. */
type Reply = { status?: number; body?: unknown; raw?: string; headers?: Record<string, string> };
async function route(
  request: { method: string; path: string; body: any },
  handlerExtras: (request: { method: string; path: string; body: any }) => unknown
): Promise<Reply> {
  const { method, path, body } = request;
  const extra = handlerExtras(request);
  if (extra) return extra as Reply;
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
  if (method === "POST" && path === "/api/spaces/experiments/export") {
    if (!exportWritten) {
      return {
        body: { success: true, data: { written: false, reason: "No memories in the range." } },
      };
    }
    return {
      raw: exportFile,
      headers: {
        "content-type": "application/json",
        "content-disposition":
          'attachment; filename="omms-space-export-experiments-2026-11-06.json"',
        "x-omms-export-info": JSON.stringify({
          counts: {
            projectMemories: 12,
            userMemories: 0,
            privateSkipped: 1,
            profileItems: 0,
            pathsReplaced: 4,
            emailsReplaced: 2,
          },
          warnings: ["Share the file with care: free text may hold names."],
        }),
      },
    };
  }
  if (method === "POST" && path === "/api/spaces/import/check") {
    if (checkCode) {
      return {
        status: checkCode === "file-too-large" ? 413 : 400,
        body: { success: false, code: checkCode, error: checkError || `raw ${checkCode}` },
      };
    }
    return { body: { success: true, data: checkReply } };
  }
  if (method === "POST" && path === "/api/spaces/import") {
    if (importCode) {
      return {
        status: importCode === "name-taken" ? 409 : 400,
        body: { success: false, code: importCode, error: `raw ${importCode}` },
      };
    }
    rows.push({
      id: "from-sam",
      name: body.name,
      archived: false,
      createdAt: "2026-11-06T09:00:00.000Z",
      sizeBytes: 4096,
    });
    return {
      body: {
        success: true,
        data: {
          ok: true,
          spaceId: "from-sam",
          spaceName: body.name,
          counts: { projectMemories: 10, userMemories: 2, profileItems: 3, fileProjects: 3 },
        },
      },
    };
  }
  return { status: 404, body: { success: false, error: "unknown route" } };
}

beforeEach(() => {
  resetRender();
  stored.clear();
  setLanguage("en");
  active = "default";
  rows.length = 0;
  rows.push(...baseRows());
  exportWritten = true;
  checkCode = "";
  checkError = "";
  importCode = "";
  checkReply = {
    counts: { projectMemories: 10, userMemories: 2, profileItems: 3, fileProjects: 3 },
    projects: ["Client work", "Personal", "Writing"],
    embedding: {
      fileModel: "model-a",
      fileDimensions: 768,
      currentModel: "model-a",
      currentDimensions: 768,
    },
  };
  installRoutes(() => undefined);
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
const inputOf = (tree: Node[], id: string) =>
  tree.find((n) => n.type === Input && n.props.id === id)!;
const type = (node: Node, value: string) => node.props.onChange({ target: { value } });
const dialogOf = (tree: Node[]) => {
  const at = tree.findIndex((node) => node.type === DialogTitle);
  return at < 0 ? [] : tree.slice(at);
};
const confirmOf = (tree: Node[]) => {
  const titles = tree.filter((n) => n.type === DialogTitle);
  if (titles.length < 2) return [];
  return tree.slice(tree.lastIndexOf(titles[1]!));
};
const dialogButton = (nodes: Node[], label: string) =>
  byType(nodes, Button).find((n) => text(n.props.children) === label)!;
/** The form of the dialog that owns the input with `id`: the last form before that input. */
const formOf = (tree: Node[], id: string) => {
  const at = tree.findIndex((n) => n.type === Input && n.props.id === id);
  return byType(tree, "form")
    .filter((form) => tree.indexOf(form) < at)
    .pop()!;
};
const submit = (form: Node) => form.props.onSubmit({ preventDefault() {} });
const exportsOf = () => requests.find((r) => r.method === "POST" && r.path.endsWith("/export"));
const importsOf = () =>
  requests.filter((r) => r.method === "POST" && r.path === "/api/spaces/import");
const checksOf = () =>
  requests.filter((r) => r.method === "POST" && r.path === "/api/spaces/import/check");
const reads = () => requests.filter((r) => r.method === "GET" && r.path === "/api/spaces").length;

async function openExport(name: string) {
  const tree = await settle(page, own);
  buttonOf(rowOf(tree, name), "Export").props.onClick();
  return settle(page, own);
}
const exportFile2 = () => new File([exportFile], "space-sam.json", { type: "application/json" });
const brokenFile = () => new File(["{not json"], "broken.json", { type: "application/json" });
/** Pick a file in the Import dialog, which parses it and runs the check route. */
async function pickFile(tree: Node[], file: File) {
  const picker = tree.find((n) => n.type === "input" && n.props.type === "file")!;
  picker.props.onChange({ target: { files: [file] } });
  return settle(page, own);
}
async function openImport() {
  let tree = await settle(page, own);
  buttonOf(tree, "Import").props.onClick();
  tree = await settle(page, own);
  return pickFile(tree, exportFile2());
}

it("opens Export unticked with the personal-data note beside the checkbox", async () => {
  const tree = await openExport("Experiments");
  expect(text(dialogOf(tree)[0]?.props.children)).toBe("Export Experiments");
  const box = byType(dialogOf(tree), Checkbox)[0]!;
  expect(box.props.checked).toBe(false);
  const words = allText(dialogOf(tree));
  expect(words).toContain("Include the profile and personal memories");
  expect(words).toContain("Ticking this box adds personal data to the export file.");
  expect(words).toContain("From");
  expect(words).toContain("To");
});

it("downloads after the range and the opt-in, then shows the replaced counts, the names note and the server warnings", async () => {
  let tree = await openExport("Experiments");
  type(inputOf(tree, "space-export-since"), "2026-10-01");
  byType(dialogOf(tree), Checkbox)[0]!.props.onCheckedChange(true);
  tree = await settle(page, own);
  submit(formOf(tree, "space-export-since"));
  tree = await settle(page, own);
  expect(exportsOf()?.body).toEqual({ since: "2026-10-01", includeProfile: true });
  const words = allText(dialogOf(tree));
  expect(words).toContain("Replaced in the file: 4 home paths and 2 email addresses.");
  expect(words).toContain(
    "Names typed inside memory text are not detected. Check the file before you share it."
  );
  expect(words).toContain("Share the file with care: free text may hold names.");
  // The written export offers the file again next to the fresh-download button.
  expect(
    byType(dialogOf(tree), Button).filter((n) => text(n.props.children) === "Download")
  ).toHaveLength(2);
});

it("sends an unticked default export without a range", async () => {
  const tree = await openExport("Experiments");
  submit(formOf(tree, "space-export-since"));
  await settle(page, own);
  expect(exportsOf()?.body).toEqual({ includeProfile: false });
});

it("says when the chosen range holds no memory", async () => {
  exportWritten = false;
  const tree = await openExport("Experiments");
  submit(formOf(tree, "space-export-since"));
  const after = await settle(page, own);
  expect(allText(dialogOf(after))).toContain("This space has no memories in the chosen range.");
});

it("runs the check on the parsed file and says the project labels are kept while no folder is set", async () => {
  const tree = await openImport();
  expect(checksOf()).toHaveLength(1);
  expect(checksOf()[0]!.body).toEqual({ document: exportDocument });
  const words = allText(dialogOf(tree));
  expect(words).toContain("The project labels of the file are kept.");
  expect(words).toContain("New space name");
  expect(words).not.toContain("will merge into");
});

it("says the file's projects merge into the one folder, counting the file's project tags", async () => {
  let tree = await openImport();
  type(inputOf(tree, "space-import-project"), "~/work/app");
  tree = await settle(page, own);
  expect(allText(dialogOf(tree))).toContain(
    "All 3 projects of the file will merge into the one project ~/work/app."
  );
  expect(allText(dialogOf(tree))).not.toContain("The project labels of the file are kept.");
});

it("warns with both models before the user confirms", async () => {
  checkReply = {
    counts: { projectMemories: 10, userMemories: 2, profileItems: 3, fileProjects: 3 },
    projects: ["Client work", "Personal", "Writing"],
    embedding: {
      fileModel: "model-a",
      fileDimensions: 768,
      currentModel: "model-b",
      currentDimensions: 1024,
    },
  };
  const tree = await openImport();
  expect(allText(dialogOf(tree))).toContain(
    "The file uses the embedding model model-a (768D), but the settings use model-b (1024D). Search may miss the imported memories until they are embedded again."
  );
});

it("refuses a taken name in the dialog, with the reason, and sends no import", async () => {
  let tree = await openImport();
  type(inputOf(tree, "space-import-name"), "Default");
  tree = await settle(page, own);
  expect(allText(dialogOf(tree))).toContain(
    "A space with the name Default already exists. Choose another name."
  );
  expect(dialogButton(dialogOf(tree), "Import").props.disabled).toBe(true);
  expect(importsOf()).toEqual([]);
});

it("asks for confirmation before the import runs, and Cancel sends nothing", async () => {
  let tree = await openImport();
  type(inputOf(tree, "space-import-name"), "From Sam");
  tree = await settle(page, own);
  submit(formOf(tree, "space-import-name"));
  tree = await settle(page, own);
  const words = allText(confirmOf(tree));
  expect(words).toContain("Import into From Sam?");
  expect(words).toContain(
    "OMMS creates the space From Sam and writes the memories of the file into it. The active space does not change."
  );
  expect(importsOf()).toEqual([]);
  const cancels = byType(confirmOf(tree), Button).filter(
    (n) => text(n.props.children) === "Cancel"
  );
  cancels[cancels.length - 1]!.props.onClick();
  tree = await settle(page, own);
  expect(confirmOf(tree)).toEqual([]);
  expect(importsOf()).toEqual([]);
});

it("imports the parsed document after the confirmation, says the count and the new space, and reloads the page", async () => {
  const readsBefore = reads();
  let tree = await openImport();
  type(inputOf(tree, "space-import-name"), "From Sam");
  tree = await settle(page, own);
  submit(formOf(tree, "space-import-name"));
  tree = await settle(page, own);
  dialogButton(confirmOf(tree), "Import").props.onClick();
  tree = await settle(page, own);
  expect(importsOf()).toHaveLength(1);
  expect(importsOf()[0]!.body).toEqual({ document: exportDocument, name: "From Sam" });
  expect(allText(dialogOf(tree))).toContain("Imported 12 memories into From Sam.");
  expect(byType(tree, "h3").map((node) => text(node.props.children))).toContain("From Sam");
  expect(reads()).toBeGreaterThan(readsBefore);
});

it("shows the localised folder reason for a missing project folder, and sends the folder", async () => {
  importCode = "missing-folder";
  let tree = await openImport();
  type(inputOf(tree, "space-import-project"), "~/no/such/folder");
  type(inputOf(tree, "space-import-name"), "From Sam");
  tree = await settle(page, own);
  submit(formOf(tree, "space-import-name"));
  tree = await settle(page, own);
  dialogButton(confirmOf(tree), "Import").props.onClick();
  tree = await settle(page, own);
  const words = allText(dialogOf(tree));
  expect(words).toContain("The project folder does not exist. Check the path.");
  expect(importsOf()[0]!.body).toEqual({
    document: exportDocument,
    name: "From Sam",
    retagToProject: "~/no/such/folder",
  });
  expect(confirmOf(tree)).toEqual([]);
  expect(words).toContain("Import a space");
});

it("shows the localised sentence when the server refuses a taken name", async () => {
  importCode = "name-taken";
  let tree = await openImport();
  type(inputOf(tree, "space-import-name"), "From Sam");
  tree = await settle(page, own);
  submit(formOf(tree, "space-import-name"));
  tree = await settle(page, own);
  dialogButton(confirmOf(tree), "Import").props.onClick();
  tree = await settle(page, own);
  expect(allText(dialogOf(tree))).toContain(
    "A space with the name From Sam already exists. Choose another name."
  );
});

it("shows the route's own reason when the file is refused at the check", async () => {
  checkCode = "invalid-file";
  checkError = "The file was written by a newer OMMS (format version 2). This OMMS reads 1.";
  const tree = await openImport();
  expect(allText(dialogOf(tree))).toContain(
    "The file was written by a newer OMMS (format version 2). This OMMS reads 1."
  );
  checkCode = "file-too-large";
  checkError = "The upload is larger than the import limit of 104857600 bytes.";
  const again = await openImport();
  expect(allText(dialogOf(again))).toContain(
    "The upload is larger than the import limit of 104857600 bytes."
  );
});

it("refuses a file that is not JSON in the browser, without a request", async () => {
  let tree = await settle(page, own);
  buttonOf(tree, "Import").props.onClick();
  tree = await settle(page, own);
  tree = await pickFile(tree, brokenFile());
  expect(allText(dialogOf(tree))).toContain(
    "The file is not valid JSON. Choose an OMMS export file."
  );
  expect(checksOf()).toEqual([]);
});
