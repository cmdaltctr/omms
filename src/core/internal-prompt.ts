/**
 * True when a prompt is omms's own structured-summary or profile-analysis
 * request. Both hosts echo it back like a user message; recording or learning
 * from it would create self-referential memories and a learning loop.
 */
export function isStructuredSummaryPromptMessage(userMessage: string): boolean {
  if (userMessage.includes("# User Profile Analysis")) {
    return true;
  }
  return userMessage.includes("Analyze this conversation.") && userMessage.includes('type="skip"');
}
