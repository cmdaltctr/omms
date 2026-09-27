export interface ToolCallResult {
  success: boolean;
  data?: any;
  error?: string;
  iterations?: number;
  /** The provider's last reported stop reason, e.g. a length limit. */
  stopReason?: string;
}

export interface ProviderConfig {
  model: string;
  apiUrl: string;
  apiKey?: string;
  maxIterations?: number;
  iterationTimeout?: number;
  maxTokens?: number;
  memoryTemperature?: number | false;
  extraParams?: Record<string, unknown>;
}

/**
 * A validation error message that is safe to log and return. A JSON
 * `SyntaxError` message quotes the start of the model's reply, which can carry
 * conversation content, so it is replaced; validator messages name fields only.
 */
export function describeValidationError(error: unknown): string {
  if (error instanceof SyntaxError) return "tool arguments are not valid JSON";
  if (error instanceof Error) return error.message;
  return "unknown validation error";
}

const PROTECTED_KEYS = new Set([
  "model",
  "messages",
  "tools",
  "tool_choice",
  "temperature",
  "input",
  "instructions",
  "conversation",
  "stream",
]);

export function applySafeExtraParams(
  requestBody: Record<string, any>,
  extraParams: Record<string, unknown>
): void {
  for (const [key, value] of Object.entries(extraParams)) {
    if (!PROTECTED_KEYS.has(key)) {
      requestBody[key] = value;
    }
  }
}

export abstract class BaseAIProvider {
  protected config: ProviderConfig;

  constructor(config: ProviderConfig) {
    this.config = config;
  }

  abstract executeToolCall(
    systemPrompt: string,
    userPrompt: string,
    toolSchema: any,
    sessionId: string
  ): Promise<ToolCallResult>;

  abstract getProviderName(): string;

  abstract supportsSession(): boolean;
}
