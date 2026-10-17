export interface AutoCleanupSettings {
  enabled?: boolean;
  interval?: number;
}

/**
 * True when a learning pass that took the analysed-prompt count of the profile from
 * `previous` to `previous + added` passed a multiple of the interval. The caller passes the
 * two settings, so this module does not read the config.
 */
export function shouldStartAutoCleanup(
  previous: number,
  added: number,
  settings: AutoCleanupSettings
): boolean {
  const { interval } = settings;
  if (!settings.enabled || !Number.isInteger(interval) || (interval as number) <= 0) return false;
  const every = interval as number;
  return Math.floor(previous / every) < Math.floor((previous + added) / every);
}
