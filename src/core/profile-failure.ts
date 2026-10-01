/**
 * Fixed reason codes for a failed profile learning step. Log lines carry only
 * the code, never the prompt, the reply, or the provider's message.
 */
export type ProfileFailureCode =
  "timeout" | `http-${number}` | "no-tool-call" | "invalid-reply" | "not-configured" | "error";

export class ProfileModelError extends Error {
  constructor(readonly code: ProfileFailureCode) {
    super(`Profile model call failed: ${code}`);
    this.name = "ProfileModelError";
  }
}

/** The code for a failed provider call result. */
export function profileResultCode(result: {
  error?: string;
  httpStatus?: number;
}): ProfileFailureCode {
  const message = result.error ?? "";
  if (/timeout/i.test(message)) return "timeout";
  if (result.httpStatus !== undefined) return `http-${result.httpStatus}`;
  if (/max iterations/i.test(message)) return "no-tool-call";
  if (/validation/i.test(message)) return "invalid-reply";
  return "error";
}

/** The code for any error thrown by a profile learning step. */
export function profileFailureCode(error: unknown): ProfileFailureCode {
  if (error instanceof ProfileModelError) return error.code;
  const message = error instanceof Error ? error.message : String(error);
  if (/timeout/i.test(message)) return "timeout";
  if (/invalid profile payload|validation/i.test(message)) return "invalid-reply";
  if (/not configured|^Missing memory/i.test(message)) return "not-configured";
  return "error";
}
