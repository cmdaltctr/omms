/**
 * A prompt too short to say anything about the user, such as "yes go". The
 * word rule keeps short real preferences such as "use bun not npm".
 */
export function isTrivialPrompt(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.length < 20 && trimmed.split(/\s+/).filter(Boolean).length < 3;
}
