// Scripts written without spaces between words. A query in one of these is a
// single token, so a tag can only be found inside it.
const UNSPACED_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}]/u;

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 0);
}

/**
 * Share of query words that name one of a memory's tags, from 0 to 1. A word
 * matches when it equals a whole tag or one part of a tag ("code" matches
 * "claude-code"). Plain substring matching let short tags such as "ui" match
 * words like "build" or "guide", which pushed weak results up.
 */
export function tagMatchBoost(queryText: string | undefined, tagsCsv: string): number {
  const tags = tagsCsv
    .split(",")
    .map((tag) => tag.trim().toLowerCase())
    .filter((tag) => tag.length > 0);
  // A one-character word counts only when it is a whole tag ("C language", tag "c").
  const words = tokens(queryText ?? "").filter((word) => word.length > 1 || tags.includes(word));
  if (words.length === 0 || tags.length === 0) return 0;

  const tagParts = new Set(tags.flatMap((tag) => [tag, ...tokens(tag)]));
  const unspacedTags = [...tagParts].filter((part) => UNSPACED_SCRIPT.test(part));
  const matches = words.filter(
    (word) => tagParts.has(word) || unspacedTags.some((tag) => word.includes(tag))
  ).length;
  return matches / words.length;
}
