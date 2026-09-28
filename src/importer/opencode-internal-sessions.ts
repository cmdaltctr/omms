/** Title used for transient structured-output sessions (capture / profile learning). */
export const INTERNAL_CAPTURE_SESSION_TITLE = "omms capture";
/** Title used by opencode-mem builds; sessions left by older versions stay internal. */
const LEGACY_INTERNAL_CAPTURE_SESSION_TITLE = "opencode-mem capture";

/** Every title omms has used for its own sessions (capture, profile learning, profile cleanup). */
export const INTERNAL_CAPTURE_SESSION_TITLES = [
  INTERNAL_CAPTURE_SESSION_TITLE,
  LEGACY_INTERNAL_CAPTURE_SESSION_TITLE,
  "omms profile cleanup",
  "opencode-mem profile cleanup",
] as const;

export function isInternalCaptureSessionTitle(title: string | undefined | null): boolean {
  return (
    title === INTERNAL_CAPTURE_SESSION_TITLE || title === LEGACY_INTERNAL_CAPTURE_SESSION_TITLE
  );
}
