export type CredentialState = "set" | "missing" | "not-needed" | "never-used";

export type CredentialInput = {
  secrets: Record<string, { set: boolean } | undefined>;
  /** True when OpenCode or Pi uses the external API for capture. */
  externalUsed: boolean;
  /** Claude Code capture always uses the external API; true only on evidence of use. */
  claudeCodeInUse: boolean;
  access: {
    host: string;
    authEnabled: boolean;
    tokenAvailable: boolean;
    embeddingApiUrl: string | null;
  };
};

const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0:0:0:0:0:0:0:1"]);

function isThisMachine(host: string): boolean {
  const value = host.trim().toLowerCase();
  return LOOPBACK.has(value) || /^127(?:\.\d{1,3}){3}$/.test(value);
}

export function urlOnThisMachine(url: string): boolean {
  try {
    return isThisMachine(new URL(url).hostname);
  } catch {
    return false;
  }
}

function state(set: boolean, needed: boolean): CredentialState {
  return set ? "set" : needed ? "missing" : "not-needed";
}

/** ✅ set, ⛔️ missing, or grey not needed for each credential on the Keys and access card. */
export function credentialStates(input: CredentialInput) {
  const { access, secrets } = input;
  const embeddingServer = access.embeddingApiUrl;
  return {
    // No host uses the key yet, so "not needed" would mislead; say it was never used.
    memoryApiKey: ((value) => (value === "not-needed" ? "never-used" : value))(
      state(Boolean(secrets.memoryApiKey?.set), input.externalUsed || input.claudeCodeInUse)
    ),
    embeddingApiKey: state(
      Boolean(secrets.embeddingApiKey?.set),
      Boolean(embeddingServer) && !urlOnThisMachine(embeddingServer!)
    ),
    apiTokens: state(access.tokenAvailable, !isThisMachine(access.host) && !access.authEnabled),
    webPassword: state(Boolean(secrets.webServerAuthPassword?.set), false),
  };
}

/** The status line after the browser password form saves or clears. */
export function passwordStatusMessage(cleared: boolean): string {
  return cleared
    ? "Browser password cleared. Restart the web app to turn it off."
    : "Saved. Restart the web app to use the new browser password.";
}
