import { promises as fs } from "node:fs";
import { join } from "node:path";
import { PASSWORD_KEYS, writeGlobalConfigKeys } from "./global-config-writer.js";
import { secretsDirectory, storeMemoryKeySource } from "./memory-key-source.js";

/** The page writes the browser password here and nowhere else. */
const KEY_NAME = "web-password";

/**
 * Save the Basic Auth password to a private key file and point
 * `webServerAuthPassword` at it. The password is never returned or logged.
 */
export async function saveWebPassword(
  password: string,
  username: string | undefined,
  revision: string
): Promise<{ revision: string }> {
  if (!password.trim()) throw new Error("Enter a password");
  const stored = await storeMemoryKeySource({
    source: "paste",
    name: KEY_NAME,
    value: password,
    replace: true,
  });
  return writeGlobalConfigKeys(
    {
      webServerAuthPassword: stored.reference,
      webServerAuthUsername: username?.trim() || undefined,
    },
    revision,
    { only: PASSWORD_KEYS }
  );
}

/** Remove both config keys and the key file the page wrote; a user's own file is left alone. */
export async function clearWebPassword(revision: string): Promise<{ revision: string }> {
  const result = await writeGlobalConfigKeys(
    { webServerAuthPassword: undefined, webServerAuthUsername: undefined },
    revision,
    { only: PASSWORD_KEYS }
  );
  await fs.rm(join(secretsDirectory(), `${KEY_NAME}.key`), { force: true });
  return result;
}
