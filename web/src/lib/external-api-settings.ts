export type KeySource = "env" | "file" | "paste";

export type KeySourceBody =
  | { source: "env"; name: string }
  | { source: "file"; path: string }
  | { source: "paste"; name: string; value: string; replace?: boolean };

/** Build the key-source request; the pasted value goes only into this body. */
export function keySourceBody(
  source: KeySource,
  input: { name?: string; path?: string; value?: string; replace?: boolean }
): KeySourceBody {
  if (source === "env") {
    const name = (input.name ?? "").trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      throw new Error("Enter a variable name such as ZAI_API_KEY");
    }
    return { source, name };
  }
  if (source === "file") {
    const path = (input.path ?? "").trim();
    if (!path) throw new Error("Enter the path of a key file");
    return { source, path };
  }
  const name = (input.name ?? "").trim() || "memory-api";
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(name)) {
    throw new Error("Name the key file with letters, digits, dashes, or underscores");
  }
  if (!(input.value ?? "").trim()) throw new Error("Paste the key");
  return { source, name, value: input.value ?? "", replace: input.replace === true };
}

/**
 * The key as a test request carries it: `env://NAME` or `file://PATH` for a reference, the pasted
 * text itself for a pasted key, or nothing when the form has no key. Nothing is saved or logged.
 */
export function testKeyValue(
  source: KeySource,
  input: { name?: string; path?: string; value?: string }
): string | undefined {
  if (source === "env") {
    const name = (input.name ?? "").trim();
    return name ? `env://${name}` : undefined;
  }
  if (source === "file") {
    const path = (input.path ?? "").trim();
    return path ? `file://${path}` : undefined;
  }
  return (input.value ?? "").trim() ? input.value : undefined;
}

/** True when the user typed something for the chosen key source. */
export function keyEntered(
  source: KeySource,
  input: { name?: string; path?: string; value?: string }
): boolean {
  return testKeyValue(source, input) !== undefined;
}

/** The External API test reply. `reason` and `status` say why it failed; the raw error is never shown. */
export type ExternalTestReply = { ok: boolean; reason?: string; status?: number };

const TEST_FAILURES: Record<string, string> = {
  refused: "The provider refused the key. Check the key, then test again.",
  "not-found": "The address or the model was not found. Check both.",
  "rate-limited": "The provider got too many requests. Wait a minute, then test again.",
  provider: "The provider had a problem on its side. Try again later.",
  unreachable: "OMMS could not reach the address. Check the address and your network.",
  "not-configured": "Some settings are missing. Fill in the address, the model and the key.",
  failed: "The test call failed. Check the provider, the address, the model and the key.",
};

/** The plain English sentence for a failed test. Callers translate it. */
export function testFailureText(reason: string | undefined): string {
  return TEST_FAILURES[reason ?? ""] ?? TEST_FAILURES.failed!;
}

/** Why External API cannot be chosen yet, from the live rule's issue list; empty when it can. */
export function externalMissing(settings: {
  memoryProvider?: string;
  memoryModel?: string;
  memoryApiUrl?: string;
  keySet: boolean;
}): string[] {
  const missing: string[] = [];
  const orcarouter = settings.memoryProvider === "orcarouter";
  if (!orcarouter && !settings.memoryModel) missing.push("memoryModel");
  if (!orcarouter && !settings.memoryApiUrl) missing.push("memoryApiUrl");
  if (!settings.keySet) missing.push("memoryApiKey");
  return missing;
}

/** The config edit for a host capture model choice. */
export function hostModelEdit(host: "opencode" | "pi", choice: string): Record<string, string> {
  if (choice === "inherit" || choice === "external") return { [`${host}Model`]: choice };
  const slash = choice.indexOf("/");
  if (slash < 1 || slash === choice.length - 1) throw new Error("Enter a model as provider/model.");
  return { [`${host}Provider`]: choice.slice(0, slash), [`${host}Model`]: choice.slice(slash + 1) };
}

export type GlobalRelation = "missing" | "same" | "older" | "newer" | "unknown";
/** The server compares the versions, so the page and the server agree on prereleases. */
export type VersionInfo = { running: string; global: string | null; relation: GlobalRelation };

/** The Web app section's version notice and the command it shows. */
export function versionNotice(info: VersionInfo): {
  kind: GlobalRelation;
  command: string | null;
} {
  return {
    kind: info.relation,
    // `web update` takes the install lock, so it never races a web app's own update.
    command:
      info.relation === "older"
        ? "npx -p om-memory-system@latest om-memory-system web update"
        : null,
  };
}

export type PathMap = { from: string; to: string };
export type MapDecision = { directory: string; target: string };

/** The `importPathMaps` for Save removals: saved maps minus those marked for removal. */
export function mapsToSave(saved: readonly PathMap[], removed: ReadonlySet<string>): PathMap[] {
  return saved.filter((map) => !removed.has(map.from));
}
