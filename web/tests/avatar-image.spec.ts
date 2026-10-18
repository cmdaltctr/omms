import { expect, it } from "bun:test";
import {
  MAX_AVATAR_BYTES,
  centreSquare,
  checkAvatarFile,
  sniffImageType,
} from "../src/lib/avatar-image";

// Allocate the padding directly. Spreading millions of items into an array took
// 10 seconds on the slow Intel macOS runner and failed a release.
const blob = (bytes: number[], pad = 0) => new Blob([new Uint8Array(bytes), new Uint8Array(pad)]);

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff, 0xe0];
const GIF = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61];
const WEBP = [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50];

it("recognises PNG, JPEG, WebP and GIF from their first bytes", () => {
  expect(sniffImageType(new Uint8Array(PNG))).toBe("png");
  expect(sniffImageType(new Uint8Array(JPEG))).toBe("jpeg");
  expect(sniffImageType(new Uint8Array(GIF))).toBe("gif");
  expect(sniffImageType(new Uint8Array(WEBP))).toBe("webp");
});

it("refuses SVG and other types whatever the file name says", async () => {
  const svg = new Blob(['<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>'], {
    type: "image/png",
  });
  expect(await checkAvatarFile(svg)).toBe("type");
  expect(await checkAvatarFile(blob([0x25, 0x50, 0x44, 0x46]))).toBe("type");
  expect(await checkAvatarFile(blob([]))).toBe("type");
});

it("accepts the four image types", async () => {
  for (const bytes of [PNG, JPEG, GIF, WEBP]) expect(await checkAvatarFile(blob(bytes))).toBeNull();
});

it("refuses a file over 20 MB before reading it", async () => {
  expect(await checkAvatarFile(blob(PNG, MAX_AVATAR_BYTES))).toBe("size");
  expect(await checkAvatarFile(blob(PNG, MAX_AVATAR_BYTES - PNG.length))).toBeNull();
});

it("crops the centre square of a wide, a tall and a square image", () => {
  expect(centreSquare(3000, 1200)).toEqual({ x: 900, y: 0, side: 1200 });
  expect(centreSquare(600, 1000)).toEqual({ x: 0, y: 200, side: 600 });
  expect(centreSquare(128, 128)).toEqual({ x: 0, y: 0, side: 128 });
  expect(centreSquare(101, 100)).toEqual({ x: 0, y: 0, side: 100 });
});
