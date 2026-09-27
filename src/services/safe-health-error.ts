/** Remove configured credentials before returning a model error to the browser. */
export function safeHealthError(error: unknown, secrets: Array<string | undefined>): string {
  let message = error instanceof Error ? error.message : String(error);
  for (const secret of secrets) {
    if (secret && secret.length > 2) message = message.replaceAll(secret, "[redacted]");
  }
  return message
    .replace(/(Bearer\s+)[^\s]+/gi, "$1[redacted]")
    .replace(/(api[_-]?key[=:]\s*)[^\s&]+/gi, "$1[redacted]");
}
