import type { DatabaseSync } from "node:sqlite";
import { boundToolInput, readToolPath } from "../core/tool-input.js";
import { opencodeMemorise, opencodeToolOutcome } from "../core/tool-outcome.js";
import type { ImportWindow } from "./importer.js";

/**
 * Work units from the OpenCode 2.x tables. `session_message` keeps each
 * message's content inside its `data` JSON, and `session_part` stays empty.
 */

interface V2MessageRow {
  id: string;
  type: string;
  time_created: number;
  data: string;
}

/** The part of the reader filters that decides which user messages start a unit. */
interface V2UnitFilters {
  since?: number;
  until?: number;
}

function parseRecord(json: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(json);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function formatInput(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value ?? "");
}

function toolCall(item: Record<string, unknown>): ImportWindow["toolCalls"][number] {
  const state =
    item.state && typeof item.state === "object" ? (item.state as Record<string, unknown>) : {};
  const name = String(item.name ?? item.type);
  const args = state.input ?? "";
  const path = readToolPath(name, args);
  return {
    name,
    input: boundToolInput(formatInput(args)),
    ...opencodeToolOutcome(state),
    ...opencodeMemorise(name, args, state),
    ...(path === undefined ? {} : { path }),
  };
}

/**
 * A `user` message starts a unit. A `synthetic` or `compaction` message ends
 * the current unit and starts none, so OMMS context and compaction summaries
 * never become prompts and later assistant messages do not join the old unit.
 * `assistant` messages add `text` replies and `tool` calls; every other
 * message type is ignored.
 */
export function buildV2Windows(
  db: DatabaseSync,
  sessionId: string,
  filters: V2UnitFilters
): ImportWindow[] {
  const messages = db
    .prepare(
      "SELECT id, type, time_created, data FROM session_message WHERE session_id = ? ORDER BY time_created, id"
    )
    .all(sessionId) as unknown as V2MessageRow[];
  const units: ImportWindow[] = [];
  let current: ImportWindow | null = null;
  const finish = () => {
    if (current?.sourceEntryIds?.length) units.push(current);
    current = null;
  };
  for (const message of messages) {
    if (message.type === "user") {
      finish();
      const text = parseRecord(message.data).text;
      const prompt = typeof text === "string" ? text.trim() : "";
      const timestamp = Number(message.time_created);
      if (
        prompt &&
        (filters.since === undefined || timestamp >= filters.since) &&
        (filters.until === undefined || timestamp <= filters.until)
      ) {
        current = {
          userEntryId: message.id,
          userPrompt: prompt,
          userTimestamp: timestamp,
          sourceTimestamp: timestamp,
          textResponses: [],
          toolCalls: [],
          sourceEntryIds: [],
        };
      }
      continue;
    }
    if (message.type === "synthetic" || message.type === "compaction") {
      finish();
      continue;
    }
    if (message.type !== "assistant" || !current) continue;
    current.sourceEntryIds!.push(message.id);
    const content = parseRecord(message.data).content;
    if (!Array.isArray(content)) continue;
    for (const item of content) {
      if (!item || typeof item !== "object") continue;
      const entry = item as Record<string, unknown>;
      if (entry.type === "text" && typeof entry.text === "string") {
        current.textResponses.push(entry.text);
      } else if (entry.type === "tool") {
        current.toolCalls.push(toolCall(entry));
      }
    }
  }
  finish();
  return units;
}
