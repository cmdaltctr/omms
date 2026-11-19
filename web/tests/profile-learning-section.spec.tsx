import { afterEach, beforeEach, expect, it, mock } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement, ReactNode } from "react";
import * as react from "react";
import { setLanguage } from "../src/lib/i18n/index.ts";

// The section keeps snapshot, draft, busy, status and resetting in this order, so tests inject
// each state.
let states: unknown[] = [];
let cursor = 0;
mock.module("react", () => ({
  ...react,
  useEffect: () => {},
  useRef: (value: unknown) => ({ current: value }),
  useContext: () => null,
  useMemo: (factory: () => unknown) => factory(),
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
  useState: (initial: unknown) => {
    const index = cursor++;
    states[index] ??= typeof initial === "function" ? (initial as () => unknown)() : initial;
    return [
      states[index],
      (value: unknown) => {
        states[index] = typeof value === "function" ? value(states[index]) : value;
      },
    ];
  },
}));
const { ProfileLearningSettingsSection } =
  await import("../src/lib/components/memory/ProfileLearningSettingsSection.tsx");
const { Select } = await import("../src/lib/components/ui/select.tsx");
const { SettingRow } = await import("../src/lib/components/settings/SettingRow.tsx");
const { SettingsConfirmDialog } =
  await import("../src/lib/components/settings/SettingsConfirmDialog.tsx");
const { Button } = await import("../src/lib/components/ui/button.tsx");
const { PROFILE_LEARNING_KEYS } = await import("../src/lib/profile-learning-controls.ts");

type Setting = { value?: unknown; source: string; globalValue?: unknown };
type Snapshot = { readOnly?: boolean; revision: string; settings: Record<string, Setting> };

const DEFAULT_VALUES: Record<string, unknown> = {
  userProfileWithoutEmail: "learn",
  userProfileDecayBeforeMerge: false,
  userProfilePromptDetail: "full",
  userProfileValidationEnabled: false,
  showUserProfileToasts: true,
  userProfileDuringCatchUp: "learn",
};

/** A snapshot of the six keys. `saved` lists the keys that sit in the global file. */
function snapshotFixture(saved: Record<string, unknown> = {}, readOnly = false): Snapshot {
  return {
    revision: "rev-1",
    readOnly,
    settings: Object.fromEntries(
      PROFILE_LEARNING_KEYS.map((key) => {
        const inFile = key in saved;
        const value = inFile ? saved[key] : DEFAULT_VALUES[key];
        return [key, { value, source: inFile ? "global" : "default", globalValue: value }];
      })
    ),
  };
}

type State = {
  snapshot?: Snapshot;
  draft?: Record<string, unknown>;
  busy?: boolean;
  status?: unknown;
  resetting?: boolean;
};
const inject = (state: State = {}) => {
  states = [
    state.snapshot ?? snapshotFixture(),
    state.draft ?? {},
    state.busy ?? false,
    state.status,
    state.resetting ?? false,
  ];
  cursor = 0;
};
const html = (state: State = {}) => {
  inject(state);
  return renderToStaticMarkup(<ProfileLearningSettingsSection />);
};

type Node = ReactElement<{ children?: ReactNode; [key: string]: unknown }>;
function find(node: ReactNode, predicate: (node: Node) => boolean): Node[] {
  if (!react.isValidElement(node))
    return Array.isArray(node) ? node.flatMap((child) => find(child, predicate)) : [];
  const element = node as Node;
  return [...(predicate(element) ? [element] : []), ...find(element.props.children, predicate)];
}
const tree = (state: State = {}) => {
  inject(state);
  return find(ProfileLearningSettingsSection(), () => true);
};
const button = (label: string, nodes: Node[]) =>
  nodes.find(
    (node) => node.type === Button && react.Children.toArray(node.props.children)[0] === label
  )!;
const submit = (nodes: Node[]) => nodes.find((node) => node.type === "form")!;

type Call = { url: string; init?: RequestInit };
const realFetch = globalThis.fetch;
let calls: Call[] = [];
beforeEach(() => {
  calls = [];
  setLanguage("en");
  Object.assign(globalThis, { window: { __OMMS_TOKEN__: "page-token" } });
});
afterEach(() => {
  globalThis.fetch = realFetch;
});
/** Answer every request; `patch` decides the PATCH reply, a GET always returns revision 2. */
function stubFetch(patch: () => { ok: boolean; body: unknown }) {
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    if (init?.method === "PATCH") {
      const reply = patch();
      return { ok: reply.ok, status: reply.ok ? 200 : 409, json: async () => reply.body };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ ...snapshotFixture(), revision: "rev-2" }),
    };
  }) as unknown as typeof fetch;
}
const patchBody = () =>
  JSON.parse(String(calls.find((call) => call.init?.method === "PATCH")!.init!.body));
const submitForm = async (nodes: Node[]) => {
  (submit(nodes).props.onSubmit as (event: { preventDefault: () => void }) => void)({
    preventDefault: () => {},
  });
  for (let i = 0; i < 6; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

it("shows ten rows: six dropdowns and four fixed values", () => {
  const nodes = tree();
  const rows = nodes.filter((node) => node.type === SettingRow);
  expect(rows.map((row) => row.props.setting)).toEqual([...PROFILE_LEARNING_KEYS]);
  expect(nodes.filter((node) => node.type === Select)).toHaveLength(6);
  const page = html();
  for (const name of [
    "No user email",
    "Fade old items",
    "Model input",
    "Check older items",
    "Notice when done",
    "During a catch-up run",
    "History entry",
    "When the host model fails",
    "Reply check",
    "Save clash",
  ]) {
    expect(page).toContain(name);
  }
  expect(page).toContain("3 tries, then wait 10 minutes");
  expect(page).toContain("Use the external API and show a notice");
  expect(page.match(/Fixed\. This is not a setting\./g)).toHaveLength(4);
  expect(page).toContain("These settings apply to every host");
});

it("puts the config keys in left-to-right code text and the names above the controls", () => {
  const page = html();
  expect(page).toContain(`<code dir="ltr"`);
  for (const key of PROFILE_LEARNING_KEYS) expect(page).toContain(`>${key}</code>`);
  // Each row stacks its name above its control below the sm breakpoint.
  expect(page).toContain("flex-col");
  expect(page).toContain("sm:flex-row");
});

it("shows the saved values, and the defaults when nothing is saved", () => {
  const values = (state: State) =>
    tree(state)
      .filter((node) => node.type === Select)
      .map((node) => node.props.value);
  expect(values({})).toEqual(["learn", "false", "full", "false", "true", "learn"]);
  const saved = snapshotFixture({
    userProfileWithoutEmail: "skip",
    userProfileDecayBeforeMerge: true,
    showUserProfileToasts: false,
  });
  expect(values({ snapshot: saved })).toEqual(["skip", "true", "full", "false", "false", "learn"]);
});

it("offers exactly the spec options in each dropdown", () => {
  const lists = tree()
    .filter((node) => node.type === Select)
    .map((select) =>
      find(select.props.children, (node) => node.type === "option").map(
        (option) => option.props.children
      )
    );
  expect(lists).toEqual([
    ["Learn anyway", "Skip"],
    ["Off", "On"],
    ["Prompts with profile and guidance", "Prompts only"],
    ["Off", "On"],
    ["On", "Off"],
    ["Keep learning", "Pause"],
  ]);
});

it("keeps a choice in the draft and shows it in the dropdown", () => {
  const nodes = tree();
  const decay = nodes.filter((node) => node.type === Select)[1]!;
  (decay.props.onChange as (event: { target: { value: string } }) => void)({
    target: { value: "true" },
  });
  expect(states[1]).toEqual({ userProfileDecayBeforeMerge: true });
  cursor = 0;
  const after = find(ProfileLearningSettingsSection(), (node) => node.type === Select);
  expect(after[1]!.props.value).toBe("true");
});

it("turns Save and Cancel on only after a change", () => {
  expect(button("Save", tree()).props.disabled).toBe(true);
  expect(button("Cancel", tree()).props.disabled).toBe(true);
  // Choosing the saved value again is no change.
  const same = tree({ draft: { userProfileWithoutEmail: "learn" } });
  expect(button("Save", same).props.disabled).toBe(true);
  const changed = tree({ draft: { userProfileWithoutEmail: "skip" } });
  expect(button("Save", changed).props.disabled).toBe(false);
  expect(button("Cancel", changed).props.disabled).toBe(false);
});

it("Cancel restores the saved values", () => {
  const nodes = tree({ draft: { userProfileWithoutEmail: "skip" } });
  (button("Cancel", nodes).props.onClick as () => void)();
  expect(states[1]).toEqual({});
});

it("saves only the changed keys, clears the draft and says so", async () => {
  stubFetch(() => ({ ok: true, body: { success: true } }));
  const nodes = tree({
    draft: { userProfileDecayBeforeMerge: true, showUserProfileToasts: true },
  });
  await submitForm(nodes);
  expect(patchBody()).toEqual({ edits: { userProfileDecayBeforeMerge: true }, revision: "rev-1" });
  expect(calls.some((call) => call.url === "/api/settings" && !call.init?.method)).toBe(true);
  expect(states[1]).toEqual({});
  expect(html({ status: states[3] as never })).toContain(
    "Saved. The next learning pass uses these settings."
  );
});

it("reloads the values and asks for a second save when the file changed meanwhile", async () => {
  stubFetch(() => ({
    ok: false,
    body: { error: "Config changed. Reload settings and save again." },
  }));
  await submitForm(tree({ draft: { userProfileWithoutEmail: "skip" } }));
  // The reload ran, the choice stays in the draft, and the status asks for a new save.
  expect(calls.filter((call) => !call.init?.method)).toHaveLength(1);
  expect(states[1]).toEqual({ userProfileWithoutEmail: "skip" });
  const page = html({ draft: states[1] as never, status: states[3] as never });
  expect(page).toContain("Config changed. Reload settings and save again.");
  expect(page).toContain("check the values and save again");
});

it("turns Reset off while none of the six keys is in the file", () => {
  expect(button("Reset to default", tree()).props.disabled).toBe(true);
  const saved = snapshotFixture({ userProfileWithoutEmail: "skip" });
  expect(button("Reset to default", tree({ snapshot: saved })).props.disabled).toBe(false);
});

it("asks before it resets, and sends nothing until the user confirms", () => {
  const saved = snapshotFixture({ userProfileWithoutEmail: "skip" });
  const nodes = tree({ snapshot: saved });
  expect(nodes.find((node) => node.type === SettingsConfirmDialog)).toBeUndefined();
  (button("Reset to default", nodes).props.onClick as () => void)();
  expect(states[4]).toBe(true);
  expect(calls).toHaveLength(0);
  const open = tree({ snapshot: saved, resetting: true });
  const dialog = open.find((node) => node.type === SettingsConfirmDialog)!;
  expect(dialog.props.title).toBe("Reset the learning settings?");
  expect(dialog.props.confirmLabel).toBe("Reset to default");
  (dialog.props.onClose as () => void)();
  expect(states[4]).toBe(false);
});

it("removes all six keys with null after the user confirms", async () => {
  stubFetch(() => ({ ok: true, body: { success: true } }));
  const saved = snapshotFixture({
    userProfileWithoutEmail: "skip",
    userProfileValidationEnabled: true,
  });
  const dialog = tree({
    snapshot: saved,
    resetting: true,
    draft: { showUserProfileToasts: false },
  }).find((node) => node.type === SettingsConfirmDialog)!;
  const result = await (dialog.props.onConfirm as () => Promise<{ success: boolean }>)();
  expect(result.success).toBe(true);
  expect(patchBody()).toEqual({
    edits: Object.fromEntries(PROFILE_LEARNING_KEYS.map((key) => [key, null])),
    revision: "rev-1",
  });
  expect(states[1]).toEqual({});
  expect(html({ status: states[3] as never })).toContain("Reset. Every row shows its default.");
});

it("keeps the dialog open with the reason when the reset fails", async () => {
  stubFetch(() => ({
    ok: false,
    body: { error: "Config changed. Reload settings and save again." },
  }));
  const saved = snapshotFixture({ userProfileWithoutEmail: "skip" });
  const dialog = tree({ snapshot: saved, resetting: true }).find(
    (node) => node.type === SettingsConfirmDialog
  )!;
  const result = await (
    dialog.props.onConfirm as () => Promise<{ success: boolean; error?: string }>
  )();
  expect(result.success).toBe(false);
  expect(result.error).toContain("Config changed. Reload settings and save again.");
});

it("turns Save and Reset off when the file cannot be read, and says why", () => {
  const readOnly = snapshotFixture({ userProfileWithoutEmail: "skip" }, true);
  const nodes = tree({ snapshot: readOnly, draft: { userProfileDecayBeforeMerge: true } });
  expect(button("Save", nodes).props.disabled).toBe(true);
  expect(button("Reset to default", nodes).props.disabled).toBe(true);
  expect(html({ snapshot: readOnly })).toContain("Saving is turned off until the file is fixed.");
  expect(html()).not.toContain("Saving is turned off until the file is fixed.");
});

it("disables the dropdowns and shows progress while saving", () => {
  const page = html({ busy: true });
  expect(page).toContain("disabled");
  expect(page).toContain('role="status"');
  expect(page).toContain("Saving…");
});

it("reads in Arabic with the config keys kept left to right", () => {
  setLanguage("ar");
  const page = html();
  expect(page).toContain("عند عدم وجود بريد المستخدم");
  expect(page).toContain("التعلّم على أي حال");
  expect(page).toContain("إعدادات التعلّم");
  expect(page).not.toContain("Learn anyway");
  expect(page).not.toContain("No user email");
  expect(page.match(/<code dir="ltr"/g)).toHaveLength(6);
  setLanguage("zh");
  expect(html()).toContain("仍然学习");
});

it.each(["en", "zh", "ar"] as const)(
  "lets the selected label wrap instead of cutting it off in %s",
  (language) => {
    setLanguage(language);
    // The default of "Model input" is the longest label, so the default state is the worst case.
    const triggers = [...html().matchAll(/<button[^>]*role="combobox"[^>]*>(<span[^>]*>)/g)];
    expect(triggers).toHaveLength(6);
    for (const [trigger, label] of triggers) {
      expect(label).not.toContain("truncate");
      expect(label).toContain("break-words");
      // A fixed h-9 would clip a label that wraps to a second line.
      expect(trigger).not.toMatch(/class="([^"]* )?h-9[ "]/);
      expect(trigger).toMatch(/class="[^"]*min-h-9/);
    }
  }
);
