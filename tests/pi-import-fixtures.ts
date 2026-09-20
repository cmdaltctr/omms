import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Builders for Pi session JSONL fixtures used by loader and importer tests.
 * Formats follow Pi's session format docs (version 3) plus a synthesized
 * pre-v2 legacy shape to exercise Pi's own migration path.
 */

export interface FixtureWindow {
  userText: string;
  assistantText?: string;
  assistantThinking?: string;
  toolCall?: { name: string; args: Record<string, unknown> };
  /** ISO timestamp for the user entry; assistant entries follow in sequence. */
  timestamp?: string;
}

export interface FixtureSessionOptions {
  file: string;
  sessionId: string;
  cwd: string;
  version?: number;
  windows: FixtureWindow[];
}

export function writeV3Session(options: FixtureSessionOptions): string {
  const lines: string[] = [
    JSON.stringify({
      type: "session",
      version: 3,
      id: options.sessionId,
      timestamp: options.windows[0]?.timestamp ?? "2026-01-01T10:00:00.000Z",
      cwd: options.cwd,
    }),
  ];

  let parentId: string | null = null;
  let counter = 0;
  const nextId = () => `f${(counter++).toString(16).padStart(7, "0")}`;

  for (const window of options.windows) {
    const userEntry = {
      type: "message",
      id: nextId(),
      parentId,
      timestamp: window.timestamp ?? "2026-01-01T10:00:00.000Z",
      message: { role: "user", content: window.userText },
    };
    parentId = userEntry.id;
    lines.push(JSON.stringify(userEntry));

    if (
      window.assistantText !== undefined ||
      window.assistantThinking !== undefined ||
      window.toolCall
    ) {
      const content: any[] = [];
      if (window.assistantThinking !== undefined) {
        content.push({ type: "thinking", thinking: window.assistantThinking });
      }
      if (window.assistantText !== undefined) {
        content.push({ type: "text", text: window.assistantText });
      }
      if (window.toolCall) {
        content.push({
          type: "toolCall",
          id: `call_${counter}`,
          name: window.toolCall.name,
          arguments: window.toolCall.args,
        });
      }
      const assistantEntry = {
        type: "message",
        id: nextId(),
        parentId,
        timestamp: window.timestamp ?? "2026-01-01T10:00:05.000Z",
        message: {
          role: "assistant",
          content,
          api: "messages",
          provider: "test-provider",
          model: "test-model",
          usage: {
            input: 1,
            output: 1,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 2,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: "stop",
        },
      };
      parentId = assistantEntry.id;
      lines.push(JSON.stringify(assistantEntry));
    }
  }

  writeFileSync(options.file, lines.join("\n") + "\n");
  return options.file;
}

/**
 * Legacy pre-v2 session: header declares version 1 and message entries carry
 * no id/parentId. Pi's migrateSessionEntries assigns the chain on load.
 */
export function writeLegacyV1Session(options: FixtureSessionOptions): string {
  const lines: string[] = [
    JSON.stringify({
      type: "session",
      version: 1,
      id: options.sessionId,
      timestamp: "2025-06-01T10:00:00.000Z",
      cwd: options.cwd,
    }),
  ];

  for (const window of options.windows) {
    lines.push(
      JSON.stringify({
        type: "message",
        timestamp: window.timestamp ?? "2025-06-01T10:00:00.000Z",
        message: { role: "user", content: window.userText },
      })
    );
    if (window.assistantText !== undefined) {
      lines.push(
        JSON.stringify({
          type: "message",
          timestamp: window.timestamp ?? "2025-06-01T10:00:05.000Z",
          message: { role: "assistant", content: [{ type: "text", text: window.assistantText }] },
        })
      );
    }
  }

  writeFileSync(options.file, lines.join("\n") + "\n");
  return options.file;
}

export function writeNonSessionArtifact(file: string): string {
  writeFileSync(
    file,
    JSON.stringify({
      version: 1,
      recordType: "message",
      source: "async",
      runId: "run-1",
      agent: "a-docs",
      childIndex: 0,
      cwd: "/nowhere",
    }) + "\n"
  );
  return file;
}

export function makeProjectDir(base: string, name: string): string {
  const dir = join(base, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}
