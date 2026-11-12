import { beforeEach, expect, it } from "bun:test";
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
const { RerankSwitch } = await import("../src/lib/components/memorisation/RerankSwitch.tsx");
const { Tooltip } = await import("../src/lib/components/ui/tooltip.tsx");
const { DeleteMemorisationDialog } =
  await import("../src/lib/components/memorisation/DeleteMemorisationDialog.tsx");
const { MemorisationSelectBar } =
  await import("../src/lib/components/memorisation/MemorisationSelectBar.tsx");
const { LabelFilterBar } = await import("../src/lib/components/memorisation/LabelFilterBar.tsx");
const { LabelPill } = await import("../src/lib/components/memorisation/LabelPill.tsx");
const { PagedList } = await import("../src/lib/components/paged-list/index.ts");
const { BulkDeleteDialog } =
  await import("../src/lib/components/memorisation/BulkDeleteDialog.tsx");
const { BulkDeleteResult } =
  await import("../src/lib/components/memorisation/BulkDeleteResult.tsx");
const { Button } = await import("../src/lib/components/ui/button.tsx");
const { Checkbox } = await import("../src/lib/components/ui/checkbox.tsx");
const { Input } = await import("../src/lib/components/ui/input.tsx");
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
  RerankSwitch,
  DeleteMemorisationDialog,
  MemorisationSelectBar,
  LabelFilterBar,
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
let deleteFails = false;
let recallReply: { status?: number; body: unknown } | null = null;
let requests: Request[] = [];
/** The address bar of the fake window: path, query and nothing else. */
let address = "/memorisation";
/** What a bulk delete answers for ids it cannot delete, by id. */
let bulkReply: { status?: number; body: unknown } | null = null;

const matchesTags = (row: Row, tags: string[]) =>
  tags.every((tag) => (row.tags ?? []).some((own) => own.toLowerCase() === tag.toLowerCase()));

beforeEach(() => {
  resetRender();
  stored.clear();
  clipboard = [];
  clipboardRefuses = false;
  setLanguage("en");
  deleteFails = false;
  recallReply = null;
  bulkReply = null;
  address = "/memorisation";
  refuseSizeBelow = 0;
  rerankSaveFails = null;
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
const radioOf = (tree: Node[], label: string) =>
  tree.find(
    (node) =>
      node.type === "button" &&
      node.props.role === "radio" &&
      text(node.props.children).includes(label)
  )!;
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

it("opens a row to show the full stored text", async () => {
  let tree = await settle(page, own);
  const row = rowOf(tree, "release");
  expect(byType(tree, "pre").map((node) => node.props["aria-label"])).not.toContain(
    "Stored text of ms-aaaaaa"
  );
  const open = buttonOf(row, "Show full text");
  expect(open.props["aria-expanded"]).toBe(false);
  open.props.onClick();
  tree = await settle(page, own);
  const pre = byType(tree, "pre").find(
    (node) => node.props["aria-label"] === "Stored text of ms-aaaaaa"
  )!;
  expect(text(pre.props.children)).toBe("Topic: release\nDone: tagged\nNext: publish");
  expect(buttonOf(rowOf(tree, "release"), "Hide full text").props["aria-expanded"]).toBe(true);
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
  tree = await settle(page, own);
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
  tree = await settle(page, own);
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
  tree = await settle(page, own);
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
  tree = await settle(page, own);
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
  expect(allText(tree)).toContain("Enter a whole number from 100 to 20,000 characters.");

  // Tokens use their own range.
  radioOf(tree, "Tokens").props.onClick();
  typeInto(inputOf(await settle(page, own), "memorisation-size"), "6000");
  byType(await settle(page, own), "form")
    .at(-1)!
    .props.onSubmit({ preventDefault() {} });
  expect(allText(await settle(page, own))).toContain(
    "Enter a whole number from 25 to 5,000 tokens."
  );
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
  tree = await settle(page, own);
  expect(changes()).toHaveLength(1);
  expect(allText(tree)).toContain("Enter a whole number from 100 to 20,000 characters.");
  // The typed value stays so the user can correct it.
  expect(inputOf(tree, "memorisation-size").props.value).toBe("120");
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
        !request.path.includes("recall")
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
  expect(allText(tree)).toContain("Showing records with all of these labels:");
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
  expect(allText(tree)).toContain("No memorisation has all of these labels.");
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
