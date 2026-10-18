import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostAppearanceError, createHostAppearance } from "../src/services/host-appearance.js";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function folder() {
  const directory = mkdtempSync(join(tmpdir(), "omms-host-appearance-"));
  directories.push(directory);
  return directory;
}

/** A structurally valid PNG: signature, IHDR of the given size, and an IEND chunk. */
function png(width = 128, height = 128, extra = 0): Buffer {
  const header = Buffer.alloc(25);
  header.writeUInt32BE(13, 0);
  header.write("IHDR", 4, "ascii");
  header.writeUInt32BE(width, 8);
  header.writeUInt32BE(height, 12);
  header.set([8, 6, 0, 0, 0], 16);
  const iend = Buffer.from([0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    header,
    Buffer.alloc(extra),
    iend,
  ]);
}

const b64 = (buffer: Buffer) => buffer.toString("base64");

async function rejects(promise: Promise<unknown>, status = 400) {
  const error = await promise.then(
    () => null,
    (cause: unknown) => cause
  );
  expect(error).toBeInstanceOf(HostAppearanceError);
  expect((error as HostAppearanceError).status).toBe(status);
}

describe("host appearance", () => {
  it("shows the default mark for every host before anything is saved", async () => {
    const appearance = createHostAppearance(folder());
    expect(await appearance.read()).toEqual({
      pi: { kind: "default" },
      opencode: { kind: "default" },
      "claude-code": { kind: "default" },
    });
  });

  it("saves an icon and keeps it for a new instance", async () => {
    const directory = folder();
    await createHostAppearance(directory).setIcon("opencode", "terminal");
    const read = await createHostAppearance(directory).read();
    expect(read.opencode).toEqual({ kind: "icon", icon: "terminal" });
    expect(read.pi).toEqual({ kind: "default" });
  });

  it("refuses an unknown host and a malformed icon name", async () => {
    const appearance = createHostAppearance(folder());
    await rejects(appearance.setIcon("cursor", "terminal"));
    for (const icon of ["../x", "A B", "", "x".repeat(41), "terminal.svg"]) {
      await rejects(appearance.setIcon("pi", icon));
    }
  });

  it("saves a 128 by 128 PNG and returns it as a data URL", async () => {
    const directory = folder();
    const appearance = createHostAppearance(directory);
    const image = png();
    await appearance.setImage("pi", b64(image));
    const read = await appearance.read();
    expect(read.pi.kind).toBe("image");
    expect(read.pi.image).toBe(`data:image/png;base64,${b64(image)}`);
    expect(existsSync(join(directory, "pi.png"))).toBe(true);
  });

  it("leaves no temporary file behind", async () => {
    const directory = folder();
    const appearance = createHostAppearance(directory);
    await appearance.setImage("pi", b64(png()));
    await appearance.setIcon("pi", "bot");
    expect(readdirSync(directory).filter((name) => name.includes(".tmp"))).toEqual([]);
  });

  it("refuses anything that is not a 128 by 128 PNG of at most 256 KB", async () => {
    const appearance = createHostAppearance(folder());
    const cases: Record<string, string> = {
      jpeg: b64(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46])),
      svg: b64(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>')),
      "wrong size": b64(png(64, 64)),
      "wrong shape": b64(png(128, 127)),
      "too large": b64(png(128, 128, 256 * 1024)),
      "no IEND": b64(png().subarray(0, png().length - 12)),
      "bad base64": "!!!not base64!!!",
      empty: "",
    };
    for (const [name, value] of Object.entries(cases)) {
      await rejects(appearance.setImage("opencode", value));
      expect({ name, read: (await appearance.read()).opencode.kind }).toEqual({
        name,
        read: "default",
      });
    }
  });

  it("removes the image when an icon replaces it, and on reset", async () => {
    const directory = folder();
    const appearance = createHostAppearance(directory);
    await appearance.setImage("claude-code", b64(png()));
    await appearance.setIcon("claude-code", "bot");
    expect(existsSync(join(directory, "claude-code.png"))).toBe(false);
    await appearance.setImage("claude-code", b64(png()));
    await appearance.reset("claude-code");
    expect(existsSync(join(directory, "claude-code.png"))).toBe(false);
    expect((await appearance.read())["claude-code"]).toEqual({ kind: "default" });
  });

  it("falls back to the default mark when the image file is missing", async () => {
    const directory = folder();
    const appearance = createHostAppearance(directory);
    await appearance.setImage("pi", b64(png()));
    rmSync(join(directory, "pi.png"));
    expect((await appearance.read()).pi).toEqual({ kind: "default" });
  });

  it("falls back to defaults when the settings file is damaged", async () => {
    const directory = folder();
    await Bun.write(join(directory, "appearance.json"), "{not json");
    expect((await createHostAppearance(directory).read()).pi).toEqual({ kind: "default" });
  });
});
