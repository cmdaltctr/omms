/**
 * Sorts a memory-model error into a kind the web page can explain in words.
 * `no_credit` and `auth` fail the same way for every memory, so a run that
 * hits one stops instead of calling the model again for each memory.
 */
export type ProviderErrorKind = "no_credit" | "auth" | "other";

const NO_CREDIT =
  /\b402\b|insufficient[_ ](balance|credits?|funds|quota)|out of credits?|credit balance/i;
const AUTH = /\b401\b|\b403\b|invalid[_ ]api[_ ]key|unauthori[sz]ed|incorrect api key/i;

export function providerErrorKind(message: string): ProviderErrorKind {
  if (NO_CREDIT.test(message)) return "no_credit";
  if (AUTH.test(message)) return "auth";
  return "other";
}
