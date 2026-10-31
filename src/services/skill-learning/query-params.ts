/**
 * An integer query parameter, clamped into `min` to `max`. A missing, empty or
 * non-numeric value gives `fallback`. A fraction is rounded down.
 */
export function intParam(
  url: URL,
  name: string,
  min: number,
  max: number,
  fallback: number
): number {
  const raw = url.searchParams.get(name);
  if (raw === null || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}
