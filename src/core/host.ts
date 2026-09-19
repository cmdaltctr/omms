import type { MemoryHost, MemorySourceType } from "../types/index.js";

export interface CaptureToolCall {
  name: string;
  input: string;
}

export interface CaptureConversation {
  textResponses: string[];
  toolCalls: CaptureToolCall[];
  sourceEntryIds?: string[];
  sourceTimestamp?: number;
}

export interface CapturePromptContext {
  id?: string;
  providerId?: string | null;
  modelId?: string | null;
}

export interface CaptureSummary {
  summary: string;
  type: string;
  tags: string[];
}

export interface CaptureSummaryRequest {
  context: string;
  sessionId: string;
  projectDirectory: string;
  userPrompt: string;
  prompt?: CapturePromptContext;
}

export interface CaptureSummaryProvider {
  summarize(request: CaptureSummaryRequest): Promise<CaptureSummary | null>;
}

export interface AutoCaptureNotification {
  title: string;
  message: string;
  variant: "success" | "warning" | "error" | "info";
  duration: number;
}

export interface AutoCaptureHost extends CaptureSummaryProvider {
  readonly host: MemoryHost;
  isCaptureReady(): boolean;
  getConversation(sessionId: string, promptMessageId: string): Promise<CaptureConversation | null>;
  notify?(notification: AutoCaptureNotification): Promise<void> | void;
}

export interface CaptureProvenance {
  host: MemoryHost;
  hostSessionId: string;
  sourceType: MemorySourceType;
  sourceEntryIds?: string[];
  sourceTimestamp?: number;
  sourceFile?: string;
  importId?: string;
}
