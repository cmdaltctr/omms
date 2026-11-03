/**
 * Plugin RPC contract between the OpenCode v2 server entrypoint (records recall summaries) and the
 * terminal TUI entrypoint (draws them). Plain data on purpose: no host SDK import, so both sides and
 * the tests can load it. The TUI pulls `list` and treats `recalled` as a refresh hint only; a missing
 * push never breaks the rows (TDR-060).
 */
export const RECALL_RPC_ID = "omms-recall";

export const recallRpc = {
  id: RECALL_RPC_ID,
  methods: {
    // `enabled` is the effective `visibleRecall` setting for the server's project, so the TUI never
    // reads config. Summaries are recorded and served even when it is false.
    list: {
      input: {
        type: "object",
        properties: { sessionID: { type: "string" } },
        required: ["sessionID"],
      },
      output: {
        type: "object",
        properties: {
          enabled: { type: "boolean" },
          items: { type: "array", items: { type: "object" } },
        },
        required: ["enabled", "items"],
      },
    },
  },
  events: {
    recalled: {
      schema: {
        type: "object",
        properties: { sessionID: { type: "string" } },
        required: ["sessionID"],
      },
    },
  },
} as const;
