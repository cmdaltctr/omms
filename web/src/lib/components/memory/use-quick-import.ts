import { useEffect, useRef, useState } from "react";
import type { WebHost } from "$lib/host-label";
import { settingsRequest } from "$lib/settings-api";
import { hasHistory, type ModelTest } from "./import-checks";
import { applyDraftChange, groupRequest, listRequestFields, membership } from "./import-draft";
import {
  hostsWithWork,
  importEstimate,
  nothingToImport,
  type ImportEstimate,
  type RunsByHost,
} from "./import-estimate";
import type { ImportDraft, ImportJob, Readiness, SessionPage } from "./import-types";
import type { ImportJobState } from "./use-import-job";

/**
 * The model test results for this page load, one per external model (provider,
 * model and URL; never the key). They live outside the component, so a second
 * host view or a remount does not pay for a second test call of the same model,
 * and a model changed in Settings counts as untested.
 */
const pageModelTests = new Map<string, ModelTest>();
const UNTESTED: ModelTest = { state: "untested" };

/** Start a fresh page load's model test state. Specs call this between cases. */
export function forgetModelTest(): void {
  pageModelTests.clear();
}

/** The test result for the external model `key` names, untested when there is none. */
export function modelTestFor(key: string): ModelTest {
  return pageModelTests.get(key) ?? UNTESTED;
}

const ENDED = ["done", "failed", "cancelled"];
const STALE = "The session list is out of date.";
export const STALE_AGAIN = "The chat list changed while checking. Try again.";
export const NOTHING_NEW = "Nothing new to import";
/** The line after Import was refused twice as out of date; it names the page's primary button. */
export const NEW_CHATS = {
  "Import new chats": "New chats appeared. Select Import new chats again.",
  "Import all hosts": "New chats appeared. Select Import all hosts again.",
} as const;

export type QuickPhase = "idle" | "testing" | "listing" | "previewing";
/**
 * The question the confirm dialog asks, with the exact request it will send.
 * `again` is true when it follows a real start the server refused as out of date.
 */
export type Confirm = {
  estimate: ImportEstimate;
  hosts: WebHost[];
  /** The hosts the preview found work for, which the dialog names. */
  from: WebHost[];
  draft: ImportDraft;
  again: boolean;
};

/** Only these hosts take part: the rest stay ticked in the draft, but out of this request. */
function only(draft: ImportDraft, hosts: readonly WebHost[]): ImportDraft {
  const next = { ...draft, hosts: { ...draft.hosts } };
  for (const host of Object.keys(next.hosts) as WebHost[])
    next.hosts[host] = { ...next.hosts[host], enabled: hosts.includes(host) };
  return next;
}

/** A selection the user made by hand in Customise is used as it is; anything else is listed again. */
function handPicked(draft: ImportDraft, host: WebHost): boolean {
  const child = draft.hosts[host];
  if (!child.page || child.listedWith !== membership(draft, host)) return false;
  return child.selection.mode === "ids"
    ? child.selection.picked.size > 0
    : child.selection.excluded.size > 0;
}

/** The first host error or blocker of a preview, else its group error. */
function previewProblem(job: ImportJob): string | null {
  const child = job.hosts?.find((item) => item.error || item.blocker);
  return child?.error ?? child?.blocker ?? job.error ?? null;
}

/**
 * The one-button import: test the external API once per page load, list each
 * host's sessions, preview every session not yet handled, then ask. Nothing is
 * imported until the user confirms in the dialog.
 */
export function useQuickImport(input: {
  draft: ImportDraft;
  /** Keep the lists the flow made in the shared draft, so Customise shows them. */
  keepLists: (listed: ImportDraft, hosts: readonly WebHost[]) => void;
  runs: RunsByHost;
  jobs: ImportJobState;
  /** The external model now saved: provider, model and URL. A test result counts for it only. */
  modelKey: string;
  /** The page's primary button, which the out-of-date line tells the user to select again. */
  button: keyof typeof NEW_CHATS;
}) {
  const { runs, jobs, modelKey } = input;
  const [phase, setPhase] = useState<QuickPhase>("idle");
  const [notice, setNotice] = useState("");
  // Bumped after a test call, so the page reads the new result.
  const [, setTested] = useState(0);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  // Set at once on a click, so a second click in the same render starts nothing.
  const active = useRef(false);
  // The preview this flow waits for, the request it sent, and whether it listed again already.
  const pending = useRef<{
    id: string;
    draft: ImportDraft;
    hosts: WebHost[];
    retried: boolean;
    again: boolean;
  } | null>(null);
  const draftRef = useRef(input.draft);
  draftRef.current = input.draft;

  function idle() {
    active.current = false;
    setPhase("idle");
  }

  function ask(job: ImportJob, draft: ImportDraft, hosts: WebHost[], again = false) {
    const from = hostsWithWork(job);
    setConfirm({
      estimate: importEstimate(job, runs),
      hosts,
      from: from.length ? from : hosts,
      draft,
      again,
    });
  }

  async function testModel(draft: ImportDraft, hosts: readonly WebHost[]): Promise<boolean> {
    const callsModel = draft.memories || draft.profile;
    // A connected OpenCode model is listed by the live OpenCode server, so it is not test-called.
    const external =
      callsModel && hosts.some((host) => draft.hosts[host].modelChoice === "external");
    if (!external) return true;
    const key = modelKey;
    const known = modelTestFor(key);
    if (known.state !== "untested") return known.state === "passed";
    setPhase("testing");
    let result: ModelTest;
    try {
      const reply = await settingsRequest<{ ok: boolean; error?: string }>(
        "/api/settings/external-api/test",
        { method: "POST", body: "{}" }
      );
      result = reply.ok
        ? { state: "passed" }
        : { state: "failed", reason: reply.error ?? "The external API call failed" };
    } catch (cause) {
      result = { state: "failed", reason: (cause as Error).message };
    }
    pageModelTests.set(key, result);
    if (jobs.mounted.current) setTested((count) => count + 1);
    return result.state === "passed";
  }

  async function list(draft: ImportDraft, host: WebHost): Promise<ImportDraft> {
    const child = draft.hosts[host];
    const page = await settingsRequest<SessionPage>("/api/settings/imports/sessions", {
      method: "POST",
      body: JSON.stringify(listBody(draft, host, 0, true)),
    });
    const listed = {
      ...child,
      page,
      listedWith: membership(draft, host),
      selection: { mode: "all" as const, excluded: new Set<string>() },
    };
    return { ...draft, hosts: { ...draft.hosts, [host]: listed } };
  }

  /**
   * List and preview `hosts`. It never throws: a failure ends the flow and shows
   * its reason. `again` marks a preview that follows a refused real start.
   * Only a re-analyse from Customise (`forced`) keeps the draft's force; the
   * primary button never imports handled chats again.
   */
  async function preview(
    hosts: WebHost[],
    retried: boolean,
    relist: boolean,
    again = false,
    forced = false
  ) {
    setPhase("listing");
    try {
      let draft = draftRef.current;
      if (!forced && draft.force) draft = applyDraftChange(draft, { force: false });
      for (const host of hosts)
        if (relist || !handPicked(draft, host)) draft = await list(draft, host);
      input.keepLists(draft, hosts);
      const request = only(draft, hosts);
      setPhase("previewing");
      const job = await jobs.post(() => groupRequest(request, true));
      pending.current = { id: job.id, draft: request, hosts, retried, again };
      finish(job);
    } catch (cause) {
      const message = (cause as Error).message;
      if (message.includes(STALE) && !retried) return preview(hosts, true, true, again, forced);
      idle();
      if (jobs.mounted.current) jobs.setError(message.includes(STALE) ? STALE_AGAIN : message);
    }
  }

  /** Read an ended preview: ask, say there is nothing new, or show what went wrong. */
  function finish(job: ImportJob) {
    const wait = pending.current;
    if (!wait || job.id !== wait.id || !ENDED.includes(job.state)) return;
    pending.current = null;
    const problem = previewProblem(job);
    if (problem?.includes(STALE) && !wait.retried) {
      void preview(wait.hosts, true, true, wait.again, wait.draft.force);
      return;
    }
    idle();
    if (job.state === "cancelled") return;
    if (problem) jobs.setError(problem.includes(STALE) ? STALE_AGAIN : problem);
    else if (nothingToImport(job)) setNotice(NOTHING_NEW);
    else ask(job, wait.draft, wait.hosts, wait.again);
  }

  // A preview that is still running ends through the job poll.
  useEffect(() => {
    if (jobs.job) finish(jobs.job);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reacts to a new job reply only
  }, [jobs.job]);

  /**
   * Run the quick flow for `hosts`. `relist` lists every host again, as Retry
   * failed does after a run, so the new listing time takes in newer turns.
   */
  async function start(hosts: WebHost[], relist = false) {
    if (active.current || jobs.submitting.current || hosts.length === 0) return;
    active.current = true;
    setNotice("");
    jobs.setError("");
    const draft = draftRef.current;
    if (!(await testModel(draft, hosts))) {
      idle();
      return;
    }
    await preview(hosts, false, relist);
  }

  /** Customise: ask about the preview the user ran by hand. */
  function askAbout(job: ImportJob, draft: ImportDraft, hosts: WebHost[]) {
    setNotice("");
    ask(job, draft, hosts);
  }

  /** The dialog's Import: send the previewed request for real. Resolves null once it started. */
  async function confirmImport(): Promise<string | null> {
    if (!confirm) return null;
    try {
      await jobs.post(() => groupRequest(confirm.draft, false));
      return null;
    } catch (cause) {
      const message = (cause as Error).message;
      if (!message.includes(STALE)) return message;
      // New chats came in after the preview. Close the dialog and preview once more, so
      // the dialog opens again with the new numbers; a second refusal ends in one line.
      setConfirm(null);
      if (confirm.again) jobs.setError(NEW_CHATS[input.button]);
      else if (!active.current) {
        active.current = true;
        void preview(confirm.hosts, false, false, true, confirm.draft.force);
      }
      return null;
    }
  }

  return {
    phase,
    notice,
    modelTest: modelTestFor(modelKey),
    confirm,
    start,
    askAbout,
    confirmImport,
    closeConfirm: () => setConfirm(null),
  };
}

/** The session-list request for one page of a host's sessions. Saved maps apply on the server. */
export function listBody(draft: ImportDraft, host: WebHost, offset: number, refresh: boolean) {
  const source = draft.hosts[host].source;
  return {
    host,
    ...(source ? { source: source.sourceToken } : {}),
    scope: draft.scope,
    ...(draft.scope === "current-project" && draft.project ? { project: draft.project } : {}),
    pathMaps: [],
    offset,
    limit: 50,
    refresh,
    ...listRequestFields(draft),
  };
}

/** The hosts of a panel that have history here; the rest are left out and named by the checklist. */
export function hostsWithHistory(
  hosts: readonly WebHost[],
  draft: ImportDraft,
  readiness: Readiness | null
): WebHost[] {
  return readiness ? hosts.filter((host) => hasHistory(host, draft, readiness)) : [...hosts];
}

/** Sessions a page or a preview left out because their project folder is missing, per host. */
export function missingFolders(
  hosts: readonly WebHost[],
  draft: ImportDraft,
  job: ImportJob | null
): { host: WebHost; count: number }[] {
  return hosts
    .map((host) => {
      const child = job?.hosts?.find((item) => item.host === host);
      const page = draft.hosts[host].page;
      const count = child?.summary?.unresolved ?? (page ? page.unresolvedCount : 0);
      return { host, count };
    })
    .filter((item) => item.count > 0);
}
