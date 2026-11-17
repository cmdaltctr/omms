import { isAbsolute } from "node:path";

// Checks shared by the Claude Code hook routes' request parsers.

/** A hook request the handler cannot use. `status` is the HTTP status. */
export class ClaudeHookRequestError extends Error {
  readonly status = 400;
  constructor(message: string) {
    super(message);
    this.name = "ClaudeHookRequestError";
  }
}

export function objectBody(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ClaudeHookRequestError("A JSON object is required");
  }
  return body as Record<string, unknown>;
}

export function sessionAndCwd(body: Record<string, unknown>): { sessionId: string; cwd: string } {
  const { session_id: sessionId, cwd } = body;
  if (typeof sessionId !== "string" || !sessionId.trim()) {
    throw new ClaudeHookRequestError("session_id is required");
  }
  if (typeof cwd !== "string" || !isAbsolute(cwd)) {
    throw new ClaudeHookRequestError("cwd must be an absolute path");
  }
  return { sessionId, cwd };
}

export function optionalString(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new ClaudeHookRequestError(`${key} must be a string`);
  return value;
}
