import { randomUUID } from "node:crypto";
import { promises as fs, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { restrictToCurrentUser } from "./private-path.js";

/** How the External API card supplies `memoryApiKey`; a pasted value never leaves this module. */
export type MemoryKeySourceRequest =
  | { source: "env"; name: string }
  | { source: "file"; path: string }
  | { source: "paste"; name: string; value: string; replace?: boolean };

export class MemoryKeySourceError extends Error {
  constructor(
    message: string,
    readonly status = 400
  ) {
    super(message);
    this.name = "MemoryKeySourceError";
  }
}

export const secretsDirectory = () => join(homedir(), ".config", "omms", "secrets");

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const KEY_FILE_NAME = /^[A-Za-z0-9_-]{1,64}$/;

function expandHome(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/") || path.startsWith("~\\")) return join(homedir(), path.slice(2));
  return path;
}

/** Check a request's shape; error messages never include the pasted value. */
export function parseMemoryKeySource(body: unknown): MemoryKeySourceRequest {
  const request = (body ?? {}) as Record<string, unknown>;
  if (request.source === "env") {
    if (typeof request.name !== "string" || !ENV_NAME.test(request.name)) {
      throw new MemoryKeySourceError("Enter a variable name such as ZAI_API_KEY");
    }
    return { source: "env", name: request.name };
  }
  if (request.source === "file") {
    if (typeof request.path !== "string" || !request.path.trim()) {
      throw new MemoryKeySourceError("Enter the path of a key file");
    }
    return { source: "file", path: request.path.trim() };
  }
  if (request.source === "paste") {
    if (typeof request.name !== "string" || !KEY_FILE_NAME.test(request.name)) {
      throw new MemoryKeySourceError(
        "Name the key file with letters, digits, dashes, or underscores"
      );
    }
    if (typeof request.value !== "string" || !request.value.trim()) {
      throw new MemoryKeySourceError("Paste the key");
    }
    return {
      source: "paste",
      name: request.name,
      value: request.value,
      replace: request.replace === true,
    };
  }
  throw new MemoryKeySourceError("Choose a key source");
}

/**
 * Turn a key source into an `env://` or `file://` reference. A pasted key is
 * written to `~/.config/omms/secrets/<name>.key`, readable only by the user,
 * and replaces an existing file only when the request confirms it.
 */
export async function storeMemoryKeySource(
  request: MemoryKeySourceRequest,
  options: {
    directory?: string;
    platform?: NodeJS.Platform;
    restrict?: typeof restrictToCurrentUser;
  } = {}
): Promise<{ reference: string; source: "env" | "file"; path?: string }> {
  if (request.source === "env") return { reference: `env://${request.name}`, source: "env" };
  if (request.source === "file") {
    const path = expandHome(request.path);
    let isFile: boolean;
    try {
      isFile = isAbsolute(path) && statSync(path).isFile();
    } catch {
      isFile = false;
    }
    if (!isFile) throw new MemoryKeySourceError("The key file does not exist");
    return { reference: `file://${path}`, source: "file", path };
  }

  const directory = options.directory ?? secretsDirectory();
  const platform = options.platform ?? process.platform;
  const restrict = options.restrict ?? restrictToCurrentUser;
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  try {
    restrict(directory, 0o700, platform);
  } catch {
    throw new MemoryKeySourceError("The secrets folder could not be made private", 500);
  }
  const path = join(directory, `${request.name}.key`);
  const content = `${request.value.trim()}\n`;
  if (!request.replace) {
    try {
      await fs.writeFile(path, content, { flag: "wx", mode: 0o600 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new MemoryKeySourceError(
          `A key file named ${request.name}.key exists. Confirm to replace it.`,
          409
        );
      }
      throw new MemoryKeySourceError("The key file could not be written", 500);
    }
    try {
      restrict(path, 0o600, platform);
    } catch {
      // Never leave a key readable by others: remove it so a retry starts clean.
      await fs.rm(path, { force: true });
      throw new MemoryKeySourceError("The key file could not be made private", 500);
    }
  } else {
    const temp = join(directory, `.${randomUUID()}.tmp`);
    try {
      await fs.writeFile(temp, content, { flag: "wx", mode: 0o600 });
      restrict(temp, 0o600, platform);
      await fs.rename(temp, path);
    } catch {
      throw new MemoryKeySourceError("The key file could not be written", 500);
    } finally {
      await fs.rm(temp, { force: true });
    }
  }
  // A replaced file was made private as the temp file before it moved into place.
  return { reference: `file://${path}`, source: "file", path };
}
