/**
 * Plugin RPC contract that carries server notices to the terminal TUI entrypoint, which shows them
 * as toasts. The V2 server plugin has no toast API, and its console output reaches neither the
 * screen nor OpenCode's log. Plain data on purpose: no host SDK import, so both sides and the tests
 * can load it (TDR-060).
 */
export const noticeRpc = {
  id: "omms-notice",
  methods: {},
  events: {
    notice: {
      schema: {
        type: "object",
        properties: {
          title: { type: "string" },
          message: { type: "string" },
          variant: { type: "string" },
        },
        required: ["message"],
      },
    },
  },
} as const;
