import { keywordHue } from "$lib/components/explorer/KeywordBadge";

/** Two letters for a space chip: the first letters of the first two words, or the first two letters. */
export function spaceInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const letters =
    words.length > 1
      ? [Array.from(words[0]!)[0]!, Array.from(words[1]!)[0]!]
      : Array.from(words[0]!).slice(0, 2);
  return letters.join("").toLocaleUpperCase();
}

/** The chip colour follows the name, as the colour of a keyword does. */
export const spaceChipHue = (name: string): number => keywordHue(name);

/** The DOM id of a space's card on the Spaces page, and the hash that opens it. */
export const spaceCardId = (spaceId: string): string => `space-card-${spaceId}`;
