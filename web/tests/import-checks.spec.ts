import { expect, it } from "bun:test";
import { importChecks, type ModelTest } from "../src/lib/components/memory/import-checks";
import { initialImportDraft } from "../src/lib/components/memory/import-draft";
import type { Readiness } from "../src/lib/components/memory/import-types";
import type { WebHost } from "../src/lib/host-label";

const GOOD_WRITE = { ok: true, reason: null, checkedAt: 1 };
const UNTESTED: ModelTest = { state: "untested" };

function readiness(patch: Partial<Readiness> = {}): Readiness {
  return {
    external: { state: "ready", provider: "deepseek", model: "deepseek-flash" },
    opencode: { available: true, models: [] },
    piReader: { available: true },
    defaultSourceFound: { pi: true, opencode: true, "claude-code": true },
    ...patch,
  };
}

function run(
  hosts: WebHost[],
  patch: {
    readiness?: Readiness | null;
    writeHealth?:
      typeof GOOD_WRITE | null | { ok: false; reason: string | null; checkedAt: number };
    modelTest?: ModelTest;
    draft?: ReturnType<typeof initialImportDraft>;
  } = {}
) {
  return importChecks({
    hosts,
    draft: patch.draft ?? initialImportDraft(),
    readiness: patch.readiness === undefined ? readiness() : patch.readiness,
    writeHealth: patch.writeHealth === undefined ? GOOD_WRITE : patch.writeHealth,
    modelTest: patch.modelTest ?? UNTESTED,
  });
}
const row = (result: ReturnType<typeof run>, id: "model" | "memories" | "history") =>
  result.rows.find((item) => item.id === id)!;

it("reads three rows and is not blocked when every check passes", () => {
  const result = run(["pi"], { modelTest: { state: "passed" } });
  expect(result.rows.map((item) => item.id)).toEqual(["model", "memories", "history"]);
  expect(result.rows.map((item) => item.state)).toEqual(["pass", "pass", "pass"]);
  expect(result.blocked).toBe(false);
});

it("reads a ready external model that was not tested as untested, and does not block", () => {
  const result = run(["pi"]);
  expect(row(result, "model")).toMatchObject({
    state: "untested",
    text: { text: "Ready, not tested" },
  });
  expect(result.blocked).toBe(false);
});

it("does not call a connected OpenCode model untested, because the page never test-calls it", () => {
  const draft = initialImportDraft();
  draft.hosts.pi.modelChoice = "anthropic/claude-sonnet";
  const models = [{ provider: "anthropic", model: "claude-sonnet", name: "Claude Sonnet" }];
  const result = run(["pi"], {
    draft,
    readiness: readiness({ opencode: { available: true, models } }),
  });
  expect(row(result, "model").state).toBe("pass");
});

it("fails the model row when the external API key is missing, and links the external settings", () => {
  const result = run(["claude-code"], {
    readiness: readiness({
      external: { state: "missing-key", provider: "deepseek", model: "deepseek-flash" },
    }),
  });
  const model = row(result, "model");
  expect(model.state).toBe("fail");
  // The key belongs to the external API, not to a host, so the row names no host.
  expect(model.host).toBeUndefined();
  expect(model.text.text).toBe(
    "OMMS cannot find your external API key. Check the key in the External API settings."
  );
  expect(model.text.text).not.toMatch(/memoryApiKey|env:\/\/|file:\/\/|OpenCode/);
  expect(model.action).toEqual({
    kind: "external-settings",
    label: { text: "Open the external API settings" },
  });
  expect(result.blocked).toBe(true);
});

it("fails the model row when the model test failed, in a plain sentence with the code apart", () => {
  const reason = 'API error: 401 - {"error":{"message":"Invalid API key"}}';
  const result = run(["pi"], { modelTest: { state: "failed", reason } });
  expect(row(result, "model")).toMatchObject({
    state: "fail",
    text: {
      text: "The model service did not accept your API key. Check the key in the External API settings.",
    },
    detail: "401",
  });
  // No raw reply reaches the page: the row has no params to carry it.
  expect(row(result, "model").text.params).toBeUndefined();
  expect(result.blocked).toBe(true);
});

it("names each kind of failed model test in plain words", () => {
  const text = (reason: string) =>
    row(run(["pi"], { modelTest: { state: "failed", reason } }), "model").text.text;
  expect(text("API error: 404 - not found")).toContain("could not find this model");
  expect(text("API error: 429 - slow down")).toContain("busy");
  expect(text("API error: 503 - down")).toContain("had a problem");
  expect(text("fetch failed: ECONNREFUSED")).toContain("could not reach the model service");
  expect(text("The operation timed out")).toContain("could not reach the model service");
  expect(text("something odd")).toBe(
    "The test call to your model failed. Check the External API settings."
  );
});

it("fails a Profile row before a run when profile learning has no email to name the profile", () => {
  const result = run(["pi"], { readiness: readiness({ profileIdentity: false }) });
  expect(row(result, "profile" as never)).toMatchObject({
    state: "fail",
    text: {
      text: "Profile learning needs your email address. Set it with {command}, or untick User profile in Customise.",
      params: { command: "git config --global user.email" },
    },
  });
  expect(result.blocked).toBe(true);
  // With the profile step off, or an email known, there is no Profile row.
  const draft = initialImportDraft();
  draft.profile = false;
  const off = run(["pi"], { readiness: readiness({ profileIdentity: false }), draft });
  expect(off.rows.map((item) => item.id)).toEqual(["model", "memories", "history"]);
  expect(run(["pi"]).rows.map((item) => item.id)).toEqual(["model", "memories", "history"]);
});

it("ignores a failed model test when no chosen host uses the external API", () => {
  const draft = initialImportDraft();
  draft.hosts.pi.modelChoice = "anthropic/claude-sonnet";
  const models = [{ provider: "anthropic", model: "claude-sonnet", name: "Claude Sonnet" }];
  const result = run(["pi"], {
    draft,
    readiness: readiness({ opencode: { available: true, models } }),
    modelTest: { state: "failed", reason: "old failure" },
  });
  expect(row(result, "model").state).toBe("pass");
});

it("needs no model when only skill turns are recorded", () => {
  const draft = initialImportDraft();
  draft.memories = false;
  draft.profile = false;
  const result = run(["pi"], {
    draft,
    readiness: readiness({ external: { state: "missing-key", provider: "", model: null } }),
  });
  expect(row(result, "model").state).toBe("pass");
  expect(result.blocked).toBe(false);
});

it("reads unknown, and does not block, while readiness and write health still load", () => {
  const result = run(["pi"], { readiness: null, writeHealth: null });
  expect(result.rows.map((item) => item.state)).toEqual(["unknown", "unknown", "unknown"]);
  expect(result.rows.every((item) => item.text.text === "Checking…")).toBe(true);
  expect(result.blocked).toBe(false);
});

it("fails Memories saving with the reason and a Check again action", () => {
  const result = run(["pi"], {
    writeHealth: { ok: false, reason: "The disk is full", checkedAt: 1 },
  });
  expect(row(result, "memories")).toMatchObject({
    state: "fail",
    text: { text: "Memories cannot be saved: {reason}", params: { reason: "The disk is full" } },
    action: { kind: "recheck", label: { text: "Check again" } },
  });
  expect(result.blocked).toBe(true);
});

it("fails History found for a host view whose history is missing", () => {
  const result = run(["opencode"], {
    readiness: readiness({
      defaultSourceFound: { pi: true, opencode: false, "claude-code": true },
    }),
  });
  expect(row(result, "history")).toMatchObject({
    state: "fail",
    text: {
      text: "No {host} history found. Install {host} and use it once.",
      params: { host: "OpenCode" },
    },
  });
  expect(result.blocked).toBe(true);
});

it("counts a chosen custom source as history found", () => {
  const draft = initialImportDraft();
  draft.hosts.opencode.source = { sourceToken: "t", displayPath: "/x" } as never;
  const result = run(["opencode"], {
    draft,
    readiness: readiness({
      defaultSourceFound: { pi: true, opencode: false, "claude-code": true },
    }),
  });
  expect(row(result, "history").state).toBe("pass");
});

it("leaves out hosts with no history on the overview and names them", () => {
  const result = run(["pi", "opencode", "claude-code"], {
    readiness: readiness({
      defaultSourceFound: { pi: true, opencode: false, "claude-code": true },
    }),
  });
  const history = row(result, "history");
  expect(history.state).toBe("pass");
  expect(history.text).toEqual({
    text: "History found for {hosts}.",
    params: { hosts: "Pi, Claude Code" },
  });
  expect(history.note).toEqual({
    text: "Left out, no history found: {hosts}.",
    params: { hosts: "OpenCode" },
  });
  expect(result.blocked).toBe(false);
});

it("checks the model of the hosts that stay in, not of a host left out", () => {
  const draft = initialImportDraft();
  draft.hosts.opencode.modelChoice = "";
  const result = run(["pi", "opencode"], {
    draft,
    readiness: readiness({
      defaultSourceFound: { pi: true, opencode: false, "claude-code": true },
    }),
  });
  expect(row(result, "model").state).not.toBe("fail");
});

it("fails History found when the overview finds no history at all", () => {
  const none = { pi: false, opencode: false, "claude-code": false };
  const result = run(["pi", "opencode", "claude-code"], {
    readiness: readiness({ defaultSourceFound: none }),
  });
  expect(row(result, "history")).toMatchObject({
    state: "fail",
    text: {
      text: "Left out, no history found: {hosts}.",
      params: { hosts: "Pi, OpenCode, Claude Code" },
    },
  });
  expect(result.blocked).toBe(true);
});

it("fails History found for a Pi whose reader is missing, on the host view and the overview", () => {
  const broken = readiness({ piReader: { available: false, reason: "no reader" } });
  for (const hosts of [["pi"], ["pi", "claude-code"]] as WebHost[][]) {
    const result = run(hosts, { readiness: broken });
    expect(row(result, "history")).toMatchObject({
      state: "fail",
      text: {
        text: "{host} history could not be read. Untick {host} in Customise.",
        params: { host: "Pi" },
      },
    });
    expect(result.blocked).toBe(true);
  }
});

it("does not check the Pi reader when Pi is not chosen", () => {
  const broken = readiness({ piReader: { available: false } });
  expect(row(run(["opencode"], { readiness: broken }), "history").state).toBe("pass");
});

it("blocks only on a fail, never on untested or unknown", () => {
  expect(run(["pi"], { writeHealth: null }).blocked).toBe(false);
  expect(run(["pi"]).blocked).toBe(false);
  expect(run(["pi"], { writeHealth: { ok: false, reason: null, checkedAt: 1 } }).blocked).toBe(
    true
  );
});
