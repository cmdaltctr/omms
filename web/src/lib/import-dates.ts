/**
 * Prompt date limits are whole days in the browser's time zone. The server
 * reads a bare `YYYY-MM-DD` as UTC, so the page sends exact epoch ms instead:
 * the first millisecond of the start day and the last of the end day.
 */
function parts(value: string): [number, number, number] | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? [Number(match[1]), Number(match[2]) - 1, Number(match[3])] : null;
}

export function localDayStart(value: string): number | undefined {
  const date = parts(value);
  return date ? new Date(date[0], date[1], date[2], 0, 0, 0, 0).getTime() : undefined;
}

export function localDayEnd(value: string): number | undefined {
  const date = parts(value);
  return date ? new Date(date[0], date[1], date[2], 23, 59, 59, 999).getTime() : undefined;
}
