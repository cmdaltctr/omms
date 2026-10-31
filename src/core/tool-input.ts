const MAX_TOOL_INPUT_LENGTH = 100;
const READ_TOOLS = new Set(["read", "Read", "view"]);
const READ_PATH_KEYS = ["file_path", "filePath", "path"];

/** Cut a formatted tool input to 100 characters plus "...", as memory capture expects. */
export function boundToolInput(text: string): string {
  return text.length > MAX_TOOL_INPUT_LENGTH
    ? text.substring(0, MAX_TOOL_INPUT_LENGTH) + "..."
    : text;
}

/**
 * The full path field of a read-type call (`read`, `Read`, `view`), so skill
 * detection sees a `SKILL.md` path that the bounded input cuts off.
 */
export function readToolPath(name: string, args: unknown): string | undefined {
  if (!READ_TOOLS.has(name) || !args || typeof args !== "object" || Array.isArray(args)) {
    return undefined;
  }
  const record = args as Record<string, unknown>;
  const key = READ_PATH_KEYS.find((candidate) => typeof record[candidate] === "string");
  return key ? (record[key] as string) : undefined;
}
