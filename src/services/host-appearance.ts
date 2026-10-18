import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const APPEARANCE_HOSTS = ["pi", "opencode", "claude-code"] as const;
export type AppearanceHost = (typeof APPEARANCE_HOSTS)[number];

export type HostLook =
  { kind: "default" } | { kind: "icon"; icon: string } | { kind: "image"; image: string };

export type HostLooks = Record<AppearanceHost, HostLook>;

/** A refused change; `status` is the HTTP status. */
export class HostAppearanceError extends Error {
  readonly status = 400;
  constructor(message: string) {
    super(message);
    this.name = "HostAppearanceError";
  }
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const IEND = Buffer.from([0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);
const SIZE = 128;
const MAX_BYTES = 256 * 1024;
const ICON_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function assertHost(host: string): asserts host is AppearanceHost {
  if (!(APPEARANCE_HOSTS as readonly string[]).includes(host)) {
    throw new HostAppearanceError("Unknown host");
  }
}

/** Decode and check a host image: a 128 by 128 PNG of at most 256 KB. Nothing else is stored. */
function decodeImage(encoded: unknown): Buffer {
  if (typeof encoded !== "string" || encoded.length === 0 || encoded.length > MAX_BYTES * 2) {
    throw new HostAppearanceError("The image must be a 128 by 128 PNG of at most 256 KB");
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new HostAppearanceError("Invalid image data");
  const bytes = Buffer.from(encoded, "base64");
  const isPng =
    bytes.length >= 45 &&
    bytes.length <= MAX_BYTES &&
    bytes.subarray(0, 8).equals(PNG_SIGNATURE) &&
    bytes.readUInt32BE(8) === 13 &&
    bytes.subarray(12, 16).toString("ascii") === "IHDR" &&
    bytes.subarray(bytes.length - 8).equals(IEND);
  if (!isPng || bytes.readUInt32BE(16) !== SIZE || bytes.readUInt32BE(20) !== SIZE) {
    throw new HostAppearanceError("The image must be a 128 by 128 PNG of at most 256 KB");
  }
  return bytes;
}

type Saved = Partial<Record<AppearanceHost, { kind: "icon"; icon: string } | { kind: "image" }>>;

/**
 * Per-host avatar choices in one global folder. `appearance.json` holds the
 * choices and `<host>.png` holds an uploaded image. Files are written to a
 * temporary name and renamed, so a crash leaves the previous avatar.
 */
export function createHostAppearance(directory: string) {
  const settingsPath = join(directory, "appearance.json");
  const imagePath = (host: AppearanceHost) => join(directory, `${host}.png`);

  async function readSaved(): Promise<Saved> {
    try {
      const parsed: unknown = JSON.parse(await readFile(settingsPath, "utf8"));
      return parsed && typeof parsed === "object" ? (parsed as Saved) : {};
    } catch {
      return {};
    }
  }

  async function atomicWrite(path: string, data: string | Buffer) {
    await mkdir(directory, { recursive: true });
    const temporary = `${path}.${process.pid}.tmp`;
    await writeFile(temporary, data);
    await rename(temporary, path);
  }

  async function save(host: AppearanceHost, value: Saved[AppearanceHost] | undefined) {
    const saved = await readSaved();
    if (value) saved[host] = value;
    else delete saved[host];
    await atomicWrite(settingsPath, JSON.stringify(saved));
  }

  return {
    async read(): Promise<HostLooks> {
      const saved = await readSaved();
      const looks = {} as HostLooks;
      for (const host of APPEARANCE_HOSTS) {
        const entry = saved[host];
        looks[host] = { kind: "default" };
        if (entry?.kind === "icon" && ICON_NAME.test(String(entry.icon))) {
          looks[host] = { kind: "icon", icon: entry.icon };
        } else if (entry?.kind === "image") {
          try {
            const bytes = await readFile(imagePath(host));
            looks[host] = {
              kind: "image",
              image: `data:image/png;base64,${bytes.toString("base64")}`,
            };
          } catch {
            // A missing image file shows the default mark.
          }
        }
      }
      return looks;
    },

    async setIcon(host: string, icon: unknown): Promise<void> {
      assertHost(host);
      if (typeof icon !== "string" || icon.length > 40 || !ICON_NAME.test(icon)) {
        throw new HostAppearanceError("Invalid icon name");
      }
      await save(host, { kind: "icon", icon });
      await rm(imagePath(host), { force: true });
    },

    async setImage(host: string, encoded: unknown): Promise<void> {
      assertHost(host);
      const bytes = decodeImage(encoded);
      await atomicWrite(imagePath(host), bytes);
      await save(host, { kind: "image" });
    },

    async reset(host: string): Promise<void> {
      assertHost(host);
      await save(host, undefined);
      await rm(imagePath(host), { force: true });
    },
  };
}
