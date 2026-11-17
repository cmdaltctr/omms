import { hostLabel, type WebHost } from "$lib/host-label";
import type { StatusText } from "./host-status";
import type { ImportDraft, Readiness } from "./import-types";

const EXTERNAL_REASONS: Record<string, string> = {
  "missing-model":
    "The external API has no model chosen yet. Choose one in the External API settings.",
  "missing-url": "The external API has no web address yet. Add it in the External API settings.",
  "missing-key":
    "OMMS cannot find your external API key. Check the key in the External API settings.",
  "unsupported-provider":
    "This external API provider cannot run imports. Choose another provider in the External API settings.",
};

/** `host` is null when the reason is about the external API, which no single host owns. */
export type ModelBlock = { host: WebHost | null; reason: string };

/**
 * The first host that cannot import for lack of a model, with the English
 * reason (a translation key), or null. A run that records only skill turns
 * calls no model, so it never blocks.
 */
export function modelBlock(
  hosts: readonly WebHost[],
  draft: ImportDraft,
  readiness: Readiness | null
): ModelBlock | null {
  if (!draft.memories && !draft.profile) return null;
  for (const host of hosts) {
    const model = draft.hosts[host].modelChoice;
    let reason: string | null = null;
    let external = false;
    if (!readiness) reason = "Model readiness is unknown. Reload the page.";
    else if (!model)
      reason =
        "No import model is ready. Connect a model in OpenCode or complete the external API settings.";
    else if (model === "external" && readiness.external.state !== "ready") {
      reason = EXTERNAL_REASONS[readiness.external.state] ?? "The external API is not ready";
      external = true;
    } else if (host === "claude-code" && model !== "external")
      reason = "Claude Code imports use the external API. Complete the external API settings.";
    else if (
      model !== "external" &&
      !readiness.opencode.models.some((item) => `${item.provider}/${item.model}` === model)
    )
      reason =
        "No import model is ready. Connect a model in OpenCode or complete the external API settings.";
    if (reason) return { host: external ? null : host, reason };
  }
  return null;
}

/** The first reason a real import cannot start for lack of a model, as text, or null. */
export function modelBlockedReason(
  hosts: readonly WebHost[],
  draft: ImportDraft,
  readiness: Readiness | null,
  s: (message: string) => string
): string | null {
  const block = modelBlock(hosts, draft, readiness);
  if (!block) return null;
  return block.host ? `${hostLabel(block.host)}: ${s(block.reason)}` : s(block.reason);
}

const isListed = (readiness: Readiness | null, model: string) =>
  readiness?.opencode.models.some((item) => `${item.provider}/${item.model}` === model) ?? false;

/**
 * The import model to tick for a host. The web app has no session model, so
 * `inherit` cannot run here. A backfill model that a connected OpenCode lists
 * keeps one model for both imports; anything else uses the saved external API.
 * Claude Code has no host model.
 */
export function defaultImportModel(
  host: WebHost,
  backfillModel: string | null | undefined,
  readiness: Readiness | null
): string {
  if (host === "claude-code" || !backfillModel) return "external";
  return isListed(readiness, backfillModel) ? backfillModel : "external";
}

/**
 * The model line of the import panel. The page writes `Model: {models}`, with
 * the entries joined by a comma, then each note as its own sentence.
 */
export type ModelLine = { models: StatusText[]; notes: StatusText[] };

const NOTE =
  "Automatic import for {host} uses {model}. Change it in the {host} settings card further down the page.";
const INHERIT_NOTE =
  "Automatic import for {host} uses the model of your open {host} session. Change it in the {host} settings card further down the page.";

function externalName(readiness: Readiness | null): string | null {
  if (!readiness) return null;
  const { provider, model } = readiness.external;
  return [provider, model].filter(Boolean).join("/") || null;
}

function modelEntry(choice: string, readiness: Readiness | null): StatusText {
  if (choice === "external") {
    const name = externalName(readiness);
    return name
      ? { text: "Saved external API ({model})", params: { model: name } }
      : { text: "Saved external API" };
  }
  const listed = readiness?.opencode.models.find(
    (item) => `${item.provider}/${item.model}` === choice
  );
  return { text: "{model}", params: { model: listed?.name ?? choice } };
}

/**
 * Name the import model once per distinct choice, and add a note for each host
 * whose automatic import resolves to a different model. `backfill` holds each
 * host's saved backfill model; Claude Code has none and always uses the
 * external API, and a host missing from `backfill` has not loaded yet.
 */
export function importModelLine(
  hosts: readonly WebHost[],
  draft: ImportDraft,
  readiness: Readiness | null,
  backfill: Partial<Record<WebHost, string | null>>
): ModelLine {
  const choices = [...new Set(hosts.map((host) => draft.hosts[host].modelChoice).filter(Boolean))];
  const notes: StatusText[] = [];
  for (const host of hosts) {
    if (host === "claude-code") continue;
    const saved = backfill[host];
    if (!saved) continue;
    const choice = draft.hosts[host].modelChoice;
    if (saved === "inherit") {
      notes.push({ text: INHERIT_NOTE, params: { host: hostLabel(host) } });
      continue;
    }
    if (saved === choice) continue;
    const name = saved === "external" ? externalName(readiness) : saved;
    if (name) notes.push({ text: NOTE, params: { host: hostLabel(host), model: name } });
  }
  return { models: choices.map((choice) => modelEntry(choice, readiness)), notes };
}
