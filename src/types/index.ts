export type MemoryType = string;
export type MemoryHost = "opencode" | "pi";
export type MemorySourceType = "live-capture" | "history-import";

export interface MemoryMetadata {
  type?: MemoryType;
  source?: "manual" | "auto-capture" | "import" | "api";
  tool?: string;
  sessionID?: string;
  host?: MemoryHost;
  hostSessionId?: string;
  sourceType?: MemorySourceType;
  sourceEntryIds?: string[];
  sourceTimestamp?: number;
  sourceFile?: string;
  importId?: string;
  reasoning?: string;
  captureTimestamp?: number;
  promptId?: string;
  displayName?: string;
  userName?: string;
  userEmail?: string;
  projectPath?: string;
  projectName?: string;
  gitRepoUrl?: string;
  [key: string]: unknown;
}

export type AIProviderType =
  "openai-chat" | "openai-responses" | "anthropic" | "minimax" | "google-gemini" | "orcarouter";
