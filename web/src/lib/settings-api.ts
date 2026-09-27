export async function settingsRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: {
      "x-omms-token": window.__OMMS_TOKEN__ ?? "",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  const result: unknown = await response.json();
  if (!response.ok) {
    const error = result as { error?: string };
    throw new Error(error.error ?? `Request failed (${response.status})`);
  }
  return result as T;
}
