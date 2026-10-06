/**
 * Apply only the newest reply. Polls and refreshes can overlap, and a slow
 * older reply must not overwrite a newer one. A failed request applies nothing;
 * `fail` hears about it only when it was the newest request.
 */
export function latestReply<T>(
  apply: (value: T) => void,
  fail?: (error: Error) => void
): (request: Promise<T>) => Promise<void> {
  let latest = 0;
  return async (request) => {
    const id = ++latest;
    try {
      const value = await request;
      if (id === latest) apply(value);
    } catch (error) {
      // The next poll or refresh tries again.
      if (id === latest) fail?.(error as Error);
    }
  };
}
