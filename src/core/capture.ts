import { memoryClient } from "../services/client.js";
import { getTags } from "../services/tags.js";
import { buildMarkdownContext, getAutoCaptureMarkdownBudget } from "./capture-context.js";
import type {
  CaptureConversation,
  CapturePromptContext,
  CaptureProvenance,
  CaptureSummaryProvider,
} from "./host.js";

export interface CaptureWorkUnit extends CaptureProvenance, CaptureConversation {
  projectDirectory: string;
  userPrompt: string;
  promptId?: string;
  prompt?: CapturePromptContext;
}

export type CaptureResult =
  { status: "captured"; memoryId: string } | { status: "skipped"; type?: string };

async function getLatestProjectMemory(containerTag: string): Promise<string | null> {
  try {
    const result = await memoryClient.listMemories(containerTag, 1);
    if (!result.success || result.memories.length === 0) return null;

    const latest = result.memories[0];
    if (!latest) return null;

    return latest.summary.length <= 500 ? latest.summary : latest.summary.substring(0, 500) + "...";
  } catch {
    return null;
  }
}

export async function captureConversation(
  workUnit: CaptureWorkUnit,
  provider: CaptureSummaryProvider
): Promise<CaptureResult> {
  const tags = getTags(workUnit.projectDirectory);
  const latestMemory = await getLatestProjectMemory(tags.project.tag);
  const context = buildMarkdownContext(
    workUnit.userPrompt,
    workUnit.textResponses,
    workUnit.toolCalls,
    latestMemory,
    getAutoCaptureMarkdownBudget()
  );

  let summaryResult;
  try {
    summaryResult = await provider.summarize({
      context,
      sessionId: workUnit.hostSessionId,
      projectDirectory: workUnit.projectDirectory,
      userPrompt: workUnit.userPrompt,
      prompt: workUnit.prompt,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Summary generation failed: ${message}`, { cause: error });
  }

  if (!summaryResult || summaryResult.type === "skip") {
    return { status: "skipped", type: summaryResult?.type };
  }

  const summaryWithTags =
    summaryResult.tags.length > 0
      ? `${summaryResult.summary}\n\nTags: ${summaryResult.tags.join(", ")}`
      : summaryResult.summary;

  const source = workUnit.sourceType === "history-import" ? "import" : "auto-capture";
  const result = await memoryClient.addMemory(summaryWithTags, tags.project.tag, {
    source,
    type: summaryResult.type,
    tags: summaryResult.tags,
    sessionID: workUnit.hostSessionId,
    promptId: workUnit.promptId,
    captureTimestamp: Date.now(),
    host: workUnit.host,
    hostSessionId: workUnit.hostSessionId,
    sourceType: workUnit.sourceType,
    sourceEntryIds: workUnit.sourceEntryIds,
    sourceTimestamp: workUnit.sourceTimestamp,
    sourceFile: workUnit.sourceFile,
    importId: workUnit.importId,
    displayName: tags.project.displayName,
    userName: tags.project.userName,
    userEmail: tags.project.userEmail,
    projectPath: tags.project.projectPath,
    projectName: tags.project.projectName,
    gitRepoUrl: tags.project.gitRepoUrl,
  });

  if (!result.success) {
    throw new Error(`Memory persistence failed: ${result.error || "database write failed"}`);
  }

  return { status: "captured", memoryId: result.id };
}
