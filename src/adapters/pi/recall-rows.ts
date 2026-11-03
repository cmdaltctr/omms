import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  buildRecallSummary,
  callTitle,
  unfoldLines,
  type RecallSummary,
} from "../../core/recall-summary.js";
import { log } from "../../services/logger.js";

/**
 * Fold rows for OMMS recalls above the Pi editor (change add-pi-visible-recall, TDR-062).
 *
 * Rows are drawn only in Pi's interactive terminal (`ctx.mode === "tui"`). RPC, JSON and print
 * runs, subagent children among them, record and draw nothing. Summaries and fold state live in
 * memory only: Pi offers no extension store outside the session file, and a session entry would
 * write memory text into the session file. Logs carry the session id, mode and count only.
 */

export const RECALL_WIDGET_KEY = "omms-recall";
/** Latest summaries kept per session. */
export const MAX_RECALL_SUMMARIES = 20;
/** Most rows shown at once. */
export const MAX_RECALL_ROWS = 5;
/** Longest query kept per summary. An unfolded row shows at most 300 characters of it. */
export const MAX_RECALL_QUERY_CHARS = 300;

type Cut = (text: string, width: number) => string;
type Theme = { fg(colour: string, text: string): string };

/** Cut by code point. Used only when Pi's own width helper cannot load. */
function plainCut(text: string, width: number): string {
  const chars = Array.from(text);
  if (chars.length <= width) return text;
  if (width <= 3) return chars.slice(0, Math.max(0, width)).join("");
  return `${chars.slice(0, width - 3).join("")}...`;
}

// Pi resolves its own packages for an extension, so this import works inside Pi without a
// dependency (TDR-062). It stays dynamic so the extension carries no static Pi runtime import.
let cutLoad: Promise<Cut> | undefined;
function loadCut(): Promise<Cut> {
  cutLoad ??= import("@earendil-works/pi-tui").then(
    (tui): Cut =>
      (text, width) =>
        tui.truncateToWidth(text, width),
    (): Cut => plainCut
  );
  return cutLoad;
}

function paint(theme: Theme, text: string): string {
  try {
    return theme.fg("muted", text);
  } catch {
    return text;
  }
}

function errorCode(error: unknown): string {
  return error instanceof Error ? error.name : "unknown";
}

export interface PiRecallRows {
  /** Record the recall of one prompt and redraw. Does nothing outside the interactive terminal. */
  record(
    ctx: ExtensionContext,
    prompt: string,
    section: string | null,
    enabled: boolean
  ): Promise<void>;
  /** `/omms-recall`: unfold every shown row, or fold them all when all are open. */
  toggleAll(ctx: ExtensionContext, enabled: boolean): Promise<void>;
  /** Forget summaries and fold state, and clear the widget. */
  reset(ctx: ExtensionContext): void;
  /** Summaries of the current session, oldest first. */
  summaries(): readonly RecallSummary[];
}

export function createPiRecallRows(): PiRecallRows {
  let sessionID: string | null = null;
  let ring: RecallSummary[] = [];
  let lastSeq = 0;
  const open = new Set<number>();

  const forget = () => {
    sessionID = null;
    ring = [];
    lastSeq = 0;
    open.clear();
  };

  const shown = () => ring.slice(-MAX_RECALL_ROWS);

  const rowLines = (): string[] =>
    shown().flatMap((summary) => {
      const unfolded = open.has(summary.seq ?? 0);
      const title = `${unfolded ? "▾" : "▸"} ● ${callTitle(summary)}`;
      return unfolded ? [title, ...unfoldLines(summary).map((line) => `  ${line}`)] : [title];
    });

  const setWidget = (ctx: ExtensionContext, lines: string[] | undefined, cut: Cut) => {
    try {
      if (!lines) {
        ctx.ui.setWidget(RECALL_WIDGET_KEY, undefined);
        return;
      }
      ctx.ui.setWidget(
        RECALL_WIDGET_KEY,
        (_tui, theme) => ({
          render(width: number): string[] {
            try {
              return lines.map((line) => paint(theme, cut(line, width)));
            } catch {
              return [];
            }
          },
          invalidate() {},
        }),
        { placement: "aboveEditor" }
      );
    } catch (error) {
      log("Pi recall: could not draw rows", { sessionID, code: errorCode(error) }, "error");
    }
  };

  const draw = async (ctx: ExtensionContext, enabled: boolean) => {
    const cut = await loadCut();
    setWidget(ctx, enabled && ring.length > 0 ? rowLines() : undefined, cut);
  };

  return {
    async record(ctx, prompt, section, enabled) {
      try {
        if (ctx.mode !== "tui" || !section) return;
        const built = buildRecallSummary(
          section,
          "search",
          prompt.slice(0, MAX_RECALL_QUERY_CHARS)
        );
        if (!built) return;
        const id = ctx.sessionManager.getSessionId();
        if (id !== sessionID) {
          forget();
          sessionID = id;
        }
        const summary: RecallSummary = { ...built, seq: ++lastSeq };
        ring = [...ring, summary].slice(-MAX_RECALL_SUMMARIES);
        for (const seq of open) if (!ring.some((kept) => kept.seq === seq)) open.delete(seq);
        log("Pi recall: summary recorded", {
          sessionID: id,
          mode: summary.mode,
          count: summary.items.length,
        });
        await draw(ctx, enabled);
      } catch (error) {
        log("Pi recall: could not record summary", { sessionID, code: errorCode(error) }, "error");
      }
    },

    async toggleAll(ctx, enabled) {
      try {
        if (ctx.mode !== "tui") return;
        const seqs = shown().map((summary) => summary.seq ?? 0);
        const unfold = seqs.some((seq) => !open.has(seq));
        for (const seq of seqs) {
          if (unfold) open.add(seq);
          else open.delete(seq);
        }
        await draw(ctx, enabled);
      } catch (error) {
        log("Pi recall: could not toggle rows", { sessionID, code: errorCode(error) }, "error");
      }
    },

    reset(ctx) {
      const hadRows = ring.length > 0;
      forget();
      try {
        if (hadRows && ctx.mode === "tui") ctx.ui.setWidget(RECALL_WIDGET_KEY, undefined);
      } catch (error) {
        log("Pi recall: could not clear rows", { code: errorCode(error) }, "error");
      }
    },

    summaries: () => ring,
  };
}
