import type { MemoryHost } from "../types/index.js";
import type { ImportWindow } from "./importer.js";
import type { ImportLedgerRow, PiImportLedger } from "./ledger.js";

/**
 * How a host finds a ledger row that already handled a unit. The default is
 * the exact key. OpenCode matches a session and user message with any last
 * answer id: the answer ids of old imports no longer exist in the database,
 * and the 2.x tables can give a unit another last answer.
 */
export type HandledLookup = (
  ledger: PiImportLedger,
  query: { key: string; sessionId: string; window: ImportWindow; readOnly: boolean }
) => Promise<ImportLedgerRow | null>;

const exactKeyLookup: HandledLookup = (ledger, { key, readOnly }) =>
  readOnly ? ledger.peek(key) : ledger.get(key);

const HANDLED_LOOKUPS: Partial<Record<MemoryHost, HandledLookup>> = {
  opencode: async (ledger, query) => {
    const exact = await exactKeyLookup(ledger, query);
    if (exact?.status === "imported" || exact?.status === "skipped") return exact;
    return (
      (await ledger.findHandledByPrefix(
        query.sessionId,
        `opencode:${query.sessionId}:${query.window.userEntryId}:`,
        { readOnly: query.readOnly }
      )) ?? exact
    );
  },
};

/** The lookup for a host, chosen once per import run. */
export function handledLookupFor(host: MemoryHost): HandledLookup {
  return HANDLED_LOOKUPS[host] ?? exactKeyLookup;
}
