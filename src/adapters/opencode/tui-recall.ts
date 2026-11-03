import { callTitle, unfoldLines, type RecallSummary } from "../../core/recall-summary.js";
import { recallRpc } from "../../v2/recall-rpc.js";

/**
 * Fold rows for OMMS recalls in the OpenCode terminal TUI (TDR-060). The TUI entry (`opencode/tui.tsx`)
 * passes its host pieces in, so this module never imports a host SDK, storage, capture or config. Every
 * host call sits behind a guard: a missing RPC handler, a failing storage call or a throwing render
 * draws nothing for that part and never throws into the host. Nothing here logs: memory text must not
 * reach a log.
 */

/** Most rows shown at once. Older summaries of the session are dropped from the view. */
export const MAX_ROWS = 5;
const FOLD_STORE_KEY = "omms.recall.fold";
const SLOT = "session.composer.top";
const DEFAULT_DEBOUNCE_MS = 150;

/**
 * Host events that pull the recall list. The server records a recall when a model step starts (the
 * `context` hook), so only the events around a step, plus session creation and view changes, can
 * coincide with a new recall. The end events catch a missed `recalled` push right after the step.
 * The failure events are end events too: the summary is recorded in the `context` hook after
 * `session.step.started` fires, so if the push is absent and the step then fails, no later event
 * in this set would pull it.
 * Streaming, part, message, inbox and instruction events fire dozens of times per reply and never
 * change the list, so they must stay out of this set.
 */
const PULL_EVENT_TYPES: ReadonlySet<string> = new Set([
  "session.created",
  "session.viewed",
  "session.execution.started",
  "session.step.started",
  "session.step.ended",
  "session.execution.succeeded",
  "session.step.failed",
  "session.execution.failed",
]);

/** Persisted fold state: only open rows are stored, keyed by `rowKey`. */
export interface FoldState {
  open: Record<string, boolean>;
}

/** The slice of `ctx.client.rpc(recallRpc)` this module uses. */
export interface RecallRpcClient {
  list(input: { sessionID: string }): Promise<{ enabled: boolean; items: RecallSummary[] }>;
  events: { on(name: string, handler: (event: any) => void): unknown };
}

export interface TuiRecallDeps {
  client: { rpc(definition: unknown): RecallRpcClient };
  data: { listen(handler: (event: any) => void): unknown };
  ui: {
    slot(spec: { append: string; render: (input: { sessionID?: string }) => unknown }): unknown;
  };
  keymap: { layer(factory: () => unknown): unknown };
  storage: {
    store(
      key: string,
      options: { initial: FoldState }
    ): [FoldState, (change: (draft: FoldState) => void) => unknown];
  };
  createSignal: <T>(value: T) => [() => T, (next: T | ((previous: T) => T)) => unknown];
  jsx: (tag: string, props: Record<string, unknown>) => unknown;
  /** Theme colour for row text; read on each paint. */
  muted: () => unknown;
  /** Quiet period that collapses a burst of host events into one `list` call. */
  debounceMs?: number;
}

interface Row {
  key: string;
  summary: RecallSummary;
}

interface SessionState {
  enabled: boolean;
  summaries: RecallSummary[];
  timer?: ReturnType<typeof setTimeout>;
  inflight: boolean;
  dirty: boolean;
}

function isSummary(value: unknown): value is RecallSummary {
  const v = value as Partial<RecallSummary> | null;
  return (
    !!v &&
    (v.mode === "search" || v.mode === "recent") &&
    Array.isArray(v.items) &&
    v.items.every((item) => !!item && typeof item.headline === "string")
  );
}

/** FNV-1a, 32 bit: short, deterministic, no crypto needed for a fold key. */
function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

/**
 * Stable per-summary key: the session id, a hash of mode, query and each memory's id (or headline
 * when it has none), and a counter for identical summaries. It does not use the ring index, so the
 * key survives the ring dropping older entries.
 */
export function rowKeys(sessionID: string, summaries: RecallSummary[]): string[] {
  const seen = new Map<string, number>();
  return summaries.map((summary) => {
    const body = [
      summary.mode,
      summary.query ?? "",
      ...summary.items.map((item) => item.id ?? item.headline),
    ].join("\u0000");
    const base = `${sessionID}:${hash(body)}`;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}#${count}`;
  });
}

function guard<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

function release(handle: unknown): void {
  if (typeof handle === "function") guard(() => (handle as () => void)());
}

/**
 * Draw one fold row per recall summary of the session in view. Returns a stop function that removes
 * every hook it added.
 */
export function startTuiRecall(deps: TuiRecallDeps): () => void {
  const debounceMs = deps.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const sessions = new Map<string, SessionState>();
  const local = new Map<string, boolean>();
  let lastViewed: string | undefined;
  let stopped = false;
  let layerHandle: unknown;

  // Two signals: the list changes when summaries arrive, the text changes when a row folds.
  const [listRevision, setListRevision] = deps.createSignal(0);
  const [foldRevision, setFoldRevision] = deps.createSignal(0);
  const repaintList = () => void guard(() => setListRevision((n) => n + 1));
  const repaintFold = () => void guard(() => setFoldRevision((n) => n + 1));

  const rpc = guard(() => deps.client.rpc(recallRpc));
  const fold = guard(() => deps.storage.store(FOLD_STORE_KEY, { initial: { open: {} } }));

  const sessionState = (id: string): SessionState => {
    let state = sessions.get(id);
    if (!state) {
      state = { enabled: false, summaries: [], inflight: false, dirty: false };
      sessions.set(id, state);
    }
    return state;
  };

  const apply = (id: string, enabled: boolean, summaries: RecallSummary[]) => {
    const state = sessionState(id);
    state.enabled = enabled;
    state.summaries = summaries;
    repaintList();
  };

  async function pull(id: string): Promise<void> {
    const state = sessionState(id);
    state.inflight = true;
    try {
      const reply = await rpc!.list({ sessionID: id });
      if (stopped) return;
      const ok = reply?.enabled === true && Array.isArray(reply.items);
      apply(id, ok, ok ? reply.items.filter(isSummary) : []);
    } catch {
      if (!stopped) apply(id, false, []);
    } finally {
      state.inflight = false;
      if (state.dirty && !stopped) {
        state.dirty = false;
        request(id, debounceMs);
      }
    }
  }

  /** At most one `list` per session per window; a request during a call asks for one more after it. */
  function request(id: string, delayMs: number): void {
    if (stopped || !rpc) return;
    const state = sessionState(id);
    if (state.timer) return;
    if (state.inflight) {
      state.dirty = true;
      return;
    }
    state.timer = setTimeout(() => {
      state.timer = undefined;
      void pull(id);
    }, delayMs);
    (state.timer as { unref?: () => void }).unref?.();
  }

  const isOpen = (key: string): boolean =>
    local.get(key) ?? guard(() => fold?.[0]?.open?.[key] === true) ?? false;

  const persist = (changes: Array<[string, boolean]>) => {
    if (!fold) return;
    guard(() => {
      const done = fold[1]((draft) => {
        draft.open ??= {};
        for (const [key, open] of changes) {
          if (open) draft.open[key] = true;
          else delete draft.open[key];
        }
      });
      Promise.resolve(done).catch(() => undefined);
    });
  };

  const rowsFor = (id: string): Row[] => {
    const state = sessions.get(id);
    if (!state?.enabled || state.summaries.length === 0) return [];
    const keys = rowKeys(id, state.summaries);
    return state.summaries
      .map((summary, index) => ({ key: keys[index]!, summary }))
      .slice(-MAX_ROWS);
  };

  const toggle = (key: string) => {
    const next = !isOpen(key);
    local.set(key, next);
    persist([[key, next]]);
    repaintFold();
  };

  const toggleAll = () => {
    if (!lastViewed) return;
    const rows = rowsFor(lastViewed);
    const target = rows.some((row) => !isOpen(row.key));
    for (const row of rows) local.set(row.key, target);
    persist(rows.map((row): [string, boolean] => [row.key, target]));
    repaintFold();
  };

  // The host owns a keymap layer through the component that created it and removes it when that
  // component is disposed. A slot remount therefore needs a fresh layer, so this runs once per render.
  const registerCommand = () => {
    layerHandle = guard(() =>
      deps.keymap.layer(() => ({
        mode: "global",
        commands: [
          {
            id: "omms.recall.fold",
            title: "Toggle OMMS recall rows",
            palette: true,
            slash: { name: "omms-recall" },
            run: () => void guard(toggleAll),
          },
        ],
      }))
    );
  };

  const drawRow = ({ key, summary }: Row) =>
    deps.jsx("box", {
      flexDirection: "column",
      onMouseDown: () => void guard(() => toggle(key)),
      get children() {
        return [
          deps.jsx("text", {
            get fg() {
              return guard(deps.muted);
            },
            get children() {
              foldRevision();
              return guard(() => `${isOpen(key) ? "▾" : "▸"} ● ${callTitle(summary)}`) ?? "";
            },
          }),
          deps.jsx("text", {
            get visible() {
              foldRevision();
              return isOpen(key);
            },
            get fg() {
              return guard(deps.muted);
            },
            get children() {
              foldRevision();
              if (!isOpen(key)) return "";
              return (
                guard(() =>
                  unfoldLines(summary)
                    .map((line) => `  ${line}`)
                    .join("\n")
                ) ?? ""
              );
            },
          }),
        ];
      },
    });

  const render = (input: { sessionID?: string }) => {
    try {
      // The host passes slot input as reactive props and may keep this claim mounted while the
      // session in view changes, so the id is read on each paint. `tracked` makes the follow-up
      // idempotent: a repaint with the same id asks for no new pull.
      let tracked: string | undefined;
      const follow = (): string | undefined => {
        const id = guard(() => input?.sessionID);
        if (id && id !== tracked) {
          tracked = id;
          lastViewed = id;
          request(id, 0);
        }
        return id;
      };
      follow();
      registerCommand();
      return deps.jsx("box", {
        flexDirection: "column",
        get children() {
          listRevision();
          const id = follow();
          return (id ? guard(() => rowsFor(id).map(drawRow)) : undefined) ?? [];
        },
      });
    } catch {
      return null;
    }
  };

  const removeSlot = guard(() => deps.ui.slot({ append: SLOT, render }));

  const offPush = guard(() =>
    rpc?.events.on("recalled", (event) => {
      const id = event?.data?.sessionID;
      if (typeof id === "string" && sessions.has(id)) request(id, debounceMs);
    })
  );

  // Only sessions the slot has drawn are refreshed, and an event without a session id is no hint.
  const offData = guard(() =>
    deps.data.listen((event) => {
      const details = event?.details;
      if (typeof details?.type !== "string" || !PULL_EVENT_TYPES.has(details.type)) return;
      const id = details.data?.sessionID ?? details.properties?.sessionID;
      if (typeof id === "string" && sessions.has(id)) request(id, debounceMs);
    })
  );

  return () => {
    stopped = true;
    for (const state of sessions.values()) clearTimeout(state.timer);
    release(offData);
    release(offPush);
    release(removeSlot);
    release(layerHandle);
  };
}
