import { franc } from "franc-min";
import { iso6393, iso6393To1 } from "iso-639-3";

// 3-letter codes without ISO 639-1 equivalents
const FALLBACK_MAP: Record<string, string> = {
  cmn: "zh", // Mandarin Chinese
  yue: "zh", // Cantonese
  arz: "ar", // Egyptian Arabic
  hbs: "sr", // Serbo-Croatian
};

// franc guesses wrongly on short Latin-script text (for example "ok go ahead" as Somali),
// and the capture prompt then asks the model to write the memory in that language.
// Below this length, Latin-script text counts as English. Non-Latin scripts stay reliable.
const MIN_LATIN_DETECT_LENGTH = 100;

function isMostlyLatin(text: string): boolean {
  const letters = text.match(/\p{L}/gu) ?? [];
  if (letters.length === 0) return true;
  const latin = letters.filter((char) => /\p{Script=Latin}/u.test(char)).length;
  return latin / letters.length >= 0.5;
}

export function detectLanguage(text: string): string {
  if (!text || text.trim().length === 0) {
    return "en";
  }

  if (text.trim().length < MIN_LATIN_DETECT_LENGTH && isMostlyLatin(text)) {
    return "en";
  }

  const detected = franc(text, { minLength: 5 });

  if (detected === "und") {
    return "en";
  }

  // Try 2-letter mapping first
  const twoLetter = iso6393To1[detected];
  if (twoLetter) return twoLetter;

  // Fallback for 3-letter codes without 2-letter equivalent
  return FALLBACK_MAP[detected] || "en";
}

export function getLanguageName(code: string): string {
  // Try 2-letter lookup first
  let lang = iso6393.find((l: any) => l.iso6391 === code);
  // Fallback to 3-letter lookup
  if (!lang) {
    lang = iso6393.find((l: any) => l.iso6393 === code);
  }
  return lang?.name || "English";
}
