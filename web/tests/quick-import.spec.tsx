import { beforeEach, expect, it } from "bun:test";
import {
  allText,
  installFetch,
  installReact,
  resetRender,
  settle,
  text,
  type Node,
  type Request,
} from "./space-kit.tsx";

installReact();

let externalState = "ready";
let modelTestReply: { ok: boolean; model?: string; error?: string } = { ok: true, model: "m" };
let found = { pi: true, opencode: true, "claude-code": true };
let previewHosts: (host: string) => Record<string, unknown> = () => ({
  state: "done",
  sessions: 3,
  summary: { unitsWouldImport: 4 },
});
let staleReplies = 0;
let staleReal = 0;
let profileCalls = 2;
let unresolved = 0;
let externalModel = "deepseek-flash";
let apiUrl = "https://api.example/v1";
let readinessHangs = false;
let currentJob: unknown = null;
// Session listings that succeed before the list route starts to fail.
let listOk = Infinity;
let opencodeAvailable = true;
let profileIdentity = true;

const requests = installFetch((request: Request) => {
  const { path, body } = request;
  if (path === "/api/settings")
    return { body: { revision: "r1", settings: { memoryApiUrl: { value: apiUrl } } } };
  if (path.endsWith("/readiness")) {
    if (readinessHangs) return new Promise<never>(() => {});
    return {
      body: {
        external: { state: externalState, provider: "deepseek", model: externalModel },
        opencode: {
          available: opencodeAvailable,
          models: [{ provider: "anthropic", model: "claude", name: "Claude" }],
        },
        piReader: { available: true },
        defaultSourceFound: found,
        profileIdentity,
      },
    };
  }
  if (path === "/api/settings/external-api/test") return { body: modelTestReply };
  if (path.endsWith("/imports/current")) return { body: { job: currentJob } };
  if (path.endsWith("/imports/sessions")) {
    if (listOk-- <= 0) return { status: 500, body: { error: "The list could not be read" } };
    return {
      body: {
        source: { sourceToken: `token-${body.host}`, displayPath: `/x/${body.host}` },
        total: 3,
        offset: 0,
        rows: [],
        unresolvedCount: unresolved,
        revision: `revision-${body.host}`,
        listedAt: 100,
      },
    };
  }
  if (path === "/api/settings/imports") {
    const dryRun = body.options.dryRun;
    if (staleReplies > 0 || (!dryRun && staleReal > 0)) {
      if (staleReplies > 0) staleReplies--;
      else staleReal--;
      return {
        status: 409,
        body: { error: "The session list is out of date. Refresh the list and try again." },
      };
    }
    return {
      body: {
        id: dryRun ? `preview-${requests.length}` : "import",
        dryRun,
        state: dryRun ? "done" : "running",
        hosts: body.hosts.map((child: { host: string }) => ({
          host: child.host,
          ...(dryRun ? previewHosts(child.host) : { state: "running" }),
        })),
        ...(dryRun ? { profileEstimate: { analysisCalls: profileCalls } } : {}),
      },
    };
  }
  return { body: {} };
});

// The router reads the page address when it loads.
Object.assign(globalThis.window, {
  location: { pathname: "/memory/pi", hash: "" },
  history: { pushState: () => {}, replaceState: () => {} },
});
const { ImportSection } = await import("../src/lib/components/memory/ImportSection.tsx");
const { HostView } = await import("../src/lib/components/memory/HostView.tsx");
const { allSetUp, fakeStatuses } = await import("./fake-statuses.ts");
const { ImportCustomise } = await import("../src/lib/components/memory/ImportCustomise.tsx");
const { ImportChecklist, ImportModelLine } =
  await import("../src/lib/components/memory/ImportChecklist.tsx");
const { ImportFinish } = await import("../src/lib/components/memory/ImportFinish.tsx");
const { ImportConfirmDialog } =
  await import("../src/lib/components/memory/ImportConfirmDialog.tsx");
const { forgetModelTest } = await import("../src/lib/components/memory/use-quick-import.ts");
const { HostSessionSelection } =
  await import("../src/lib/components/memory/HostSessionSelection.tsx");
const { ImportOptions } = await import("../src/lib/components/memory/ImportOptions.tsx");
const { Button } = await import("../src/lib/components/ui/button.tsx");
const { setLanguage } = await import("../src/lib/i18n/index.ts");
const { usePath } = await import("../src/lib/router.ts");

const own = [
  ImportSection,
  ImportCustomise,
  ImportChecklist,
  ImportModelLine,
  HostSessionSelection,
  ImportOptions,
];
const SKIPPED = "Chats already imported are skipped, so running an import again is safe.";

const posts = (path: string) => requests.filter((request) => request.path === path);
const imports = () => posts("/api/settings/imports");
const button = (tree: Node[], label: string) =>
  tree.find(
    (node) =>
      (node.type === Button || node.type === "button") && text(node.props.children) === label
  );
const dialog = (tree: Node[]) => tree.find((node) => node.type === ImportConfirmDialog);

async function open(host?: "pi" | "opencode" | "claude-code") {
  const element = host ? <ImportSection host={host} /> : <ImportSection />;
  return { element, tree: await settle(element, own) };
}
async function press(element: React.ReactElement, tree: Node[], label: string) {
  const target = button(tree, label);
  expect(target).toBeDefined();
  expect(target!.props.disabled).toBeFalsy();
  void target!.props.onClick();
  return settle(element, own);
}

beforeEach(() => {
  resetRender();
  forgetModelTest();
  requests.length = 0;
  externalState = "ready";
  modelTestReply = { ok: true, model: "m" };
  found = { pi: true, opencode: true, "claude-code": true };
  previewHosts = () => ({ state: "done", sessions: 3, summary: { unitsWouldImport: 4 } });
  staleReplies = 0;
  staleReal = 0;
  profileCalls = 2;
  unresolved = 0;
  externalModel = "deepseek-flash";
  apiUrl = "https://api.example/v1";
  readinessHangs = false;
  currentJob = null;
  listOk = Infinity;
  opencodeAvailable = true;
  profileIdentity = true;
  setLanguage("en");
});

it("tests the external API once, lists all projects, previews every session and opens the dialog", async () => {
  const { element, tree } = await open("pi");
  const after = await press(element, tree, "Import new chats");
  expect(posts("/api/settings/external-api/test")).toHaveLength(1);
  const listed = posts("/api/settings/imports/sessions");
  expect(listed).toHaveLength(1);
  expect(listed[0]!.body).toMatchObject({ host: "pi", scope: "all-projects", pathMaps: [] });
  expect(imports()).toHaveLength(1);
  const preview = imports()[0]!.body;
  expect(preview.options.dryRun).toBe(true);
  expect(preview.options.scope).toBe("all-projects");
  expect(preview.hosts).toHaveLength(1);
  expect(preview.hosts[0]).toMatchObject({ host: "pi", selection: { mode: "all" } });
  // The dialog states what the preview found; nothing real starts before it is confirmed.
  const question = dialog(after)!;
  expect(question).toBeDefined();
  expect(question.props.estimate).toEqual({ sessions: 3, calls: 6, minutes: null });
  expect(question.props.hosts).toEqual(["pi"]);
  expect(imports().every((request) => request.body.options.dryRun)).toBe(true);
});

it("does not test the model a second time on the same page", async () => {
  const first = await open("pi");
  const after = await press(first.element, first.tree, "Import new chats");
  void dialog(after)!.props.onClose();
  const closed = await settle(first.element, own);
  await press(first.element, closed, "Import new chats");
  expect(posts("/api/settings/external-api/test")).toHaveLength(1);
  // A new host view on the same page load does not test again either.
  resetRender();
  const second = await open("claude-code");
  await press(second.element, second.tree, "Import new chats");
  expect(posts("/api/settings/external-api/test")).toHaveLength(1);
});

it("starts no preview when the model test fails, and fails the Model check with the reason", async () => {
  modelTestReply = { ok: false, error: "401 Unauthorized" };
  const { element, tree } = await open("pi");
  const after = await press(element, tree, "Import new chats");
  expect(posts("/api/settings/imports/sessions")).toHaveLength(0);
  expect(imports()).toHaveLength(0);
  expect(dialog(after)).toBeUndefined();
  expect(allText(after)).toContain("The model service did not accept your API key.");
  expect(allText(after)).toContain("Error code: 401");
  expect(allText(after)).not.toContain("Unauthorized");
  expect(button(after, "Import new chats")!.props.disabled).toBe(true);
});

it("does not test-call a connected OpenCode model", async () => {
  const { element, tree } = await open("pi");
  // Choose the connected model in Customise, then import.
  const customise = tree.find((node) => node.type === "details")!;
  customise.props.onToggle({ currentTarget: { open: true } });
  const opened = await settle(element, own);
  const select = opened.find((node) => node.props["aria-label"] === "Import model")!;
  select.props.onChange({ target: { value: "anthropic/claude" } });
  const chosen = await settle(element, own);
  await press(element, chosen, "Import new chats");
  expect(posts("/api/settings/external-api/test")).toHaveLength(0);
  expect(imports()[0]!.body.hosts[0].modelChoice).toBe("anthropic/claude");
});

it("says Nothing new to import and opens no dialog when the preview finds no work", async () => {
  previewHosts = () => ({ state: "no-work", sessions: 0, summary: { unitsWouldImport: 0 } });
  profileCalls = 0;
  const { element, tree } = await open("pi");
  const after = await press(element, tree, "Import new chats");
  expect(allText(after)).toContain("Nothing new to import");
  expect(dialog(after)).toBeUndefined();
  expect(imports()).toHaveLength(1);
});

it("imports the previewed request on Import, and Cancel starts nothing", async () => {
  const { element, tree } = await open("pi");
  let after = await press(element, tree, "Import new chats");
  void dialog(after)!.props.onClose();
  after = await settle(element, own);
  expect(dialog(after)).toBeUndefined();
  expect(imports()).toHaveLength(1);
  // The preview counts stay under Details.
  expect(after.some((node) => node.type === "summary" && text(node) === "Details")).toBe(true);
  after = await press(element, after, "Import new chats");
  const reason = await dialog(after)!.props.onConfirm();
  expect(reason).toBeNull();
  const [, preview, real] = imports();
  expect(real!.body.options.dryRun).toBe(false);
  expect({ ...real!.body, options: { ...real!.body.options, dryRun: true } }).toEqual(
    preview!.body
  );
});

it("lists again once when the server says the list is out of date", async () => {
  staleReplies = 1;
  const { element, tree } = await open("pi");
  const after = await press(element, tree, "Import new chats");
  expect(posts("/api/settings/imports/sessions")).toHaveLength(2);
  expect(imports()).toHaveLength(2);
  expect(dialog(after)).toBeDefined();
});

it("stops after one retry and says the list changed", async () => {
  staleReplies = 2;
  const { element, tree } = await open("pi");
  const after = await press(element, tree, "Import new chats");
  expect(posts("/api/settings/imports/sessions")).toHaveLength(2);
  expect(imports()).toHaveLength(2);
  expect(dialog(after)).toBeUndefined();
  expect(allText(after)).toContain("The chat list changed while checking. Try again.");
});

it("imports all hosts with history and names the host left out", async () => {
  found = { pi: true, opencode: false, "claude-code": true };
  const { element, tree } = await open();
  expect(allText(tree)).toContain("Left out, no history found: OpenCode.");
  const after = await press(element, tree, "Import all hosts");
  expect(imports()[0]!.body.hosts.map((child: { host: string }) => child.host)).toEqual([
    "pi",
    "claude-code",
  ]);
  expect(dialog(after)!.props.hosts).toEqual(["pi", "claude-code"]);
});

it("blocks the button on a failed check and says what to do", async () => {
  externalState = "missing-key";
  const { tree } = await open("claude-code");
  expect(button(tree, "Import new chats")!.props.disabled).toBe(true);
  const words = allText(tree);
  expect(words).toContain("OMMS cannot find your external API key.");
  expect(words).not.toContain("memoryApiKey");
  expect(words).not.toContain("Claude Code: OMMS");
  expect(words).toContain("Open the external API settings");
});

it("opens the same dialog from Start import in Customise, never the browser's confirm box", async () => {
  const { element, tree } = await open("pi");
  tree.find((node) => node.type === "details")!.props.onToggle({ currentTarget: { open: true } });
  let after = await settle(element, own);
  after = await press(element, after, "List sessions");
  after = await press(element, after, "Select all matching (3)");
  after = await press(element, after, "Preview (dry run)");
  after = await press(element, after, "Start import");
  expect(dialog(after)).toBeDefined();
  expect(imports().filter((request) => !request.body.options.dryRun)).toHaveLength(0);
  expect(allText(after)).toContain(SKIPPED);
});

it("names sessions skipped for a missing folder and Resolve opens that host's folder list", async () => {
  unresolved = 5;
  const { element, tree } = await open("opencode");
  const after = await press(element, tree, "Import new chats");
  expect(allText(after)).toContain("5 sessions skipped: folder missing.");
  await press(element, after, "Resolve");
  expect(usePath()).toBe("/memory/opencode#directory-maps-opencode");
});

it("names the host in the missing-folder notice on the overview, and Resolve opens its host view", async () => {
  unresolved = 2;
  found = { pi: false, opencode: false, "claude-code": true };
  const { element, tree } = await open();
  const after = await press(element, tree, "Import all hosts");
  expect(allText(after)).toContain("Claude Code");
  expect(allText(after)).toContain("2 sessions skipped: folder missing.");
  await press(element, after, "Resolve");
  expect(usePath()).toBe("/memory/claude-code#directory-maps-claude-code");
});

it("opens Customise from Change on the model line", async () => {
  const { element, tree } = await open("pi");
  const customise = () =>
    tree.find((node) => node.type === "details" && node.props.open !== undefined);
  expect(customise()!.props.open).toBe(false);
  const after = await press(element, tree, "Change");
  expect(after.find((node) => node.type === "details" && node.props.open)).toBeDefined();
  expect(allText(after)).toContain("Model: Saved external API (deepseek/deepseek-flash)");
});

it("Retry failed lists the same hosts again, previews them and asks again", async () => {
  found = { pi: true, opencode: false, "claude-code": true };
  const { element, tree } = await open();
  let after = await press(element, tree, "Import all hosts");
  expect(await dialog(after)!.props.onConfirm()).toBeNull();
  dialog(after)!.props.onClose();
  after = await settle(element, own);
  const listedBefore = posts("/api/settings/imports/sessions").length;
  const finish = after.find((node) => node.type === ImportFinish)!;
  void finish.props.onRetry();
  after = await settle(element, own);
  expect(posts("/api/settings/imports/sessions").length).toBe(listedBefore + 2);
  const retry = imports().at(-1)!.body;
  expect(retry.options.dryRun).toBe(true);
  expect(retry.hosts.map((child: { host: string }) => child.host)).toEqual(["pi", "claude-code"]);
  expect(dialog(after)).toBeDefined();
});

it("ticks only the hosts with history on a first visit, once readiness loads", async () => {
  found = { pi: true, opencode: false, "claude-code": true };
  const { element, tree } = await open();
  tree.find((node) => node.type === "details")!.props.onToggle({ currentTarget: { open: true } });
  const after = await settle(element, own);
  const box = (label: string) => after.find((node) => node.props["aria-label"] === label)!;
  expect(box("Pi").props.checked).toBe(true);
  expect(box("OpenCode").props.checked).toBe(false);
  expect(box("Claude Code").props.checked).toBe(true);
});

it("Retry failed on a host view retries only that host", async () => {
  // An all-hosts run seen from the Pi view.
  currentJob = {
    id: "import",
    dryRun: false,
    state: "running",
    hosts: [
      { host: "pi", state: "failed" },
      { host: "opencode", state: "failed" },
      { host: "claude-code", state: "running" },
    ],
  };
  const { element, tree } = await open("pi");
  const finish = tree.find((node) => node.type === ImportFinish)!;
  void finish.props.onRetry();
  await settle(element, own);
  const retry = imports().at(-1)!.body;
  expect(retry.options.dryRun).toBe(true);
  expect(retry.hosts.map((child: { host: string }) => child.host)).toEqual(["pi"]);
  expect(posts("/api/settings/imports/sessions").map((request) => request.body.host)).toEqual([
    "pi",
  ]);
});

it("tests the model again after the saved model changes, for a pass and for a fail", async () => {
  const first = await open("pi");
  const after = await press(first.element, first.tree, "Import new chats");
  void dialog(after)!.props.onClose();
  expect(posts("/api/settings/external-api/test")).toHaveLength(1);
  // The user saves another model in Settings and comes back in the same tab.
  externalModel = "deepseek-pro";
  resetRender();
  const second = await open("pi");
  const checked = await press(second.element, second.tree, "Import new chats");
  expect(posts("/api/settings/external-api/test")).toHaveLength(2);
  void dialog(checked)!.props.onClose();
  // A failed test stays failed for that model only.
  modelTestReply = { ok: false, error: "401 Unauthorized" };
  apiUrl = "https://other.example/v1";
  resetRender();
  const third = await open("pi");
  const failed = await press(third.element, third.tree, "Import new chats");
  expect(posts("/api/settings/external-api/test")).toHaveLength(3);
  expect(button(failed, "Import new chats")!.props.disabled).toBe(true);
  modelTestReply = { ok: true, model: "m" };
  apiUrl = "https://api.example/v1";
  resetRender();
  const fourth = await open("pi");
  expect(button(fourth.tree, "Import new chats")!.props.disabled).toBeFalsy();
  await press(fourth.element, fourth.tree, "Import new chats");
  // Back on the model that passed before: no new call.
  expect(posts("/api/settings/external-api/test")).toHaveLength(3);
});

it("previews again and asks again when the list went out of date before Import", async () => {
  const { element, tree } = await open("pi");
  let after = await press(element, tree, "Import new chats");
  const before = imports().length;
  staleReal = 1;
  expect(await dialog(after)!.props.onConfirm()).toBeNull();
  after = await settle(element, own);
  // One refused real start, then one new preview; the dialog opens again with new numbers.
  expect(imports().length).toBe(before + 2);
  expect(imports().at(-1)!.body.options.dryRun).toBe(true);
  expect(dialog(after)).toBeDefined();
});

it("says in one plain line to select the button again when the list is out of date twice", async () => {
  const { element, tree } = await open("pi");
  let after = await press(element, tree, "Import new chats");
  staleReal = 2;
  expect(await dialog(after)!.props.onConfirm()).toBeNull();
  after = await settle(element, own);
  void dialog(after)!.props.onConfirm();
  after = await settle(element, own);
  expect(dialog(after)).toBeUndefined();
  expect(allText(after)).toContain("New chats appeared. Select Import new chats again.");
  expect(allText(after)).not.toContain("out of date");
});

it("clears the busy line and says why when listing again after a stale preview fails", async () => {
  // The preview job itself reports the stale list, so the page lists again from the job reply.
  let first = true;
  previewHosts = () => {
    if (!first) return { state: "done", sessions: 3, summary: { unitsWouldImport: 4 } };
    first = false;
    return {
      state: "failed",
      error: "The session list is out of date. Refresh the list and try again.",
    };
  };
  listOk = 1;
  const { element, tree } = await open("pi");
  const after = await press(element, tree, "Import new chats");
  expect(allText(after)).not.toContain("Listing sessions…");
  expect(allText(after)).toContain("The list could not be read");
  expect(button(after, "Import new chats")!.props.disabled).toBeFalsy();
});

it("starts one listing for two quick clicks", async () => {
  const { element, tree } = await open("pi");
  const target = button(tree, "Import new chats")!;
  void target.props.onClick();
  void target.props.onClick();
  await settle(element, own);
  expect(posts("/api/settings/imports/sessions")).toHaveLength(1);
});

it("stores no host choice when the user leaves before readiness loads", async () => {
  const data = new Map<string, string>();
  const g = globalThis as { localStorage?: unknown };
  g.localStorage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
  try {
    readinessHangs = true;
    await open();
    expect(data.size).toBe(0);
  } finally {
    delete g.localStorage;
  }
});

it("stores the choice once readiness ticked the hosts and the user changed one", async () => {
  const data = new Map<string, string>();
  const g = globalThis as { localStorage?: unknown };
  g.localStorage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
  try {
    found = { pi: true, opencode: true, "claude-code": false };
    const { element, tree } = await open();
    expect(data.size).toBe(0);
    tree.find((node) => node.type === "details")!.props.onToggle({ currentTarget: { open: true } });
    const opened = await settle(element, own);
    const box = opened.find((node) => node.props["aria-label"] === "Pi")!;
    box.props.onCheckedChange(false);
    await settle(element, own);
    expect(JSON.parse([...data.values()][0]!).hosts).toEqual(["opencode"]);
  } finally {
    delete g.localStorage;
  }
});

it("Change on the overview focuses the model choice of a host whose section shows", async () => {
  found = { pi: false, opencode: true, "claude-code": true };
  const focused: string[] = [];
  const g = globalThis as { requestAnimationFrame?: unknown; document?: unknown };
  g.requestAnimationFrame = (callback: () => void) => callback();
  g.document = { getElementById: (id: string) => ({ focus: () => focused.push(id) }) };
  try {
    const { element, tree } = await open();
    await press(element, tree, "Change");
    expect(focused).toEqual(["import-model-opencode"]);
  } finally {
    delete g.requestAnimationFrame;
    delete g.document;
  }
});

it("names on the overview the hosts that the import will cover", async () => {
  found = { pi: true, opencode: true, "claude-code": false };
  const { tree } = await open();
  expect(allText(tree)).toContain(
    "Imports chats from Pi, OpenCode. It makes model calls and can cost money."
  );
  const host = await open("pi");
  expect(allText(host.tree)).not.toContain("Imports chats from");
});

// Live check: only waiting profile prompts, no session. The server runs no host with no
// sessions, so the old dialog promised a call that the real import never made.
it("says Nothing new to import when only waiting profile prompts remain", async () => {
  previewHosts = () => ({ state: "no-work", sessions: 0, summary: { unitsWouldImport: 0 } });
  profileCalls = 1;
  const { element, tree } = await open("pi");
  const after = await press(element, tree, "Import new chats");
  expect(allText(after)).toContain("Nothing new to import");
  expect(dialog(after)).toBeUndefined();
});

it("lists in the overview dialog only the hosts the preview found work for", async () => {
  found = { pi: true, opencode: false, "claude-code": true };
  previewHosts = (host) =>
    host === "pi"
      ? { state: "no-work", sessions: 0, summary: { unitsWouldImport: 0 } }
      : { state: "done", sessions: 1, summary: { unitsWouldImport: 3 } };
  const { element, tree } = await open();
  const after = await press(element, tree, "Import all hosts");
  expect(dialog(after)!.props.hosts).toEqual(["claude-code"]);
});

it("never runs a forced re-import from Import new chats, even with the Re-analyse preset", async () => {
  const element = <ImportSection host="pi" profilePreset={1} />;
  const tree = await settle(element, own);
  const after = await press(element, tree, "Import new chats");
  expect(imports()[0]!.body.options.force).toBe(false);
  expect(dialog(after)!.props.force).toBe(false);
  expect(allText(after)).toContain(SKIPPED);
});

it("says in the dialog that a re-analyse from Customise analyses imported chats again", async () => {
  const element = <ImportSection host="pi" profilePreset={1} />;
  let after = await settle(element, own);
  after = await press(element, after, "List sessions");
  after = await press(element, after, "Select all matching (3)");
  after = await press(element, after, "Preview (dry run)");
  after = await press(element, after, "Start import");
  expect(imports().at(-1)!.body.options.force).toBe(true);
  expect(dialog(after)!.props.force).toBe(true);
});

it("keeps each host view's Customise options to that host", async () => {
  const views = [HostView, ...own];
  const statuses = fakeStatuses(allSetUp);
  const openCustomise = async (element: React.ReactElement) => {
    const tree = await settle(element, views);
    tree.find((node) => node.type === "details")!.props.onToggle({ currentTarget: { open: true } });
    return settle(element, views);
  };
  const handled = (nodes: Node[]) =>
    nodes.find((node) => node.props["aria-label"] === "Show handled sessions")!;
  const pi = <HostView host="pi" statuses={statuses} />;
  let tree = await openCustomise(pi);
  handled(tree).props.onCheckedChange(true);
  tree = await settle(pi, views);
  expect(handled(tree).props.checked).toBe(true);
  // The same page now shows OpenCode: its options start from the defaults.
  const opencode = await openCustomise(<HostView host="opencode" statuses={statuses} />);
  expect(handled(opencode).props.checked).toBe(false);
});

it("says 1 session, not 1 sessions, in the missing-folder notice", async () => {
  unresolved = 1;
  const { element, tree } = await open("opencode");
  const after = await press(element, tree, "Import new chats");
  expect(allText(after)).toContain("1 session skipped: folder missing.");
});

it("says the model is checked with one short call before the first import", async () => {
  const { element, tree } = await open("pi");
  expect(allText(tree)).toContain("Checks the model with one short call first.");
  const after = await press(element, tree, "Import new chats");
  void dialog(after)!.props.onClose();
  expect(allText(await settle(element, own))).not.toContain(
    "Checks the model with one short call first."
  );
});

it("shows the same model state in Customise as in the checklist", async () => {
  const { element, tree } = await open("pi");
  tree.find((node) => node.type === "details")!.props.onToggle({ currentTarget: { open: true } });
  const opened = await settle(element, own);
  const words = allText(opened);
  expect(words).not.toContain("Configured, not tested.");
  expect(words.match(/Ready, not tested/g)).toHaveLength(2);
});

it("leaves the OpenCode-only sentence out of the Pi view", async () => {
  opencodeAvailable = false;
  const { element, tree } = await open("pi");
  tree.find((node) => node.type === "details")!.props.onToggle({ currentTarget: { open: true } });
  const words = allText(await settle(element, own));
  expect(words).not.toContain("An import with an OpenCode signed-in model");
});

it("keeps the OpenCode-only sentence on the OpenCode view", async () => {
  opencodeAvailable = false;
  const { element, tree } = await open("opencode");
  tree.find((node) => node.type === "details")!.props.onToggle({ currentTarget: { open: true } });
  const words = allText(await settle(element, own));
  expect(words).toContain("An import with an OpenCode signed-in model");
});

it("blocks the button before a run when profile learning has no email, and says what to set", async () => {
  profileIdentity = false;
  const { tree } = await open("pi");
  expect(button(tree, "Import new chats")!.props.disabled).toBe(true);
  expect(allText(tree)).toContain("Profile learning needs your email address.");
  expect(allText(tree)).toContain("git config --global user.email");
});

it("ends the Re-analyse preset once the page leaves the overview", async () => {
  const { MemoryView } = await import("../src/lib/components/memory/MemoryView.tsx");
  const { MemoryOverview } = await import("../src/lib/components/memory/MemoryOverview.tsx");
  const { SharedView } = await import("../src/lib/components/memory/SharedView.tsx");
  const { navigate } = await import("../src/lib/router.ts");
  const element = <MemoryView />;
  const views = [MemoryView];
  navigate("/memory/shared");
  let tree = await settle(element, views);
  tree.find((node) => node.type === SharedView)!.props.onReanalyse();
  tree = await settle(element, views);
  expect(tree.find((node) => node.type === MemoryOverview)!.props.profilePreset).toBe(1);
  navigate("/memory/pi");
  await settle(element, views);
  navigate("/memory");
  tree = await settle(element, views);
  expect(tree.find((node) => node.type === MemoryOverview)!.props.profilePreset).toBe(0);
});
