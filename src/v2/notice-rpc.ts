/**
 * Plugin RPC contract that carries server notices to the terminal TUI entrypoint, which shows them
 * as toasts. The V2 server plugin has no toast API, and its console output reaches neither the
 * screen nor OpenCode's log. Plain data on purpose: no host SDK import, so both sides and the tests
 * can load it (TDR-060).
 *
 * Plugin RPC events are live only, and the OpenCode background service sends notices before any
 * TUI listens. So the server keeps each notice until a TUI claims it with `claim`, and the
 * `notice` event only tells a listening TUI to claim again. A claim does not remove a notice: the
 * TUI confirms it with `ack` after it shows the notice, so a notice the TUI could not show stays
 * for the next claim. Notices come in order and each shows once.
 */
export const noticeRpc = {
  id: "omms-notice",
  methods: {
    claim: {
      input: { type: "object", properties: {} },
      output: {
        type: "object",
        properties: { notices: { type: "array", items: { type: "object" } } },
        required: ["notices"],
      },
    },
    ack: {
      input: {
        type: "object",
        properties: { ids: { type: "array", items: { type: "number" } } },
        required: ["ids"],
      },
      output: { type: "object", properties: {} },
    },
  },
  events: {
    notice: {
      schema: {
        type: "object",
        properties: {
          title: { type: "string" },
          message: { type: "string" },
          variant: { type: "string" },
          duration: { type: "number" },
        },
        required: ["message"],
      },
    },
  },
} as const;
