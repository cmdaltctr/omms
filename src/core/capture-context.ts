import { CONFIG } from "../config.js";
import type { CaptureToolCall } from "./host.js";
import { truncateToMaxBytes, utf8ByteLength } from "../utils/context-limit.js";

const DEFAULT_AUTO_CAPTURE_MAX_CONTEXT_BYTES = 131072;
const CONTEXT_TRUNCATION_MARKER = "\n[... truncated to autoCaptureMaxContextBytes ...]\n";
const SUMMARY_REQUEST_OVERHEAD_BYTES = 1024;
const SUMMARY_OUTPUT_RESERVE_BYTES = 16384;
const SUMMARY_ANALYSIS_SUFFIX =
  'Analyze this conversation. If it contains technical work (code, bugs, features, decisions), create a concise summary and relevant tags. If it\'s non-technical (greetings, casual chat, incomplete requests), return type="skip" with empty summary.';

function fitTextResponses(textResponses: string[], maxBytes: number): string {
  if (textResponses.length === 0 || maxBytes <= 0) return "";

  const separator = "\n\n";
  const separatorBytes = utf8ByteLength(separator);
  const joined = textResponses.join(separator);
  if (utf8ByteLength(joined) <= maxBytes) return joined;

  const kept: string[] = [];
  let usedBytes = 0;

  for (let i = textResponses.length - 1; i >= 0; i--) {
    const response = textResponses[i] ?? "";
    const responseBytes = utf8ByteLength(response);
    const extraSeparator = kept.length > 0 ? separatorBytes : 0;
    const needed = responseBytes + extraSeparator;

    if (usedBytes + needed <= maxBytes) {
      kept.unshift(response);
      usedBytes += needed;
      continue;
    }

    const remaining = maxBytes - usedBytes - extraSeparator;
    if (remaining > utf8ByteLength(CONTEXT_TRUNCATION_MARKER)) {
      kept.unshift(truncateToMaxBytes(response, remaining, CONTEXT_TRUNCATION_MARKER));
    }
    break;
  }

  return kept.join(separator);
}

function joinSections(sections: string[]): string {
  return sections.join("\n");
}

export function getAutoCaptureMarkdownBudget(
  totalRequestBytes: number = CONFIG.autoCaptureMaxContextBytes ??
    DEFAULT_AUTO_CAPTURE_MAX_CONTEXT_BYTES
): number {
  const requestReserve = Math.min(24576, Math.floor(totalRequestBytes * 0.25));
  return Math.max(4096, totalRequestBytes - requestReserve);
}

export function buildBoundedSummaryPrompt(
  context: string,
  systemPrompt: string,
  schema: unknown,
  totalRequestBytes: number = CONFIG.autoCaptureMaxContextBytes ??
    DEFAULT_AUTO_CAPTURE_MAX_CONTEXT_BYTES
): string {
  const schemaBytes = utf8ByteLength(JSON.stringify(schema));
  const outputReserve = Math.min(
    SUMMARY_OUTPUT_RESERVE_BYTES,
    Math.floor(totalRequestBytes * 0.125)
  );
  const userBudget = Math.max(
    0,
    totalRequestBytes -
      utf8ByteLength(systemPrompt) -
      schemaBytes -
      outputReserve -
      SUMMARY_REQUEST_OVERHEAD_BYTES
  );
  return truncateToMaxBytes(
    `${context}\n\n${SUMMARY_ANALYSIS_SUFFIX}`,
    userBudget,
    CONTEXT_TRUNCATION_MARKER
  );
}

export function buildMarkdownContext(
  userPrompt: string,
  textResponses: string[],
  toolCalls: CaptureToolCall[],
  latestMemory: string | null,
  maxContextBytes: number = CONFIG.autoCaptureMaxContextBytes ??
    DEFAULT_AUTO_CAPTURE_MAX_CONTEXT_BYTES
): string {
  const memorySections: string[] = [];
  if (latestMemory) {
    memorySections.push("## Previous Memory Context");
    memorySections.push("---");
    memorySections.push(latestMemory);
    memorySections.push("---\n");
  }

  const toolsSections: string[] = [];
  if (toolCalls.length > 0) {
    toolsSections.push("## Tools Used");
    toolsSections.push("---");
    for (const tool of toolCalls) {
      toolsSections.push(tool.input ? `- ${tool.name}(${tool.input})` : `- ${tool.name}`);
    }
    toolsSections.push("---\n");
  }

  const userWrapper = ["## User Request", "---", "", "---\n"];
  const aiWrapper =
    textResponses.length > 0 ? ["## AI Response", "---", "", "---\n"] : ([] as string[]);

  const skeletonWithoutBodies = joinSections([
    ...memorySections,
    ...userWrapper,
    ...aiWrapper,
    ...toolsSections,
  ]);
  const skeletonBytes = utf8ByteLength(skeletonWithoutBodies);

  let userBudget = Math.max(0, maxContextBytes - skeletonBytes);
  if (textResponses.length > 0 && userBudget > 1024) {
    const preferredAiFloor = Math.min(4096, Math.floor(maxContextBytes * 0.25));
    userBudget = Math.max(256, userBudget - preferredAiFloor);
  }

  const boundedUser =
    utf8ByteLength(userPrompt) <= userBudget
      ? userPrompt
      : truncateToMaxBytes(userPrompt, userBudget, CONTEXT_TRUNCATION_MARKER);

  const prefix = joinSections([
    ...memorySections,
    "## User Request",
    "---",
    boundedUser,
    "---\n",
    ...toolsSections,
  ]);

  if (textResponses.length === 0) {
    if (utf8ByteLength(prefix) <= maxContextBytes) return prefix;
    return truncateToMaxBytes(prefix, maxContextBytes, CONTEXT_TRUNCATION_MARKER);
  }

  const prefixWithoutTools = joinSections([
    ...memorySections,
    "## User Request",
    "---",
    boundedUser,
    "---\n",
  ]);
  const toolsBlock = toolsSections.length > 0 ? "\n" + joinSections(toolsSections) : "";
  const aiWrapperBytes = utf8ByteLength(joinSections(["## AI Response", "---", "", "---\n"]));
  const aiBudget = Math.max(
    0,
    maxContextBytes -
      utf8ByteLength(prefixWithoutTools) -
      utf8ByteLength(toolsBlock) -
      aiWrapperBytes
  );
  const boundedAi = fitTextResponses(textResponses, aiBudget);

  const result = joinSections([
    ...memorySections,
    "## User Request",
    "---",
    boundedUser,
    "---\n",
    "## AI Response",
    "---",
    boundedAi,
    "---\n",
    ...toolsSections,
  ]);

  if (utf8ByteLength(result) <= maxContextBytes) return result;
  return truncateToMaxBytes(result, maxContextBytes, CONTEXT_TRUNCATION_MARKER);
}
