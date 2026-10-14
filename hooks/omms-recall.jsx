import { atom, read, update } from "claude-code";

import { callTitle, queryLine, recalledIn } from "./omms-recall-parse.js";

// A fold-out row at the top of each reply for each OMMS recall made for it,
// drawn like a tool call: `▸ ● memory [mode=search, query="...", limit=4]`.
// Press it to read the query and the memories with their ids.
// The memories are read from the context the OMMS hooks inject (`session.append`,
// door `hook-context`), so this module runs no second retrieval.

const open = atom({ plugin: "omms", key: "recall-open" }, {});

/** The text of every text block in one appended row. */
function textOf(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) =>
      block && typeof block === "object" && "text" in block ? String(block.text) : ""
    )
    .join("\n");
}

/** `67% mem_abc Headline`: the parts of one result line that the section has. */
function resultLine(item) {
  const parts = [];
  if (item.relevance !== null) parts.push(`${item.relevance}%`);
  if (item.id) parts.push(item.id);
  parts.push(item.text);
  return parts.join(" ");
}

export const registerRecall = (on) => {
  // Recalled since the last reply started. The next reply to draw claims them.
  let pending = [];
  const claimed = new Map();
  // The prompt OMMS searched with; null when the recall is the session's own.
  let lastPrompt = null;

  on("prompt.submit", async ($, e, next) => {
    lastPrompt = e.text;
    return next(e);
  });

  on("session.append", { door: "hook-context" }, async ($, e, next) => {
    const items = e.agentId ? [] : recalledIn(textOf(e.message.content));
    if (items.length > 0) {
      pending = [...pending, { mode: lastPrompt ? "search" : "recent", query: lastPrompt, items }];
      lastPrompt = null;
    }
    return next(e);
  }).catch(($, e, next) => next(e));

  on("ui.render", { component: "AssistantMessage" }, async ($, e, next) => {
    const inner = await next(e);
    if (!e.props.isFirstOfReply) return inner;

    if (!claimed.has(e.requestId)) {
      claimed.set(e.requestId, pending);
      $.ui.log(`omms: reply ${e.requestId} claimed ${pending.length} recalls`, { to: "debug" });
      pending = [];
    }
    const calls = claimed.get(e.requestId) ?? [];
    if (calls.length === 0) return inner;

    const openRows = await read($, open);
    const { Box, Button, Text } = $.ui.resolve(e);
    return (
      <Box flexDirection="column">
        {calls.map((call, index) => {
          const id = `${e.requestId}-${index}`;
          const isOpen = Boolean(openRows[id]);
          return (
            <Box flexDirection="column">
              <Button
                key={`omms-recall-${id}`}
                onPress={() => update($, open, (now) => ({ ...now, [id]: !now[id] }))}
              >
                <Text dimColor>{isOpen ? "▾ " : "▸ "}</Text>
                <Text color="success">● </Text>
                <Text bold>memory</Text>
                <Text dimColor> {callTitle(call).slice("memory ".length)}</Text>
              </Button>
              {isOpen && (
                <Box flexDirection="column">
                  <Text dimColor>
                    {"    "}mode: {call.mode}
                  </Text>
                  {call.query && (
                    <Text dimColor>
                      {"    "}query: {queryLine(call.query, 300)}
                    </Text>
                  )}
                  <Text dimColor>
                    {"    "}limit: {call.items.length}
                  </Text>
                  <Text dimColor>{"    "}results:</Text>
                  {call.items.map((item, n) => (
                    <Text dimColor>
                      {"      "}
                      {n + 1}. {resultLine(item)}
                    </Text>
                  ))}
                </Box>
              )}
            </Box>
          );
        })}
        {inner}
      </Box>
    );
  });
};
