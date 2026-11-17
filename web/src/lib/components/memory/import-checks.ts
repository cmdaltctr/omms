import { hostLabel, type WebHost } from "$lib/host-label";
import type { WriteHealth } from "$lib/write-health-store";
import type { StatusText } from "./host-status";
import { modelBlock } from "./import-model-blocker";
import type { ImportDraft, Readiness } from "./import-types";

/** The result of the one-call model test on this page. Only the external API is tested. */
export type ModelTest = { state: "untested" | "passed" } | { state: "failed"; reason: string };

export type CheckState = "pass" | "fail" | "untested" | "unknown";

export type CheckRow = {
  id: "model" | "memories" | "history" | "profile";
  state: CheckState;
  /** An English key for the translation table, and its values. */
  text: StatusText;
  /** The host a failed Model row is about; the page writes `{host}: {text}`. */
  host?: WebHost;
  /** A second sentence: the hosts left out for no history. */
  note: StatusText | null;
  /** Small secondary text that is not translated, such as an error code. */
  detail?: string;
  /** A link or button the failed row offers. */
  action: { kind: "external-settings" | "recheck"; label: StatusText } | null;
};

export type ImportChecks = { rows: CheckRow[]; blocked: boolean };

const CHECKING: StatusText = { text: "Checking…" };
const row = (
  id: CheckRow["id"],
  state: CheckState,
  text: StatusText,
  rest: Partial<CheckRow> = {}
) => ({ id, state, text, note: null, action: null, ...rest }) satisfies CheckRow;
const EXTERNAL_SETTINGS = {
  kind: "external-settings",
  label: { text: "Open the external API settings" },
} as const;

/** A custom source the user chose counts as history; otherwise the default folder must exist. */
export function hasHistory(host: WebHost, draft: ImportDraft, readiness: Readiness): boolean {
  return draft.hosts[host].source !== null || readiness.defaultSourceFound?.[host] !== false;
}

function historyRow(
  hosts: readonly WebHost[],
  found: readonly WebHost[],
  readiness: Readiness
): CheckRow {
  const names = (list: readonly WebHost[]) => list.map(hostLabel).join(", ");
  // Only the overview leaves a host out. A host view fails instead.
  const leftOut = hosts.length > 1 ? hosts.filter((host) => !found.includes(host)) : [];
  if (found.length === 0) {
    return hosts.length === 1
      ? row("history", "fail", {
          text: "No {host} history found. Install {host} and use it once.",
          params: { host: hostLabel(hosts[0]!) },
        })
      : row("history", "fail", {
          text: "Left out, no history found: {hosts}.",
          params: { hosts: names(leftOut) },
        });
  }
  if (found.includes("pi") && !readiness.piReader.available)
    return row("history", "fail", {
      text: "{host} history could not be read. Untick {host} in Customise.",
      params: { host: hostLabel("pi") },
    });
  return row(
    "history",
    "pass",
    { text: "History found for {hosts}.", params: { hosts: names(found) } },
    leftOut.length
      ? {
          note: {
            text: "Left out, no history found: {hosts}.",
            params: { hosts: names(leftOut) },
          },
        }
      : {}
  );
}

function modelRow(
  chosen: readonly WebHost[],
  draft: ImportDraft,
  readiness: Readiness,
  modelTest: ModelTest
): CheckRow {
  const block = modelBlock(chosen, draft, readiness);
  if (block)
    return row(
      "model",
      "fail",
      { text: block.reason },
      { ...(block.host ? { host: block.host } : {}), action: EXTERNAL_SETTINGS }
    );
  const callsModel = draft.memories || draft.profile;
  // The page test-calls the external API only; a connected OpenCode model is not called.
  const usesExternal =
    callsModel && chosen.some((host) => draft.hosts[host].modelChoice === "external");
  if (usesExternal && modelTest.state === "failed") {
    const failure = testFailure(modelTest.reason);
    return row(
      "model",
      "fail",
      { text: failure.text },
      { action: EXTERNAL_SETTINGS, ...(failure.code ? { detail: failure.code } : {}) }
    );
  }
  if (usesExternal && modelTest.state === "untested")
    return row("model", "untested", { text: "Ready, not tested" });
  return row("model", "pass", { text: "Ready" });
}

/**
 * A plain sentence for a failed model test. The server's reason can hold the raw
 * reply of the model service, so only its HTTP status code is kept, as a detail.
 */
function testFailure(reason: string): { text: string; code: string | null } {
  const code = /\b([45]\d\d)\b/.exec(reason)?.[1] ?? null;
  if (code === "401" || code === "403")
    return {
      text: "The model service did not accept your API key. Check the key in the External API settings.",
      code,
    };
  if (code === "404")
    return {
      text: "The model service could not find this model or address. Check the model and web address in the External API settings.",
      code,
    };
  if (code === "429")
    return {
      text: "The model service is busy or your quota is used up. Try again later.",
      code,
    };
  if (code?.startsWith("5"))
    return { text: "The model service had a problem. Try again later.", code };
  if (code)
    return {
      text: "The test call to your model failed. Check the External API settings.",
      code,
    };
  if (/fetch failed|ECONN|ENOTFOUND|EAI_AGAIN|timed? ?out|timeout|network/i.test(reason))
    return {
      text: "OMMS could not reach the model service. Check the web address and your connection.",
      code: null,
    };
  return {
    text: "The test call to your model failed. Check the External API settings.",
    code: null,
  };
}

/** Profile learning needs an email to name the profile; without one its step fails. */
function profileRow(draft: ImportDraft, readiness: Readiness): CheckRow | null {
  if (!draft.profile || readiness.profileIdentity !== false) return null;
  return row("profile", "fail", {
    text: "Profile learning needs your email address. Set it with {command}, or untick User profile in Customise.",
    params: { command: "git config --global user.email" },
  });
}

function memoriesRow(writeHealth: WriteHealth | null): CheckRow {
  if (!writeHealth) return row("memories", "unknown", CHECKING);
  if (writeHealth.ok) return row("memories", "pass", { text: "Memories can be saved." });
  return row(
    "memories",
    "fail",
    { text: "Memories cannot be saved: {reason}", params: { reason: writeHealth.reason ?? "" } },
    { action: { kind: "recheck", label: { text: "Check again" } } }
  );
}

/**
 * The three checks above the import button. `hosts` are the hosts the panel
 * offers: one on a host view, all of them on the overview. With more than one,
 * a host with no history is left out and named; with one, it fails the check.
 * Only a fail blocks the button. While readiness or write health loads, a row
 * reads unknown and does not block, as the server checks again at start.
 */
export function importChecks(input: {
  hosts: readonly WebHost[];
  draft: ImportDraft;
  readiness: Readiness | null;
  writeHealth: WriteHealth | null;
  modelTest: ModelTest;
}): ImportChecks {
  const { hosts, draft, readiness, writeHealth, modelTest } = input;
  const memories = memoriesRow(writeHealth);
  let rows: CheckRow[];
  if (!readiness) {
    rows = [row("model", "unknown", CHECKING), memories, row("history", "unknown", CHECKING)];
  } else {
    const found = hosts.filter((host) => hasHistory(host, draft, readiness));
    // The model check follows the hosts that stay in. A host view keeps its host, so a
    // missing key still shows when the history check fails as well.
    const profile = profileRow(draft, readiness);
    rows = [
      modelRow(hosts.length > 1 ? found : hosts, draft, readiness, modelTest),
      memories,
      historyRow(hosts, found, readiness),
      ...(profile ? [profile] : []),
    ];
  }
  return { rows, blocked: rows.some((item) => item.state === "fail") };
}
