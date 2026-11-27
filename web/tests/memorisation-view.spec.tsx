import { beforeEach, expect, it, mock } from "bun:test";
import { isValidElement, type ReactNode } from "react";
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
// DOMPurify needs a browser DOM, so a stand-in removes script elements and records what it was given.
const sanitised: string[] = [];
mock.module("dompurify", () => ({
  default: {
    sanitize: (html: string) => {
      sanitised.push(html);
      return html.replace(/<script[\s\S]*?<\/script>/gi, "");
    },
  },
}));
const stored = new Map<string, string>();
(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: (key: string) => stored.get(key) ?? null,
  setItem: (key: string, value: string) => void stored.set(key, value),
};
let clipboard: string[] = [];
let clipboardRefuses = false;
Object.assign(globalThis, {
  navigator: {
    clipboard: {
      writeText: async (value: string) => {
        if (clipboardRefuses) throw new Error("refused");
        clipboard.push(value);
      },
    },
  },
});

const { MemorisationView } =
  await import("../src/lib/components/memorisation/MemorisationView.tsx");
const { MemorisationList } =
  await import("../src/lib/components/memorisation/MemorisationList.tsx");
const { MemorisationSearch } =
  await import("../src/lib/components/memorisation/MemorisationSearch.tsx");
const { MemorisationRow } = await import("../src/lib/components/memorisation/MemorisationRow.tsx");
const { MemorisationSettings } =
  await import("../src/lib/components/memorisation/MemorisationSettings.tsx");
const { RepeatChoice } = await import("../src/lib/components/memorisation/RepeatChoice.tsx");
const { SizeCapForm } = await import("../src/lib/components/memorisation/SizeCapForm.tsx");
const { PresetEditor } = await import("../src/lib/components/memorisation/PresetEditor.tsx");
const { RerankSwitch } = await import("../src/lib/components/memorisation/RerankSwitch.tsx");
const { Tooltip } = await import("../src/lib/components/ui/tooltip.tsx");
const { SettingsConfirmDialog } =
  await import("../src/lib/components/settings/SettingsConfirmDialog.tsx");
const { DeleteMemorisationDialog } =
  await import("../src/lib/components/memorisation/DeleteMemorisationDialog.tsx");
const { MemorisationSelectBar } =
  await import("../src/lib/components/memorisation/MemorisationSelectBar.tsx");
const { LabelFilterBar } = await import("../src/lib/components/memorisation/LabelFilterBar.tsx");
const { LabelPicker } = await import("../src/lib/components/memorisation/LabelPicker.tsx");
const { LabelPickerDialog } =
  await import("../src/lib/components/memorisation/LabelPickerDialog.tsx");
const { LabelPill } = await import("../src/lib/components/memorisation/LabelPill.tsx");
const { PagedList } = await import("../src/lib/components/paged-list/index.ts");
const { BulkDeleteDialog } =
  await import("../src/lib/components/memorisation/BulkDeleteDialog.tsx");
const { BulkDeleteResult } =
  await import("../src/lib/components/memorisation/BulkDeleteResult.tsx");
const { Button } = await import("../src/lib/components/ui/button.tsx");
const { Checkbox } = await import("../src/lib/components/ui/checkbox.tsx");
const { Input } = await import("../src/lib/components/ui/input.tsx");
const { Label } = await import("../src/lib/components/ui/label.tsx");
const { DialogTitle } = await import("../src/lib/components/ui/dialog.tsx");
const { HuePill } = await import("../src/lib/components/skills/HuePill.tsx");
const { setLanguage } = await import("../src/lib/i18n/index.ts");

const own = [
  MemorisationView,
  MemorisationList,
  MemorisationSearch,
  MemorisationRow,
  MemorisationSettings,
  RepeatChoice,
  SizeCapForm,
  PresetEditor,
  RerankSwitch,
  DeleteMemorisationDialog,
  MemorisationSelectBar,
  LabelFilterBar,
  LabelPicker,
  LabelPickerDialog,
  LabelPill,
  BulkDeleteDialog,
  BulkDeleteResult,
];
const page = <MemorisationView />;

type Row = {
  id: string;
  content: string;
  createdAt: string;
  host?: string;
  kind?: string;
  space?: string;
  tags?: string[];
};
let rows: Row[] = [];
let settings: Record<string, unknown> = {};
let revision = "r1";
let refuseSizeBelow = 0;
/** When set, a PATCH of memorisationRerank fails with this server reason. */
let rerankSaveFails: string | null = null;
/** When set, every PATCH of the settings fails with this server reason. */
let settingsSaveFails: string | null = null;
let deleteFails = false;
let recallReply: { status?: number; body: unknown } | null = null;
let requests: Request[] = [];
/** The address bar of the fake window: path, query and nothing else. */
let address = "/memorisation";
/** What a bulk delete answers for ids it cannot delete, by id. */
let bulkReply: { status?: number; body: unknown } | null = null;

const matchesTags = (row: Row, tags: string[]) =>
  tags.every((tag) =>
    tag
      .split("|")
      .some((alt) => (row.tags ?? []).some((own) => own.toLowerCase() === alt.toLowerCase()))
  );
/** When set, the label list route fails with this status. */
let labelsStatus = 0;
const labelsError = "disk";

beforeEach(() => {
  resetRender();
  stored.clear();
  clipboard = [];
  clipboardRefuses = false;
  setLanguage("en");
  deleteFails = false;
  recallReply = null;
  bulkReply = null;
  labelsStatus = 0;
  address = "/memorisation";
  refuseSizeBelow = 0;
  rerankSaveFails = null;
  settingsSaveFails = null;
  revision = "r1";
  settings = {
    memorisationRepeat: { value: "add", globalValue: "add" },
    memorisationMaxSize: { value: 2000, globalValue: 2000 },
    memorisationSizeUnit: { value: "characters", globalValue: "characters" },
    memorisationRerank: { value: false, globalValue: false },
  };
  rows = [
    {
      id: "ms-aaaaaa",
      content: "Topic: release\nDone: tagged\nNext: publish",
      createdAt: "2026-11-09T10:00:00.000Z",
      host: "claude-code",
      kind: "snapshot",
      tags: ["release", "handover"],
    },
    {
      id: "ms-bbbbbb",
      content: "use port 4747 only for the real app",
      createdAt: "2026-11-10T10:00:00.000Z",
      host: "pi",
      kind: "explicit",
      tags: ["ops", "handover"],
    },
  ];
  requests = installFetch(async ({ method, path, body }) => {
    const url = new URL(path, "http://web.test");
    const wanted = (url.searchParams.get("tags") ?? "").split(",").filter(Boolean);
    if (method === "GET" && url.pathname === "/api/memorisations/labels") {
      if (labelsStatus)
        return { status: labelsStatus, body: { success: false, error: labelsError } };
      const counts = new Map<string, number>();
      for (const row of rows)
        for (const tag of row.tags ?? []) counts.set(tag, (counts.get(tag) ?? 0) + 1);
      const labels = [...counts].map(([label, count]) => ({ label, count }));
      labels.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
      return { body: { success: true, data: { labels } } };
    }
    if (method === "GET" && url.pathname === "/api/memorisations") {
      return {
        body: {
          success: true,
          data: { memorisations: rows.filter((row) => matchesTags(row, wanted)) },
        },
      };
    }
    if (method === "POST" && path === "/api/memorisations/bulk-delete") {
      if (bulkReply) return bulkReply;
      const deleted: string[] = [];
      const skipped: { id: string; reason: string }[] = [];
      for (const id of body.ids as string[]) {
        const row = rows.find((candidate) => candidate.id === id);
        if (!row) skipped.push({ id, reason: "not-found" });
        else if (row.space) skipped.push({ id, reason: "linked" });
        else deleted.push(id);
      }
      rows = rows.filter((row) => !deleted.includes(row.id));
      return { body: { success: true, data: { deleted, skipped } } };
    }
    if (method === "GET" && url.pathname === "/api/memorisations/recall") {
      if (recallReply) return recallReply;
      const query = url.searchParams.get("q") ?? "";
      const byId = rows.find((row) => row.id === query);
      if (query.startsWith("ms-")) {
        return byId
          ? { body: { success: true, data: { count: 1, matches: [byId] } } }
          : { status: 404, body: { success: false, error: `No memorisation has the ID ${query}` } };
      }
      const matches = rows
        .filter((row) => matchesTags(row, wanted))
        .slice(0, 2)
        .map((row, index) => ({
          id: row.id,
          content: row.content,
          createdAt: row.createdAt,
          tags: row.tags,
          confidence: query ? 90 - index * 20 : undefined,
        }));
      return { body: { success: true, data: { count: matches.length, matches } } };
    }
    if (method === "DELETE" && path.startsWith("/api/memories/")) {
      if (deleteFails) return { status: 500, body: { success: false, error: "disk" } };
      const id = decodeURIComponent(path.split("/")[3]!);
      rows = rows.filter((row) => row.id !== id);
      return { body: { success: true, data: { deletedPrompt: false } } };
    }
    if (method === "GET" && path === "/api/settings") return { body: { revision, settings } };
    if (method === "PATCH" && path === "/api/settings") {
      if (settingsSaveFails) {
        return { status: 400, body: { success: false, error: settingsSaveFails } };
      }
      if (rerankSaveFails && body.edits.memorisationRerank !== undefined) {
        return { status: 400, body: { success: false, error: rerankSaveFails } };
      }
      const size = body.edits.memorisationMaxSize;
      if (size !== undefined && size < refuseSizeBelow) {
        return {
          status: 400,
          body: {
            error: "memorisationMaxSize must be a whole number from 100 to 20000 characters",
          },
        };
      }
      for (const [key, value] of Object.entries(body.edits)) {
        settings[key] = { value, globalValue: value };
      }
      revision = "r2";
      return { body: { success: true } };
    }
    return { status: 404, body: { success: false, error: "unexpected" } };
  });
  // The page keeps its labels in the address bar, so the fake window has one.
  Object.assign((globalThis as unknown as { window: object }).window, {
    location: {
      hash: "",
      get pathname() {
        return address.split("?")[0];
      },
      get search() {
        return address.includes("?") ? `?${address.split("?")[1]}` : "";
      },
    },
    history: {
      state: null,
      replaceState: (_state: unknown, _title: string, url: string) => void (address = url),
    },
  });
});

const changes = () => requests.filter((request) => request.method !== "GET");
const titles = (tree: Node[]) => byType(tree, "h3").map((node) => text(node.props.children));
const buttonOf = (nodes: Node[], label: string) =>
  byType(nodes, Button).find((node) => text(node.props.children).trim() === label)!;
const isRadio = (node: Node) =>
  (node.type === "button" || node.type === Button) && node.props.role === "radio";
const radioOf = (tree: Node[], label: string) =>
  tree.find((node) => isRadio(node) && text(node.props.children).includes(label))!;
const inputOf = (tree: Node[], id: string) =>
  tree.find((node) => node.type === Input && node.props.id === id)!;
const typeInto = (node: Node, value: string) => node.props.onChange({ target: { value } });
/** The nodes of one row: from its h3 to the next h3 (rows are list items). */
function rowOf(tree: Node[], title: string): Node[] {
  const start = tree.findIndex((node) => node.type === "h3" && text(node.props.children) === title);
  expect(start, `row ${title}`).toBeGreaterThanOrEqual(0);
  const next = tree.findIndex((node, index) => index > start && node.type === "h3");
  return tree.slice(start, next < 0 ? undefined : next);
}
const confirmOf = (tree: Node[]) => byType(tree, SettingsConfirmDialog)[0];
/** Presses Confirm in the open dialog, as the real dialog does: it closes itself on success. */
async function confirmDialog() {
  const dialog = confirmOf(await settle(page, own));
  expect(dialog, "a confirm dialog is open").toBeDefined();
  const result = await dialog!.props.onConfirm();
  if (result.success) dialog!.props.onClose();
  return settle(page, own);
}
const submitSearch = async (query: string) => {
  const tree = await settle(page, own);
  typeInto(inputOf(tree, "memorisation-search-input"), query);
  const filled = await settle(page, own);
  byType(filled, "form")[0]!.props.onSubmit({ preventDefault() {} });
  return settle(page, own);
};

it("lists the memorisations of the project, newest first, with ID, host and time", async () => {
  const tree = await settle(page, own);
  expect(requests[0]).toMatchObject({ method: "GET", path: "/api/memorisations" });
  expect(
    titles(tree).filter((title) => title === "release" || title.startsWith("use port"))
  ).toEqual(["use port 4747 only for the real app", "release"]);
  const row = rowOf(tree, "release");
  expect(allText(row)).toContain("ms-aaaaaa");
  expect(allText(row)).toMatch(/Saved .*2026/);
  const pills = byType(row, HuePill).map((node) => node.props.label);
  expect(pills).toEqual(["Session snapshot", "Claude Code", "release", "handover"]);
  // Kind and host take their colour from a stable key, not from the translated text.
  expect(
    byType(row, HuePill)
      .slice(0, 2)
      .map((node) => node.props.colourKey)
  ).toEqual(["memorisation-snapshot", "claude-code"]);
});

it("tells the user how to memorise when the project has none", async () => {
  rows = [];
  const tree = await settle(page, own);
  expect(allText(tree)).toContain("No memorisations yet");
  expect(allText(tree)).toContain('om-memory-system memory memorise "your note"');
  expect(byType(tree, "ul")).toHaveLength(0);
});

it("shows a failure to load without a list", async () => {
  installFetch(async () => ({ status: 500, body: { success: false, error: "boom" } }));
  const tree = await settle(page, own);
  expect(allText(tree)).toContain("Could not load the memorisations");
});

const textBox = (tree: Node[], id: string) =>
  tree.find((node) => node.props["aria-label"] === `Stored text of ${id}`)!;
const htmlOf = (node: Node) => (node.props.dangerouslySetInnerHTML as { __html: string }).__html;
const openRow = async (title: string) => {
  const tree = await settle(page, own);
  buttonOf(rowOf(tree, title), "Show full text").props.onClick();
  return settle(page, own);
};

it("opens a row to show the full stored text", async () => {
  let tree = await settle(page, own);
  const row = rowOf(tree, "release");
  expect(textBox(tree, "ms-aaaaaa")).toBeUndefined();
  const open = buttonOf(row, "Show full text");
  expect(open.props["aria-expanded"]).toBe(false);
  open.props.onClick();
  tree = await settle(page, own);
  const box = textBox(tree, "ms-aaaaaa");
  expect(box.type).toBe("div");
  expect(box.props.className).toContain("markdown-content");
  expect(box.props.dir).toBe("auto");
  expect(box.props.className).toContain("max-h-96");
  // A snapshot saved before the change keeps each line on its own line.
  expect(htmlOf(box)).toContain("Topic: release<br>Done: tagged<br>Next: publish");
  expect(byType(tree, "pre")).toHaveLength(0);
  expect(buttonOf(rowOf(tree, "release"), "Hide full text").props["aria-expanded"]).toBe(true);
});

it("renders a structured note as Markdown: a heading and list items", async () => {
  rows = [
    {
      ...rows[0]!,
      content: "omms release\n\n## Done\n- tagged\n- pushed\n\n## Next\npublish",
    },
  ];
  const tree = await openRow("omms release");
  const html = htmlOf(textBox(tree, "ms-aaaaaa"));
  expect(html).toContain("<h2>Done</h2>");
  expect(html).toContain("<h2>Next</h2>");
  expect(html.match(/<li>/g)).toHaveLength(2);
  expect(html).toContain("<li>tagged</li>");
});

it("passes the note through the sanitiser and shows no script element", async () => {
  rows = [{ ...rows[0]!, content: "plan\n\n<script>alert(1)</script>\n\nthen ship" }];
  sanitised.length = 0;
  const tree = await openRow("plan");
  expect(sanitised.some((html) => html.includes("<script>"))).toBe(true);
  expect(htmlOf(textBox(tree, "ms-aaaaaa"))).not.toContain("<script");
});

it("recalls by ID and shows only that record", async () => {
  const tree = await submitSearch("ms-aaaaaa");
  expect(requests.at(-1)!.path).toBe("/api/memorisations/recall?q=ms-aaaaaa");
  expect(allText(tree)).toContain("Results for ms-aaaaaa");
  const result = byType(tree, "ul").find(
    (node) => node.props["aria-label"] === "Results for ms-aaaaaa"
  )!;
  expect(
    byType(tree, "li").filter((li) => text(li.props.children).includes("ms-aaaaaa"))
  ).not.toHaveLength(0);
  expect(result).toBeDefined();
});

it("recalls by text and shows a confidence score on each match", async () => {
  const tree = await submitSearch("release notes");
  expect(requests.at(-1)!.path).toBe("/api/memorisations/recall?q=release%20notes");
  const labels = byType(tree, HuePill).map((node) => node.props.label);
  expect(labels).toContain("Confidence 90%");
  expect(labels).toContain("Confidence 70%");
  // The list knows each record's host, so a match shows it too.
  expect(labels).toContain("Pi");
});

it("says when nothing matched, and when an ID does not exist", async () => {
  recallReply = { body: { success: true, data: { count: 0, matches: [] } } };
  expect(allText(await submitSearch("nothing here"))).toContain("No memorisation matched");

  resetRender();
  recallReply = {
    status: 404,
    body: { success: false, error: "No memorisation has the ID ms-zzzzzz" },
  };
  const unknown = await submitSearch("ms-zzzzzz");
  expect(allText(unknown)).toContain("No memorisation has the ID ms-zzzzzz.");
  // A failed search that is not a missing ID gets the general message.
  resetRender();
  recallReply = { status: 500, body: { success: false, error: "boom" } };
  expect(allText(await submitSearch("release"))).toContain("The search did not run.");
});

it("clears the search results", async () => {
  const tree = await submitSearch("release notes");
  expect(allText(tree)).toContain("Results for release notes");
  buttonOf(tree, "Clear search").props.onClick();
  expect(allText(await settle(page, own))).not.toContain("Results for release notes");
});

it("copies the ID and says so, or says the browser refused", async () => {
  let tree = await settle(page, own);
  buttonOf(rowOf(tree, "release"), "Copy ID").props.onClick();
  tree = await settle(page, own);
  expect(clipboard).toEqual(["ms-aaaaaa"]);
  expect(allText(rowOf(tree, "release"))).toContain("Copied ms-aaaaaa to the clipboard.");

  clipboardRefuses = true;
  buttonOf(rowOf(tree, "use port 4747 only for the real app"), "Copy ID").props.onClick();
  tree = await settle(page, own);
  expect(allText(tree)).toContain("The browser did not allow copying.");
});

it("asks before deleting, and deletes only after the confirmation", async () => {
  let tree = await settle(page, own);
  buttonOf(rowOf(tree, "release"), "Delete").props.onClick();
  tree = await settle(page, own);
  expect(text(byType(tree, DialogTitle)[0]!.props.children)).toBe("Delete ms-aaaaaa?");
  expect(changes()).toEqual([]);

  // Cancel closes the dialog and sends nothing.
  const dialog = tree.slice(tree.findIndex((node) => node.type === DialogTitle));
  buttonOf(dialog, "Cancel").props.onClick();
  tree = await settle(page, own);
  expect(byType(tree, DialogTitle)).toHaveLength(0);
  expect(changes()).toEqual([]);

  buttonOf(rowOf(tree, "release"), "Delete").props.onClick();
  tree = await settle(page, own);
  const open = tree.slice(tree.findIndex((node) => node.type === DialogTitle));
  buttonOf(open, "Delete").props.onClick();
  tree = await settle(page, own);
  expect(changes()).toEqual([
    { method: "DELETE", path: "/api/memories/ms-aaaaaa", body: undefined },
  ]);
  expect(titles(tree)).not.toContain("release");
  expect(allText(tree)).toContain("Deleted ms-aaaaaa.");
  expect(byType(tree, DialogTitle)).toHaveLength(0);
});

it("keeps the dialog open and says so when the delete fails", async () => {
  deleteFails = true;
  let tree = await settle(page, own);
  buttonOf(rowOf(tree, "release"), "Delete").props.onClick();
  tree = await settle(page, own);
  buttonOf(
    tree.slice(tree.findIndex((node) => node.type === DialogTitle)),
    "Delete"
  ).props.onClick();
  tree = await settle(page, own);
  expect(allText(tree)).toContain("Could not delete ms-aaaaaa. Try again.");
  expect(byType(tree, DialogTitle)).toHaveLength(1);
  expect(titles(tree)).toContain("release");
});

it("keeps Delete off for a record in a linked read-only space and says why", async () => {
  rows = [{ ...rows[0]!, space: "Beta" }];
  const tree = await settle(page, own);
  const row = rowOf(tree, "release");
  expect(buttonOf(row, "Delete").props.disabled).toBe(true);
  expect(buttonOf(row, "Delete").props["aria-describedby"]).toBe("memorisation-linked-ms-aaaaaa");
  expect(allText(row)).toContain("linked space Beta, which is read-only");
  expect(byType(row, HuePill).map((node) => node.props.label)).toContain("In Beta");
});

it("saves the repeat choice through the settings route", async () => {
  let tree = await settle(page, own);
  expect(radioOf(tree, "Add a new memorisation").props["aria-checked"]).toBe(true);
  radioOf(tree, "Replace the earlier one").props.onClick();
  tree = await confirmDialog();
  expect(changes()).toEqual([
    {
      method: "PATCH",
      path: "/api/settings",
      body: { edits: { memorisationRepeat: "replace" }, revision: "r1" },
    },
  ]);
  expect(allText(tree)).toContain("Saved. The next snapshot follows this choice.");
  // The choice stays after a reload.
  resetRender();
  tree = await settle(page, own);
  expect(radioOf(tree, "Replace the earlier one").props["aria-checked"]).toBe(true);
});

const rerankSwitch = (tree: Node[]) =>
  tree.find((node) => node.props.role === "switch" && node.props.id === "memorisation-rerank")!;
const rerankReadySettings = () => {
  settings.rerankerApiUrl = {
    value: "http://127.0.0.1:3008/v1",
    globalValue: "http://127.0.0.1:3008/v1",
  };
  settings.rerankerModel = { value: "Qwen3-Reranker-0.6B", globalValue: "Qwen3-Reranker-0.6B" };
};

it("saves the rerank switch through the settings route and keeps it on after a reload", async () => {
  rerankReadySettings();
  let tree = await settle(page, own);
  const box = rerankSwitch(tree);
  expect(box.props.checked).toBe(false);
  expect(box.props.disabled).toBeFalsy();
  expect(allText(tree)).toContain("Rerank text recall (experimental)");
  box.props.onCheckedChange(true);
  tree = await confirmDialog();
  expect(changes()).toEqual([
    {
      method: "PATCH",
      path: "/api/settings",
      body: { edits: { memorisationRerank: true }, revision: "r1" },
    },
  ]);
  expect(allText(tree)).toContain("Saved. The next text recall follows this choice.");
  // The on state survives a reload.
  resetRender();
  tree = await settle(page, own);
  expect(rerankSwitch(tree).props.checked).toBe(true);
});

it("returns the rerank switch to its earlier position and shows the server's reason", async () => {
  rerankReadySettings();
  rerankSaveFails = "Invalid memorisationRerank setting";
  let tree = await settle(page, own);
  rerankSwitch(tree).props.onCheckedChange(true);
  tree = await confirmDialog();
  expect(rerankSwitch(tree).props.checked).toBe(false);
  expect(allText(tree)).toContain("Invalid memorisationRerank setting");
});

it("keeps the rerank switch disabled, with the reason, until a reranker server is set", async () => {
  const tree = await settle(page, own);
  const box = rerankSwitch(tree);
  expect(box.props.disabled).toBe(true);
  expect(box.props["aria-describedby"]).toBe("memorisation-rerank-reason");
  const reason = tree.find((node) => node.props.id === "memorisation-rerank-reason")!;
  expect(text(reason.props.children)).toContain("reranker server");
  const tips = byType(tree, Tooltip).map((node) => text(node.props.content));
  expect(tips.join(" ")).toContain("reranker server");
});

it("saves a token cap as a pair", async () => {
  let tree = await settle(page, own);
  expect(inputOf(tree, "memorisation-size").props.value).toBe("2000");
  typeInto(inputOf(tree, "memorisation-size"), "500");
  radioOf(tree, "Tokens").props.onClick();
  tree = await settle(page, own);
  byType(tree, "form")
    .at(-1)!
    .props.onSubmit({ preventDefault() {} });
  tree = await confirmDialog();
  expect(changes()).toEqual([
    {
      method: "PATCH",
      path: "/api/settings",
      body: { edits: { memorisationMaxSize: 500, memorisationSizeUnit: "tokens" }, revision: "r1" },
    },
  ]);
  expect(allText(tree)).toContain("Saved. The next memorisation uses this cap.");
  resetRender();
  tree = await settle(page, own);
  expect(inputOf(tree, "memorisation-size").props.value).toBe("500");
  expect(radioOf(tree, "Tokens").props["aria-checked"]).toBe(true);
});

it("shows the range and saves nothing for a value that is too small", async () => {
  let tree = await settle(page, own);
  typeInto(inputOf(tree, "memorisation-size"), "10");
  tree = await settle(page, own);
  byType(tree, "form")
    .at(-1)!
    .props.onSubmit({ preventDefault() {} });
  tree = await settle(page, own);
  expect(changes()).toEqual([]);
  expect(confirmOf(tree)).toBeUndefined();
  expect(allText(tree)).toContain("Enter a whole number from 100 to 20,000 characters.");

  // Tokens use their own range.
  radioOf(tree, "Tokens").props.onClick();
  typeInto(inputOf(await settle(page, own), "memorisation-size"), "6000");
  byType(await settle(page, own), "form")
    .at(-1)!
    .props.onSubmit({ preventDefault() {} });
  const tokenTree = await settle(page, own);
  expect(allText(tokenTree)).toContain("Enter a whole number from 25 to 5,000 tokens.");
  expect(confirmOf(tokenTree)).toBeUndefined();
  expect(changes()).toEqual([]);
});

it("shows the range when the server refuses a value", async () => {
  refuseSizeBelow = 150;
  let tree = await settle(page, own);
  typeInto(inputOf(tree, "memorisation-size"), "120");
  tree = await settle(page, own);
  byType(tree, "form")
    .at(-1)!
    .props.onSubmit({ preventDefault() {} });
  tree = await confirmDialog();
  expect(changes()).toHaveLength(1);
  expect(allText(tree)).toContain("Enter a whole number from 100 to 20,000 characters.");
  // The typed value stays so the user can correct it.
  expect(inputOf(tree, "memorisation-size").props.value).toBe("120");
});

// ---- Note length presets ----

const sizeBox = (tree: Node[]) => inputOf(tree, "memorisation-size").props.value;
const checked = (tree: Node[], label: string) => radioOf(tree, label).props["aria-checked"];
const sizeForm = (tree: Node[]) => byType(tree, "form").at(-1)!;

it("shows each preset with its value in the unit, and selects the one the cap matches", async () => {
  const tree = await settle(page, own);
  expect(allText(tree.filter(isRadio))).toContain("Short · 800");
  expect(checked(tree, "Short · 800")).toBe(false);
  expect(checked(tree, "Medium · 2000")).toBe(true);
  expect(checked(tree, "Long · 5000")).toBe(false);
  expect(checked(tree, "Custom")).toBe(false);
});

it("fills the box when a preset is chosen, and saves only the cap and unit", async () => {
  let tree = await settle(page, own);
  radioOf(tree, "Short").props.onClick();
  tree = await settle(page, own);
  expect(sizeBox(tree)).toBe("800");
  expect(checked(tree, "Short")).toBe(true);
  expect(changes()).toEqual([]);
  sizeForm(tree).props.onSubmit({ preventDefault() {} });
  await confirmDialog();
  expect(changes()).toEqual([
    {
      method: "PATCH",
      path: "/api/settings",
      body: {
        edits: { memorisationMaxSize: 800, memorisationSizeUnit: "characters" },
        revision: "r1",
      },
    },
  ]);
});

it("selects Custom when a typed number matches no preset", async () => {
  let tree = await settle(page, own);
  typeInto(inputOf(tree, "memorisation-size"), "3000");
  tree = await settle(page, own);
  expect(checked(tree, "Custom")).toBe(true);
  expect(checked(tree, "Medium")).toBe(false);
  typeInto(inputOf(tree, "memorisation-size"), "800");
  tree = await settle(page, own);
  expect(checked(tree, "Short")).toBe(true);
});

it("opens a saved 500 tokens as Medium and Tokens", async () => {
  settings.memorisationMaxSize = { value: 500, globalValue: 500 };
  settings.memorisationSizeUnit = { value: "tokens", globalValue: "tokens" };
  const tree = await settle(page, own);
  expect(checked(tree, "Medium")).toBe(true);
  expect(checked(tree, "Tokens")).toBe(true);
  expect(sizeBox(tree)).toBe("500");
  expect(allText(tree)).toContain("Medium · 500");
});

it("refills the preset in the new unit, and keeps the number on Custom", async () => {
  settings.memorisationMaxSize = { value: 5000, globalValue: 5000 };
  let tree = await settle(page, own);
  expect(checked(tree, "Long")).toBe(true);
  radioOf(tree, "Tokens").props.onClick();
  tree = await settle(page, own);
  expect(sizeBox(tree)).toBe("1250");
  expect(checked(tree, "Long")).toBe(true);
  radioOf(tree, "Characters").props.onClick();
  tree = await settle(page, own);
  expect(sizeBox(tree)).toBe("5000");
  // Custom keeps the typed number.
  typeInto(inputOf(tree, "memorisation-size"), "3000");
  radioOf(await settle(page, own), "Tokens").props.onClick();
  tree = await settle(page, own);
  expect(sizeBox(tree)).toBe("3000");
  expect(checked(tree, "Custom")).toBe(true);
});

it("uses the presets of the settings snapshot", async () => {
  settings.memorisationShortSize = { value: 1000, globalValue: 1000 };
  let tree = await settle(page, own);
  expect(allText(tree)).toContain("Short · 1000");
  radioOf(tree, "Short").props.onClick();
  radioOf(await settle(page, own), "Tokens").props.onClick();
  tree = await settle(page, own);
  expect(sizeBox(tree)).toBe("250");
  expect(allText(tree)).toContain("Short · 250");
});

// ---- The preset editor ----

const presetBox = (tree: Node[], name: string) => inputOf(tree, `memorisation-preset-${name}`);
const openEditor = async () => {
  const tree = await settle(page, own);
  buttonOf(tree, "Edit presets").props.onClick();
  return settle(page, own);
};
const press = async (label: string) => {
  buttonOf(await settle(page, own), label).props.onClick();
  return settle(page, own);
};
/** Save presets with values that pass the checks: press it, then confirm the dialog. */
const savePresets = async () => {
  await press("Save presets");
  return confirmDialog();
};

it("opens the three preset boxes with a token estimate beside each", async () => {
  let tree = await settle(page, own);
  expect(tree.find((node) => node.props.id === "memorisation-preset-short")).toBeUndefined();
  tree = await openEditor();
  expect(["short", "medium", "long"].map((name) => presetBox(tree, name).props.value)).toEqual([
    "800",
    "2000",
    "5000",
  ]);
  expect(allText(tree)).toContain("about 200 tokens");
  expect(allText(tree)).toContain("about 500 tokens");
  expect(allText(tree)).toContain("about 1250 tokens");
  typeInto(presetBox(tree, "short"), "1000");
  tree = await settle(page, own);
  expect(allText(tree)).toContain("about 250 tokens");
  expect(changes()).toEqual([]);
});

it("saves an edited selected preset together with the cap, so it stays selected", async () => {
  settings.memorisationMaxSize = { value: 800, globalValue: 800 };
  let tree = await openEditor();
  expect(checked(tree, "Short")).toBe(true);
  typeInto(presetBox(tree, "short"), "1000");
  tree = await savePresets();
  expect(changes()).toEqual([
    {
      method: "PATCH",
      path: "/api/settings",
      body: {
        edits: {
          memorisationShortSize: 1000,
          memorisationMediumSize: 2000,
          memorisationLongSize: 5000,
          memorisationMaxSize: 1000,
        },
        revision: "r1",
      },
    },
  ]);
  expect(tree.find((node) => node.props.id === "memorisation-preset-short")).toBeUndefined();
  expect(checked(tree, "Short · 1000")).toBe(true);
  expect(sizeBox(tree)).toBe("1000");
});

it("writes the cap in the saved unit when the selected preset changes", async () => {
  settings.memorisationMaxSize = { value: 500, globalValue: 500 };
  settings.memorisationSizeUnit = { value: "tokens", globalValue: "tokens" };
  let tree = await openEditor();
  typeInto(presetBox(tree, "medium"), "2400");
  tree = await savePresets();
  expect(changes()[0]!.body.edits).toMatchObject({
    memorisationMediumSize: 2400,
    memorisationMaxSize: 600,
  });
  expect(checked(tree, "Medium")).toBe(true);
});

it("leaves the cap alone when another preset is saved", async () => {
  let tree = await openEditor();
  typeInto(presetBox(tree, "long"), "8000");
  tree = await savePresets();
  expect(changes()).toHaveLength(1);
  expect(changes()[0]!.body.edits).toEqual({
    memorisationShortSize: 800,
    memorisationMediumSize: 2000,
    memorisationLongSize: 8000,
  });
  expect(allText(tree)).toContain("Long · 8000");
  expect(checked(tree, "Medium")).toBe(true);
  expect(sizeBox(tree)).toBe("2000");
});

it("refuses presets that share one token value and sends nothing", async () => {
  let tree = await openEditor();
  typeInto(presetBox(tree, "short"), "1997");
  tree = await press("Save presets");
  expect(allText(tree)).toContain(
    "Short and Medium must differ by at least one token. Both are about 500 tokens."
  );
  expect(changes()).toEqual([]);
  expect(confirmOf(tree)).toBeUndefined();
});

it("shows the broken rule and sends nothing for out-of-order or out-of-range values", async () => {
  let tree = await openEditor();
  typeInto(presetBox(tree, "short"), "2500");
  tree = await press("Save presets");
  expect(allText(tree)).toContain("Short must be less than Medium");
  expect(changes()).toEqual([]);
  expect(confirmOf(tree)).toBeUndefined();
  expect(tree.find((node) => node.props.id === "memorisation-preset-short")).toBeDefined();
  typeInto(presetBox(tree, "short"), "50");
  tree = await press("Save presets");
  expect(allText(tree)).toContain("Short must be a whole number from 100 to 20,000 characters.");
  expect(allText(tree)).not.toContain("must be less than");
  expect(changes()).toEqual([]);
  expect(confirmOf(tree)).toBeUndefined();
});

it("fills the defaults on Reset presets without a request, and saves them on Save", async () => {
  settings.memorisationShortSize = { value: 1000, globalValue: 1000 };
  settings.memorisationMaxSize = { value: 1000, globalValue: 1000 };
  let tree = await openEditor();
  expect(presetBox(tree, "short").props.value).toBe("1000");
  tree = await press("Reset presets");
  expect(["short", "medium", "long"].map((name) => presetBox(tree, name).props.value)).toEqual([
    "800",
    "2000",
    "5000",
  ]);
  expect(changes()).toEqual([]);
  tree = await savePresets();
  expect(changes()[0]!.body.edits).toEqual({
    memorisationShortSize: 800,
    memorisationMediumSize: 2000,
    memorisationLongSize: 5000,
    memorisationMaxSize: 800,
  });
});

it("closes the boxes on Cancel without a request, and reopens with the saved values", async () => {
  let tree = await openEditor();
  typeInto(presetBox(tree, "short"), "1000");
  tree = await press("Cancel");
  expect(tree.find((node) => node.props.id === "memorisation-preset-short")).toBeUndefined();
  expect(changes()).toEqual([]);
  tree = await openEditor();
  expect(presetBox(tree, "short").props.value).toBe("800");
});

it("moves the cap to an edited preset that the unsaved box matched", async () => {
  let tree = await openEditor();
  radioOf(tree, "Short").props.onClick();
  tree = await settle(page, own);
  expect(sizeBox(tree)).toBe("800");
  typeInto(presetBox(tree, "short"), "1000");
  tree = await savePresets();
  // The saved cap is Medium and did not change, so only the presets go out.
  expect(changes()[0]!.body.edits).toEqual({
    memorisationShortSize: 1000,
    memorisationMediumSize: 2000,
    memorisationLongSize: 5000,
  });
  expect(sizeBox(tree)).toBe("1000");
  expect(checked(tree, "Short · 1000")).toBe(true);
  expect(checked(tree, "Custom")).toBe(false);
  // Nothing saves the cap until the user presses Save.
  expect(changes()).toHaveLength(1);
});

it("follows an edited preset in the box unit when the unit is unsaved", async () => {
  let tree = await openEditor();
  radioOf(tree, "Tokens").props.onClick();
  tree = await settle(page, own);
  expect(sizeBox(tree)).toBe("500");
  typeInto(presetBox(tree, "medium"), "2400");
  tree = await savePresets();
  // The saved cap follows in the saved unit; the box follows in the box unit.
  expect(changes()[0]!.body.edits).toMatchObject({
    memorisationMediumSize: 2400,
    memorisationMaxSize: 2400,
  });
  expect(sizeBox(tree)).toBe("600");
  expect(checked(tree, "Medium")).toBe(true);
});

it("keeps a custom number in the box when presets change", async () => {
  let tree = await settle(page, own);
  typeInto(inputOf(tree, "memorisation-size"), "3000");
  tree = await settle(page, own);
  buttonOf(tree, "Edit presets").props.onClick();
  tree = await settle(page, own);
  typeInto(presetBox(tree, "short"), "1000");
  tree = await savePresets();
  expect(sizeBox(tree)).toBe("3000");
  expect(checked(tree, "Custom")).toBe(true);
});

it("leaves the box alone when the preset it matched did not change", async () => {
  let tree = await openEditor();
  radioOf(tree, "Short").props.onClick();
  tree = await settle(page, own);
  typeInto(presetBox(tree, "long"), "8000");
  tree = await savePresets();
  expect(sizeBox(tree)).toBe("800");
  expect(checked(tree, "Short")).toBe(true);
});

// ---- Every settings save asks first ----

const patches = () => changes().filter((request) => request.path === "/api/settings");
const dialogText = (tree: Node[]) => {
  const dialog = confirmOf(tree)!;
  return { title: text(dialog.props.title), body: text(dialog.props.body), dialog };
};
const submitSize = async (value: string) => {
  let tree = await settle(page, own);
  typeInto(inputOf(tree, "memorisation-size"), value);
  tree = await settle(page, own);
  sizeForm(tree).props.onSubmit({ preventDefault() {} });
  return settle(page, own);
};

it("asks before saving the size cap, and sends nothing until the user confirms", async () => {
  const tree = await submitSize("1000");
  expect(patches()).toEqual([]);
  const { title, body, dialog } = dialogText(tree);
  expect(title).toBe("Change the size cap?");
  expect(body).toBe(
    "New memorisations above 1,000 characters will be refused. Records you already saved stay as they are."
  );
  expect(dialog.props.confirmLabel).toBe("Save size cap");
  expect(dialog.props.busyLabel).toBe("Saving the size cap…");
  expect(await dialog.props.onConfirm()).toEqual({ success: true });
  expect(patches()).toEqual([
    {
      method: "PATCH",
      path: "/api/settings",
      body: {
        edits: { memorisationMaxSize: 1000, memorisationSizeUnit: "characters" },
        revision: "r1",
      },
    },
  ]);
});

it("states the size cap in tokens when the unit is Tokens", async () => {
  let tree = await settle(page, own);
  radioOf(tree, "Tokens").props.onClick();
  tree = await settle(page, own);
  typeInto(inputOf(tree, "memorisation-size"), "1500");
  tree = await settle(page, own);
  sizeForm(tree).props.onSubmit({ preventDefault() {} });
  tree = await settle(page, own);
  expect(dialogText(tree).body).toContain("above 1,500 tokens will be refused");
});

it("keeps the saved size cap and sends nothing when the size cap dialog is cancelled", async () => {
  let tree = await submitSize("1000");
  confirmOf(tree)!.props.onClose();
  tree = await settle(page, own);
  expect(confirmOf(tree)).toBeUndefined();
  expect(patches()).toEqual([]);
  expect((settings.memorisationMaxSize as { globalValue: number }).globalValue).toBe(2000);
  // The typed number stays, so the user can save it later.
  expect(sizeBox(tree)).toBe("1000");
});

it("keeps the size cap dialog open and gives the server's refusal inside it", async () => {
  refuseSizeBelow = 150;
  let tree = await submitSize("120");
  const result = await confirmOf(tree)!.props.onConfirm();
  expect(result.success).toBe(false);
  expect(result.error).toBe("Enter a whole number from 100 to 20,000 characters.");
  tree = await settle(page, own);
  expect(confirmOf(tree)).toBeDefined();
  settingsSaveFails = "Disk is full";
  refuseSizeBelow = 0;
  const failed = await confirmOf(tree)!.props.onConfirm();
  expect(failed).toEqual({ success: false, error: "Disk is full" });
});

it("asks before saving the repeat choice, and says what the choice does", async () => {
  let tree = await settle(page, own);
  radioOf(tree, "Replace the earlier one").props.onClick();
  tree = await settle(page, own);
  expect(patches()).toEqual([]);
  const { title, body, dialog } = dialogText(tree);
  expect(title).toBe("Change the repeat choice?");
  expect(body).toBe(
    "When an agent memorises the same session again, the new snapshot replaces the earlier one and keeps its ID."
  );
  expect(dialog.props.confirmLabel).toBe("Save choice");
  expect(await dialog.props.onConfirm()).toEqual({ success: true });
  expect(patches()).toHaveLength(1);
  expect(patches()[0]!.body.edits).toEqual({ memorisationRepeat: "replace" });
});

it("says the repeat choice adds a new memorisation when Add is chosen", async () => {
  settings.memorisationRepeat = { value: "replace", globalValue: "replace" };
  let tree = await settle(page, own);
  radioOf(tree, "Add a new memorisation").props.onClick();
  tree = await settle(page, own);
  expect(dialogText(tree).body).toBe(
    "When an agent memorises the same session again, a new memorisation is added. Earlier snapshots stay."
  );
});

it("leaves the saved repeat choice selected when its dialog is cancelled", async () => {
  let tree = await settle(page, own);
  radioOf(tree, "Replace the earlier one").props.onClick();
  tree = await settle(page, own);
  confirmOf(tree)!.props.onClose();
  tree = await settle(page, own);
  expect(confirmOf(tree)).toBeUndefined();
  expect(patches()).toEqual([]);
  expect(radioOf(tree, "Add a new memorisation").props["aria-checked"]).toBe(true);
  expect(radioOf(tree, "Replace the earlier one").props["aria-checked"]).toBe(false);
});

it("keeps the repeat dialog open and gives the server's reason inside it", async () => {
  settingsSaveFails = "Invalid memorisationRepeat setting";
  let tree = await settle(page, own);
  radioOf(tree, "Replace the earlier one").props.onClick();
  tree = await settle(page, own);
  const result = await confirmOf(tree)!.props.onConfirm();
  expect(result).toEqual({ success: false, error: "Invalid memorisationRepeat setting" });
  tree = await settle(page, own);
  expect(confirmOf(tree)).toBeDefined();
  expect(radioOf(tree, "Add a new memorisation").props["aria-checked"]).toBe(true);
});

it("asks before turning reranking on or off", async () => {
  rerankReadySettings();
  let tree = await settle(page, own);
  rerankSwitch(tree).props.onCheckedChange(true);
  tree = await settle(page, own);
  expect(patches()).toEqual([]);
  let shown = dialogText(tree);
  expect(shown.title).toBe("Turn on reranking?");
  expect(shown.body).toBe(
    "The reranker server will reorder the matches of a text recall. This setting is experimental."
  );
  expect(shown.dialog.props.confirmLabel).toBe("Turn on");
  expect(await shown.dialog.props.onConfirm()).toEqual({ success: true });
  shown.dialog.props.onClose();
  tree = await settle(page, own);
  expect(patches()[0]!.body.edits).toEqual({ memorisationRerank: true });

  rerankSwitch(tree).props.onCheckedChange(false);
  tree = await settle(page, own);
  shown = dialogText(tree);
  expect(shown.title).toBe("Turn off reranking?");
  expect(shown.body).toBe(
    "A text recall will keep its own order and no longer call the reranker server."
  );
  expect(shown.dialog.props.confirmLabel).toBe("Turn off");
  expect(patches()).toHaveLength(1);
});

it("leaves the rerank switch as saved when its dialog is cancelled", async () => {
  rerankReadySettings();
  let tree = await settle(page, own);
  rerankSwitch(tree).props.onCheckedChange(true);
  tree = await settle(page, own);
  confirmOf(tree)!.props.onClose();
  tree = await settle(page, own);
  expect(confirmOf(tree)).toBeUndefined();
  expect(patches()).toEqual([]);
  expect(rerankSwitch(tree).props.checked).toBe(false);
});

it("keeps the rerank dialog open and gives the server's reason inside it", async () => {
  rerankReadySettings();
  rerankSaveFails = "Invalid memorisationRerank setting";
  let tree = await settle(page, own);
  rerankSwitch(tree).props.onCheckedChange(true);
  tree = await settle(page, own);
  const result = await confirmOf(tree)!.props.onConfirm();
  expect(result).toEqual({ success: false, error: "Invalid memorisationRerank setting" });
  tree = await settle(page, own);
  expect(confirmOf(tree)).toBeDefined();
});

it("asks before saving the presets, lists the three values, and says the cap moves too", async () => {
  settings.memorisationMaxSize = { value: 800, globalValue: 800 };
  let tree = await openEditor();
  typeInto(presetBox(tree, "short"), "1000");
  await press("Save presets");
  tree = await settle(page, own);
  expect(patches()).toEqual([]);
  const { title, body, dialog } = dialogText(tree);
  expect(title).toBe("Save the note length presets?");
  expect(body).toContain("Short: 1,000 characters");
  expect(body).toContain("Medium: 2,000 characters");
  expect(body).toContain("Long: 5,000 characters");
  expect(body).toContain(
    "The size cap also moves to 1,000 characters, because the selected preset (Short) changed."
  );
  expect(dialog.props.confirmLabel).toBe("Save presets");
  // The editor stays open until the save succeeds.
  expect(presetBox(tree, "short")).toBeDefined();
  expect(await dialog.props.onConfirm()).toEqual({ success: true });
  expect(patches()[0]!.body.edits).toEqual({
    memorisationShortSize: 1000,
    memorisationMediumSize: 2000,
    memorisationLongSize: 5000,
    memorisationMaxSize: 1000,
  });
  tree = await settle(page, own);
  expect(tree.find((node) => node.props.id === "memorisation-preset-short")).toBeUndefined();
});

it("does not mention the size cap in the preset dialog when the cap stays", async () => {
  let tree = await openEditor();
  typeInto(presetBox(tree, "long"), "8000");
  await press("Save presets");
  tree = await settle(page, own);
  const { body } = dialogText(tree);
  expect(body).toContain("Long: 8,000 characters");
  expect(body).not.toContain("size cap");
});

it("names the cap in tokens in the preset dialog when the saved unit is Tokens", async () => {
  settings.memorisationMaxSize = { value: 500, globalValue: 500 };
  settings.memorisationSizeUnit = { value: "tokens", globalValue: "tokens" };
  let tree = await openEditor();
  typeInto(presetBox(tree, "medium"), "2400");
  await press("Save presets");
  tree = await settle(page, own);
  expect(dialogText(tree).body).toContain(
    "The size cap also moves to 600 tokens, because the selected preset (Medium) changed."
  );
});

it("keeps the editor open with its values when the preset dialog is cancelled", async () => {
  let tree = await openEditor();
  typeInto(presetBox(tree, "short"), "1000");
  await press("Save presets");
  tree = await settle(page, own);
  confirmOf(tree)!.props.onClose();
  tree = await settle(page, own);
  expect(confirmOf(tree)).toBeUndefined();
  expect(patches()).toEqual([]);
  expect(presetBox(tree, "short").props.value).toBe("1000");
  expect(allText(tree)).toContain("Short · 800");
});

it("keeps the preset dialog and the editor open and gives the server's reason inside it", async () => {
  settingsSaveFails = "Presets could not be written";
  let tree = await openEditor();
  typeInto(presetBox(tree, "short"), "1000");
  await press("Save presets");
  tree = await settle(page, own);
  const result = await confirmOf(tree)!.props.onConfirm();
  expect(result).toEqual({ success: false, error: "Presets could not be written" });
  tree = await settle(page, own);
  expect(confirmOf(tree)).toBeDefined();
  expect(presetBox(tree, "short").props.value).toBe("1000");
});

it("shows the settings dialog texts in Chinese and Arabic", async () => {
  for (const [language, title] of [
    ["zh", "更改大小上限？"],
    ["ar", "تغيير الحد الأقصى للحجم؟"],
  ] as const) {
    setLanguage(language);
    resetRender();
    const tree = await submitSize("1000");
    const shown = dialogText(tree);
    expect(shown.title).toBe(title);
    expect(shown.title).not.toBe("Change the size cap?");
    expect(shown.body).not.toContain("will be refused");
    expect(shown.dialog.props.confirmLabel).not.toBe("Save size cap");
  }
  setLanguage("en");
});

// ---- Size cap radio groups ----

const within = (node: ReactNode): Node[] =>
  Array.isArray(node)
    ? node.flatMap(within)
    : isValidElement(node)
      ? [node as Node, ...within((node as Node).props.children)]
      : [];
const groupOf = (tree: Node[], label: string) =>
  tree.find((node) => node.props.role === "radiogroup" && node.props["aria-label"] === label)!;
const radiosOf = (tree: Node[], label: string) =>
  within(groupOf(tree, label).props.children).filter(isRadio);
/** Gives each radio a stand-in element, as React does for a ref, and records focus moves. */
function attach(radios: Node[]) {
  const focused: number[] = [];
  const elements = radios.map((radio, index) => {
    const element = { focus: () => focused.push(index) };
    radio.props.ref(element);
    return element;
  });
  return { focused, elements };
}
const arrow = (tree: Node[], group: string, key: string, from: unknown) => {
  const event = { key, target: from, currentTarget: {}, preventDefault: mock(() => {}) };
  groupOf(tree, group).props.onKeyDown(event);
  return event;
};
let direction = "ltr";
Object.assign(globalThis, { getComputedStyle: () => ({ direction }) });

it("gives the chosen radio the only tab stop in each group", async () => {
  let tree = await settle(page, own);
  expect(radiosOf(tree, "Note length").map((radio) => radio.props.tabIndex)).toEqual([
    -1, 0, -1, -1,
  ]);
  expect(radiosOf(tree, "Unit").map((radio) => radio.props.tabIndex)).toEqual([0, -1]);
  typeInto(inputOf(tree, "memorisation-size"), "3000");
  tree = await settle(page, own);
  expect(radiosOf(tree, "Note length").map((radio) => radio.props.tabIndex)).toEqual([
    -1, -1, -1, 0,
  ]);
  radioOf(tree, "Tokens").props.onClick();
  tree = await settle(page, own);
  expect(radiosOf(tree, "Unit").map((radio) => radio.props.tabIndex)).toEqual([-1, 0]);
});

it("moves focus and the choice with the arrow keys in the preset group", async () => {
  direction = "ltr";
  let tree = await settle(page, own);
  let { focused, elements } = attach(radiosOf(tree, "Note length"));
  const event = arrow(tree, "Note length", "ArrowRight", elements[1]);
  expect(event.preventDefault).toHaveBeenCalled();
  expect(focused).toEqual([2]);
  tree = await settle(page, own);
  expect(sizeBox(tree)).toBe("5000");
  expect(checked(tree, "Long")).toBe(true);
  ({ focused, elements } = attach(radiosOf(tree, "Note length")));
  arrow(tree, "Note length", "ArrowLeft", elements[2]);
  arrow(tree, "Note length", "ArrowUp", elements[1]);
  expect(focused).toEqual([1, 0]);
  tree = await settle(page, own);
  expect(sizeBox(tree)).toBe("800");
  ({ focused, elements } = attach(radiosOf(tree, "Note length")));
  arrow(tree, "Note length", "ArrowLeft", elements[0]);
  expect(focused).toEqual([3]);
  expect(sizeBox(await settle(page, own))).toBe("800");
});

it("focuses Custom without changing the number, and leaves it from where focus is", async () => {
  direction = "ltr";
  let tree = await settle(page, own);
  radioOf(tree, "Long").props.onClick();
  tree = await settle(page, own);
  let { focused, elements } = attach(radiosOf(tree, "Note length"));
  arrow(tree, "Note length", "ArrowRight", elements[2]);
  expect(focused).toEqual([3]);
  tree = await settle(page, own);
  expect(sizeBox(tree)).toBe("5000");
  expect(checked(tree, "Long")).toBe(true);
  expect(changes()).toEqual([]);
  // Focus is on Custom now, so the next key starts there, not at the checked radio.
  ({ focused, elements } = attach(radiosOf(tree, "Note length")));
  arrow(tree, "Note length", "ArrowLeft", elements[3]);
  expect(focused).toEqual([2]);
  ({ focused, elements } = attach(radiosOf(await settle(page, own), "Note length")));
  arrow(tree, "Note length", "ArrowRight", elements[3]);
  expect(focused).toEqual([0]);
  expect(sizeBox(await settle(page, own))).toBe("800");
});

it("flips Left and Right in a right-to-left row, and ignores other keys", async () => {
  direction = "rtl";
  let tree = await settle(page, own);
  let { focused, elements } = attach(radiosOf(tree, "Note length"));
  arrow(tree, "Note length", "ArrowLeft", elements[1]);
  expect(focused).toEqual([2]);
  tree = await settle(page, own);
  ({ focused, elements } = attach(radiosOf(tree, "Note length")));
  arrow(tree, "Note length", "ArrowRight", elements[2]);
  arrow(tree, "Note length", "ArrowDown", elements[1]);
  expect(focused).toEqual([1, 2]);
  const other = arrow(tree, "Note length", "a", elements[2]);
  expect(other.preventDefault).not.toHaveBeenCalled();
  expect(focused).toEqual([1, 2]);
  direction = "ltr";
});

it("moves focus and the unit with the arrow keys in the unit group", async () => {
  direction = "ltr";
  let tree = await settle(page, own);
  let { focused, elements } = attach(radiosOf(tree, "Unit"));
  const event = arrow(tree, "Unit", "ArrowRight", elements[0]);
  expect(event.preventDefault).toHaveBeenCalled();
  expect(focused).toEqual([1]);
  tree = await settle(page, own);
  expect(checked(tree, "Tokens")).toBe(true);
  expect(sizeBox(tree)).toBe("500");
  ({ focused, elements } = attach(radiosOf(tree, "Unit")));
  arrow(tree, "Unit", "ArrowRight", elements[1]);
  expect(focused).toEqual([0]);
  tree = await settle(page, own);
  expect(checked(tree, "Characters")).toBe(true);
  expect(sizeBox(tree)).toBe("2000");
});

it("builds the preset and unit choices from the shared Button", async () => {
  const tree = await settle(page, own);
  const radios = [...radiosOf(tree, "Note length"), ...radiosOf(tree, "Unit")];
  expect(radios).toHaveLength(6);
  for (const radio of radios) {
    expect(radio.type).toBe(Button);
    expect(radio.props.type).toBe("button");
  }
  for (const label of ["Note length", "Unit"]) {
    const raw = within(groupOf(tree, label).props.children).filter(
      (node) => node.type === "button"
    );
    expect(raw).toEqual([]);
  }
});

// ---- Preset editor: invalid fields ----

const invalid = (tree: Node[]) =>
  ["short", "medium", "long"].filter((name) => presetBox(tree, name).props["aria-invalid"]);
const alertOf = (tree: Node[]) => tree.find((node) => node.props.role === "alert")!;

it("marks the one preset that is out of range and points it at the alert", async () => {
  let tree = await openEditor();
  expect(invalid(tree)).toEqual([]);
  typeInto(presetBox(tree, "medium"), "50");
  tree = await press("Save presets");
  expect(invalid(tree)).toEqual(["medium"]);
  const alert = alertOf(tree);
  expect(alert.props.id).toBeTruthy();
  expect(presetBox(tree, "medium").props["aria-describedby"]).toBe(alert.props.id);
  expect(presetBox(tree, "short").props["aria-describedby"]).toBeUndefined();
  // Typing clears the problem, the mark and the pointer.
  typeInto(presetBox(tree, "medium"), "2000");
  tree = await settle(page, own);
  expect(invalid(tree)).toEqual([]);
  expect(presetBox(tree, "medium").props["aria-describedby"]).toBeUndefined();
});

it("marks both presets of an order or token problem", async () => {
  let tree = await openEditor();
  typeInto(presetBox(tree, "short"), "2500");
  tree = await press("Save presets");
  expect(allText(tree)).toContain("Short must be less than Medium");
  expect(invalid(tree)).toEqual(["short", "medium"]);
  for (const name of ["short", "medium"]) {
    expect(presetBox(tree, name).props["aria-describedby"]).toBe(alertOf(tree).props.id);
  }
  typeInto(presetBox(tree, "short"), "1997");
  tree = await press("Save presets");
  expect(allText(tree)).toContain("must differ by at least one token");
  expect(invalid(tree)).toEqual(["short", "medium"]);
  expect(presetBox(tree, "long").props["aria-describedby"]).toBeUndefined();
});

it("shows the preset texts in Chinese and Arabic", async () => {
  for (const [language, word] of [
    ["zh", "短"],
    ["ar", "قصير"],
  ] as const) {
    setLanguage(language);
    resetRender();
    const tree = await settle(page, own);
    expect(allText(tree)).toContain(word);
    expect(allText(tree)).not.toContain("Edit presets");
  }
  setLanguage("en");
});

it("shows the page in Arabic", async () => {
  setLanguage("ar");
  const tree = await settle(page, own);
  expect(allText(tree)).toContain("العناصر المحفوظة");
  expect(allText(tree)).not.toContain("Saved memorisations");
  setLanguage("en");
});

// ---- Labels: pills, the active filter, the address bar and `label:` in the recall box ----

const listCalls = () =>
  requests
    .filter(
      (request) =>
        request.method === "GET" &&
        request.path.startsWith("/api/memorisations") &&
        !request.path.includes("recall") &&
        !request.path.includes("/labels")
    )
    .map((request) => request.path);
const labelButton = (nodes: Node[], label: string) =>
  nodes.find(
    (node) => node.type === "button" && node.props["aria-label"] === `Filter by label ${label}`
  )!;
const removeButton = (nodes: Node[], label: string) =>
  nodes.find((node) => node.props["aria-label"] === `Remove label ${label}`)!;
const chipRowLabels = (tree: Node[]) =>
  tree
    .filter((node) => String(node.props["aria-label"]).startsWith("Remove label "))
    .map((node) => String(node.props["aria-label"]).replace("Remove label ", ""));

it("shows each row's labels as coloured pills next to the kind and host pills", async () => {
  const tree = await settle(page, own);
  const row = rowOf(tree, "release");
  const pills = byType(row, HuePill).map((node) => node.props.label);
  expect(pills).toEqual(["Session snapshot", "Claude Code", "release", "handover"]);
  // A label takes its colour from its own text, so one label is one colour everywhere.
  expect(
    byType(row, HuePill)
      .slice(2)
      .map((node) => node.props.colourKey ?? node.props.label)
  ).toEqual(["release", "handover"]);
  expect(labelButton(row, "release")).toBeDefined();
});

it("adds a label to the filter when its pill is clicked, and asks the server for it", async () => {
  let tree = await settle(page, own);
  labelButton(rowOf(tree, "release"), "release").props.onClick();
  tree = await settle(page, own);
  expect(listCalls().at(-1)).toBe("/api/memorisations?tags=release");
  expect(
    titles(tree).filter((title) => title === "release" || title.startsWith("use port"))
  ).toEqual(["release"]);
  expect(chipRowLabels(tree)).toEqual(["release"]);
  expect(allText(tree)).toContain("Showing records that match every filter:");
});

it("shows an OR label as its alternatives joined by or, and asks the server for the bar", async () => {
  address = "/memorisation?labels=server%7Creactjs,api";
  const tree = await settle(page, own);
  expect(chipRowLabels(tree)).toEqual(["server or reactjs", "api"]);
  expect(listCalls().at(-1)).toBe("/api/memorisations?tags=server%7Creactjs,api");
});

it("shows a label pill as pressed once its label is in the filter", async () => {
  let tree = await settle(page, own);
  expect(labelButton(rowOf(tree, "release"), "release").props["aria-pressed"]).toBe(false);
  expect(labelButton(rowOf(tree, "release"), "handover").props["aria-pressed"]).toBe(false);
  labelButton(rowOf(tree, "release"), "release").props.onClick();
  tree = await settle(page, own);
  expect(labelButton(rowOf(tree, "release"), "release").props["aria-pressed"]).toBe(true);
  expect(labelButton(rowOf(tree, "release"), "handover").props["aria-pressed"]).toBe(false);
});

it("narrows the list further with a second label (all labels must match)", async () => {
  let tree = await settle(page, own);
  labelButton(rowOf(tree, "use port 4747 only for the real app"), "handover").props.onClick();
  tree = await settle(page, own);
  labelButton(rowOf(tree, "release"), "release").props.onClick();
  tree = await settle(page, own);
  expect(listCalls().at(-1)).toBe("/api/memorisations?tags=handover,release");
  expect(
    titles(tree).filter((title) => title === "release" || title.startsWith("use port"))
  ).toEqual(["release"]);
  expect(chipRowLabels(tree)).toEqual(["handover", "release"]);
  // Clicking a label that is already active does not add it twice.
  const before = listCalls().length;
  labelButton(rowOf(tree, "release"), "release").props.onClick();
  tree = await settle(page, own);
  expect(chipRowLabels(tree)).toEqual(["handover", "release"]);
  expect(listCalls()).toHaveLength(before);
});

it("removes one label with its x, and clears all of them", async () => {
  address = "/memorisation?labels=handover,release";
  let tree = await settle(page, own);
  expect(listCalls().at(-1)).toBe("/api/memorisations?tags=handover,release");
  removeButton(tree, "handover").props.onClick();
  tree = await settle(page, own);
  expect(listCalls().at(-1)).toBe("/api/memorisations?tags=release");
  expect(chipRowLabels(tree)).toEqual(["release"]);
  expect(address).toBe("/memorisation?labels=release");

  buttonOf(tree, "Clear labels").props.onClick();
  tree = await settle(page, own);
  expect(listCalls().at(-1)).toBe("/api/memorisations");
  expect(chipRowLabels(tree)).toEqual([]);
  expect(allText(tree)).not.toContain("Clear labels");
  expect(address).toBe("/memorisation");
});

it("keeps the labels in the address bar, so a reload keeps the filter", async () => {
  let tree = await settle(page, own);
  labelButton(rowOf(tree, "release"), "release").props.onClick();
  tree = await settle(page, own);
  expect(address).toBe("/memorisation?labels=release");
  labelButton(rowOf(tree, "release"), "handover").props.onClick();
  await settle(page, own);
  expect(address).toBe("/memorisation?labels=release,handover");

  // A reload forgets the component state but not the address.
  resetRender();
  requests.length = 0;
  tree = await settle(page, own);
  expect(listCalls()).toEqual(["/api/memorisations?tags=release,handover"]);
  expect(chipRowLabels(tree)).toEqual(["release", "handover"]);
});

it("goes back to page 1 when the filter changes", async () => {
  rows = Array.from({ length: 7 }, (_, index) => ({
    id: `ms-00000${index}`,
    content: `note ${index}`,
    createdAt: `2026-11-0${index + 1}T10:00:00.000Z`,
    kind: "explicit",
    tags: index < 6 ? ["bulk", "even"] : ["bulk"],
  }));
  let tree = await settle(page, own);
  // The footer is a library component, so the test reaches the paging through the list's props.
  byType(tree, PagedList)[0]!.props.view.setPage(2);
  tree = await settle(page, own);
  const notes = (nodes: Node[]) => titles(nodes).filter((title) => title.startsWith("note"));
  expect(notes(tree)).toEqual(["note 1", "note 0"]);

  labelButton(tree.slice(tree.findIndex((node) => node.type === "h3")), "bulk").props.onClick();
  tree = await settle(page, own);
  // Seven rows match, so page 1 shows the five newest.
  expect(notes(tree)).toEqual(["note 6", "note 5", "note 4", "note 3", "note 2"]);
});

it("says no memorisation has the labels, with a way out, when the filter matches nothing", async () => {
  address = "/memorisation?labels=nothing";
  const tree = await settle(page, own);
  expect(allText(tree)).toContain("No memorisation matches every filter.");
  expect(allText(tree)).not.toContain("No memorisations yet");
  expect(buttonOf(tree, "Clear labels")).toBeDefined();
});

it("sends label: from the recall box as tags and the rest as the query", async () => {
  let tree = await submitSearch('release label:handover label:"two words"');
  expect(requests.at(-1)!.path).toBe(
    "/api/memorisations/recall?q=release&tags=handover,two%20words"
  );
  expect(allText(tree)).toContain('Results for release label:handover label:"two words"');
  resetRender();
  tree = await submitSearch("label:handover");
  expect(requests.at(-1)!.path).toBe("/api/memorisations/recall?q=&tags=handover");
  // With no text the server has no confidence score to give.
  expect(
    byType(tree, HuePill)
      .map((node) => node.props.label)
      .some((label) => String(label).startsWith("Confidence"))
  ).toBe(false);
  expect(
    tree.filter((node) => String(node.props["aria-label"]).startsWith("Filter by label")).length
  ).toBeGreaterThan(0);
});

it("leaves the list filter and the address alone when the recall box uses label:", async () => {
  address = "/memorisation?labels=release";
  await settle(page, own);
  const listBefore = listCalls();
  const tree = await submitSearch("notes label:handover");
  expect(requests.at(-1)!.path).toBe("/api/memorisations/recall?q=notes&tags=handover");
  expect(address).toBe("/memorisation?labels=release");
  expect(chipRowLabels(tree)).toEqual(["release"]);
  expect(listCalls()).toEqual(listBefore);
});

it("describes label: in the placeholder and the help text, and fills the placeholder", async () => {
  const tree = await settle(page, own);
  const input = inputOf(tree, "memorisation-search-input");
  expect(input.props.placeholder).toContain("label:");
  expect(allText(tree)).toContain("label:name");
  expect(input.props["aria-describedby"]).toBe("memorisation-search-help");
});

it("lets a pill in the recall results add its label to the list filter", async () => {
  const tree = await submitSearch("release notes");
  const results = byType(tree, "ul").find(
    (node) => node.props["aria-label"] === "Results for release notes"
  )!;
  expect(results).toBeDefined();
  const pills = tree.filter(
    (node) => node.type === "button" && node.props["aria-label"] === "Filter by label ops"
  );
  expect(pills.length).toBeGreaterThan(0);
  pills[0]!.props.onClick();
  await settle(page, own);
  expect(listCalls().at(-1)).toBe("/api/memorisations?tags=ops");
});

// ---- Select mode and bulk delete ----

/** The row checkboxes of select mode; the rerank switch in the settings card is not one. */
const rowBoxes = (tree: Node[]) =>
  byType(tree, Checkbox).filter((node) => node.props.id !== "memorisation-rerank");
const checkboxOf = (tree: Node[], id: string) =>
  tree.find((node) => node.type === Checkbox && node.props["aria-label"] === `Select ${id}`)!;
const dialogOf = (tree: Node[]) => tree.slice(tree.findIndex((node) => node.type === DialogTitle));
const startSelecting = async () => {
  const tree = await settle(page, own);
  buttonOf(tree, "Select").props.onClick();
  return settle(page, own);
};

it("shows no checkboxes until Select is pressed, then one on each card", async () => {
  let tree = await settle(page, own);
  expect(rowBoxes(tree)).toHaveLength(0);
  expect(allText(tree)).not.toContain("Delete selected");
  buttonOf(tree, "Select").props.onClick();
  tree = await settle(page, own);
  expect(rowBoxes(tree)).toHaveLength(2);
  expect(allText(tree)).toContain("0 selected");
  expect(buttonOf(tree, "Delete selected").props.disabled).toBe(true);
  expect(buttonOf(tree, "Select all")).toBeDefined();
});

it("counts ticked cards, and Select all ticks every selectable card on the page", async () => {
  let tree = await startSelecting();
  checkboxOf(tree, "ms-aaaaaa").props.onCheckedChange(true);
  tree = await settle(page, own);
  expect(allText(tree)).toContain("1 selected");
  buttonOf(tree, "Select all").props.onClick();
  tree = await settle(page, own);
  expect(allText(tree)).toContain("2 selected");
  expect(checkboxOf(tree, "ms-bbbbbb").props.checked).toBe(true);
  checkboxOf(tree, "ms-aaaaaa").props.onCheckedChange(false);
  tree = await settle(page, own);
  expect(allText(tree)).toContain("1 selected");
});

it("keeps a linked-space card out of the selection and says why", async () => {
  rows = [rows[0]!, { ...rows[1]!, space: "Beta" }];
  let tree = await startSelecting();
  const linked = checkboxOf(tree, "ms-bbbbbb");
  expect(linked.props.disabled).toBe(true);
  expect(linked.props["aria-describedby"]).toBe("memorisation-linked-ms-bbbbbb");
  expect(checkboxOf(tree, "ms-aaaaaa").props.disabled).toBeFalsy();
  buttonOf(tree, "Select all").props.onClick();
  tree = await settle(page, own);
  expect(allText(tree)).toContain("1 selected");
  expect(checkboxOf(tree, "ms-bbbbbb").props.checked).toBeFalsy();
  expect(allText(tree)).toContain("linked space Beta, which is read-only");
});

it("asks once, with the count, and sends nothing until the user confirms", async () => {
  let tree = await startSelecting();
  buttonOf(tree, "Select all").props.onClick();
  tree = await settle(page, own);
  buttonOf(tree, "Delete selected").props.onClick();
  tree = await settle(page, own);
  expect(byType(tree, DialogTitle)).toHaveLength(1);
  expect(text(byType(tree, DialogTitle)[0]!.props.children)).toBe(
    "Delete the selected memorisations?"
  );
  expect(allText(dialogOf(tree))).toContain("Memorisations to delete: 2");
  expect(changes()).toEqual([]);

  buttonOf(dialogOf(tree), "Cancel").props.onClick();
  tree = await settle(page, own);
  expect(byType(tree, DialogTitle)).toHaveLength(0);
  expect(changes()).toEqual([]);
  // The selection survives a cancelled dialog.
  expect(allText(tree)).toContain("2 selected");
});

it("bulk-deletes the ticked ids, reports the result, refreshes and leaves select mode", async () => {
  let tree = await startSelecting();
  buttonOf(tree, "Select all").props.onClick();
  tree = await settle(page, own);
  buttonOf(tree, "Delete selected").props.onClick();
  tree = await settle(page, own);
  const gets = listCalls().length;
  buttonOf(dialogOf(tree), "Delete").props.onClick();
  tree = await settle(page, own);
  expect(changes()).toHaveLength(1);
  expect(changes()[0]!.method).toBe("POST");
  expect(changes()[0]!.path).toBe("/api/memorisations/bulk-delete");
  expect([...changes()[0]!.body.ids].sort()).toEqual(["ms-aaaaaa", "ms-bbbbbb"]);
  expect(Object.keys(changes()[0]!.body)).toEqual(["ids"]);
  expect(allText(tree)).toContain("Deleted 2.");
  expect(byType(tree, DialogTitle)).toHaveLength(0);
  expect(listCalls().length).toBeGreaterThan(gets);
  expect(allText(tree)).toContain("No memorisations yet");
  expect(rowBoxes(tree)).toHaveLength(0);
});

it("names each skipped id with its reason", async () => {
  rows = [rows[0]!, { ...rows[1]!, space: "Beta" }];
  let tree = await startSelecting();
  checkboxOf(tree, "ms-aaaaaa").props.onCheckedChange(true);
  tree = await settle(page, own);
  buttonOf(tree, "Delete selected").props.onClick();
  tree = await settle(page, own);
  bulkReply = {
    body: {
      success: true,
      data: {
        deleted: [],
        skipped: [
          { id: "ms-aaaaaa", reason: "not-found" },
          { id: "ms-bbbbbb", reason: "linked" },
          { id: "ms-cccccc", reason: "not-memorisation" },
        ],
      },
    },
  };
  buttonOf(dialogOf(tree), "Delete").props.onClick();
  tree = await settle(page, own);
  const shown = allText(tree);
  expect(shown).toContain("Deleted 0.");
  expect(shown).toContain("Skipped ms-aaaaaa: it no longer exists");
  expect(shown).toContain("Skipped ms-bbbbbb: it is in a linked space, which is read-only");
  expect(shown).toContain("Skipped ms-cccccc: it is not a memorisation");
});

it("keeps the dialog and the selection when the bulk delete fails", async () => {
  let tree = await startSelecting();
  buttonOf(tree, "Select all").props.onClick();
  tree = await settle(page, own);
  buttonOf(tree, "Delete selected").props.onClick();
  tree = await settle(page, own);
  bulkReply = { status: 500, body: { success: false, error: "disk" } };
  buttonOf(dialogOf(tree), "Delete").props.onClick();
  tree = await settle(page, own);
  expect(allText(tree)).toContain("Could not delete the selected memorisations. Try again.");
  expect(byType(tree, DialogTitle)).toHaveLength(1);
  expect(allText(tree)).toContain("2 selected");
  expect(titles(tree)).toContain("release");
});

it("Cancel leaves select mode and drops the ticks", async () => {
  let tree = await startSelecting();
  checkboxOf(tree, "ms-aaaaaa").props.onCheckedChange(true);
  tree = await settle(page, own);
  buttonOf(tree, "Cancel").props.onClick();
  tree = await settle(page, own);
  expect(rowBoxes(tree)).toHaveLength(0);
  expect(changes()).toEqual([]);
  buttonOf(tree, "Select").props.onClick();
  tree = await settle(page, own);
  expect(allText(tree)).toContain("0 selected");
});

it("drops ticks on cards that a new filter hides, so they cannot be deleted unseen", async () => {
  let tree = await startSelecting();
  buttonOf(tree, "Select all").props.onClick();
  tree = await settle(page, own);
  expect(allText(tree)).toContain("2 selected");
  labelButton(rowOf(tree, "release"), "release").props.onClick();
  tree = await settle(page, own);
  expect(allText(tree)).toContain("1 selected");
});

it("shows the new texts in Chinese and Arabic", async () => {
  for (const [language, select, filter] of [
    ["zh", "选择", "清除标签"],
    ["ar", "تحديد", "مسح الوسوم"],
  ] as const) {
    resetRender();
    address = "/memorisation?labels=release";
    setLanguage(language);
    const tree = await settle(page, own);
    expect(allText(tree)).toContain(filter);
    expect(buttonOf(tree, select)).toBeDefined();
  }
  setLanguage("en");
});

// ---- Label picker ----

const checkboxes = (tree: Node[]) =>
  byType(tree, Checkbox).filter((node) => String(node.props.id).startsWith("memorisation-picker-"));
/** The check box for a label in a group (0-based), found through the label text it sits beside. */
const tickBox = (tree: Node[], group: number, label: string) => {
  const boxes = checkboxes(tree).filter((node) =>
    String(node.props.id).startsWith(`memorisation-picker-${group}-`)
  );
  const names = byType(tree, Label)
    .filter((node) => String(node.props.htmlFor).startsWith(`memorisation-picker-${group}-`))
    .map((node) => [node.props.htmlFor, node.props["data-label"]]);
  const id = names.find(([, name]) => name === label)?.[0];
  return boxes.find((node) => node.props.id === id)!;
};
/** The tree's text without the direction isolates that wrap each label name. */
const plainText = (tree: Node[]) => allText(tree).replace(/[\u2068\u2069]/g, "");
const openPicker = async () => {
  let tree = await settle(page, own);
  buttonOf(tree, "Filter by label").props.onClick();
  tree = await settle(page, own);
  return tree;
};
const pickerHas = (tree: Node[]) => byType(tree, DialogTitle).length === 1;
const tick = async (group: number, label: string, on = true) => {
  const tree = await settle(page, own);
  tickBox(tree, group, label).props.onCheckedChange(on);
  return settle(page, own);
};

it("opens the picker with every label, its count, and one empty group", async () => {
  const tree = await openPicker();
  expect(text(byType(tree, DialogTitle)[0]!.props.children)).toBe("Filter by label");
  expect(requests.map((request) => request.path)).toContain("/api/memorisations/labels");
  const rowsOfPicker = byType(tree, Label)
    .filter((node) => String(node.props.htmlFor).startsWith("memorisation-picker-0-"))
    .map((node) => node.props["data-label"]);
  expect(rowsOfPicker).toEqual(["handover", "ops", "release"]);
  expect(checkboxes(tree).every((node) => node.props.checked === false)).toBe(true);
  expect(allText(tree)).toContain("2");
  expect(allText(tree)).toContain("Nothing ticked: the list will show every record.");
});

it("builds two groups, shows the summary, and Apply writes one OR label and one plain label", async () => {
  await openPicker();
  await tick(0, "release");
  await tick(0, "ops");
  let tree = await settle(page, own);
  buttonOf(tree, "Add group").props.onClick();
  tree = await settle(page, own);
  tickBox(tree, 1, "handover").props.onCheckedChange(true);
  tree = await settle(page, own);
  expect(plainText(tree)).toContain("Showing: (release or ops) and (handover)");
  buttonOf(tree, "Apply").props.onClick();
  tree = await settle(page, own);
  expect(address).toBe("/memorisation?labels=release%7Cops,handover");
  expect(listCalls().at(-1)).toBe("/api/memorisations?tags=release%7Cops,handover");
  expect(chipRowLabels(tree)).toEqual(["release or ops", "handover"]);
  expect(pickerHas(tree)).toBe(false);
});

it("keeps the filter when the picker is cancelled", async () => {
  address = "/memorisation?labels=release";
  await settle(page, own);
  await openPicker();
  await tick(0, "ops");
  let tree = await settle(page, own);
  buttonOf(tree, "Cancel").props.onClick();
  tree = await settle(page, own);
  expect(pickerHas(tree)).toBe(false);
  expect(address).toBe("/memorisation?labels=release");
  expect(chipRowLabels(tree)).toEqual(["release"]);
});

it("removes a group, and an empty group counts for nothing", async () => {
  await openPicker();
  let tree = await settle(page, own);
  expect(byType(tree, Button).some((node) => node.props["aria-label"] === "Remove group 1")).toBe(
    false
  );
  buttonOf(tree, "Add group").props.onClick();
  tree = await settle(page, own);
  tickBox(tree, 0, "ops").props.onCheckedChange(true);
  tree = await settle(page, own);
  expect(plainText(tree)).toContain("Showing: (ops)");
  const remove = byType(tree, Button).find(
    (node) => node.props["aria-label"] === "Remove group 2"
  )!;
  remove.props.onClick();
  tree = await settle(page, own);
  expect(
    checkboxes(tree).filter((node) => String(node.props.id).startsWith("memorisation-picker-1-"))
  ).toHaveLength(0);
  buttonOf(tree, "Apply").props.onClick();
  await settle(page, own);
  expect(address).toBe("/memorisation?labels=ops");
});

it("opens with the current filter: one group per label, alternatives ticked", async () => {
  address = "/memorisation?labels=release%7Cops,handover,gone";
  const tree = await openPicker();
  const ticked = (group: number) =>
    byType(tree, Label)
      .filter((node) => String(node.props.htmlFor).startsWith(`memorisation-picker-${group}-`))
      .filter((node) => tickBox(tree, group, node.props["data-label"]).props.checked)
      .map((node) => node.props["data-label"]);
  expect(ticked(0)).toEqual(["ops", "release"]);
  expect(ticked(1)).toEqual(["handover"]);
  // A label no record carries stays in the list, ticked, so it can be removed.
  expect(ticked(2)).toEqual(["gone"]);
  expect(plainText(tree)).toContain("Showing: (release or ops) and (handover) and (gone)");
});

it("says the labels could not load, offers Try again, and leaves the filter alone", async () => {
  address = "/memorisation?labels=release";
  labelsStatus = 500;
  let tree = await openPicker();
  expect(allText(tree)).toContain("The labels could not load.");
  expect(allText(tree)).toContain("disk");
  expect(buttonOf(tree, "Apply").props.disabled).toBe(true);
  labelsStatus = 0;
  buttonOf(tree, "Try again").props.onClick();
  tree = await settle(page, own);
  expect(allText(tree)).not.toContain("The labels could not load.");
  expect(byType(tree, Label).length).toBeGreaterThan(0);
  buttonOf(tree, "Cancel").props.onClick();
  await settle(page, own);
  expect(address).toBe("/memorisation?labels=release");
});

it("shows the picker in Chinese and Arabic", async () => {
  for (const [language, open] of [
    ["zh", "按标签筛选"],
    ["ar", "تصفية حسب الوسم"],
  ] as const) {
    resetRender();
    setLanguage(language);
    let tree = await settle(page, own);
    buttonOf(tree, open).props.onClick();
    tree = await settle(page, own);
    expect(text(byType(tree, DialogTitle)[0]!.props.children)).toBe(open);
  }
  setLanguage("en");
});

it("names each group with a legend that is a direct child of its fieldset", async () => {
  const tree = await openPicker();
  const fieldset = byType(tree, "fieldset")[0]!;
  const kids = [fieldset.props.children].flat() as Node[];
  expect(kids.some((child) => child && (child as Node).type === "legend")).toBe(true);
});

it("isolates each label name for mixed-direction text", async () => {
  const tree = await openPicker();
  const names = byType(tree, Label).filter((node) =>
    String(node.props.htmlFor).startsWith("memorisation-picker-0-")
  );
  expect(names).toHaveLength(3);
  for (const name of names) {
    expect((name.props.children as Node).type).toBe("bdi");
  }
});

it("matches a filter label written with spaces around the bar to the counted labels", async () => {
  address = "/memorisation?labels=release%20%7C%20ops";
  const tree = await openPicker();
  const names = byType(tree, Label)
    .filter((node) => String(node.props.htmlFor).startsWith("memorisation-picker-0-"))
    .map((node) => node.props["data-label"]);
  expect(names).toEqual(["handover", "ops", "release"]);
  expect(tickBox(tree, 0, "release").props.checked).toBe(true);
  expect(tickBox(tree, 0, "ops").props.checked).toBe(true);
});
