/** Largest file the avatar upload reads, in bytes. */
export const MAX_AVATAR_BYTES = 20 * 1024 * 1024;
export const AVATAR_SIZE = 128;

export type AvatarTypeError = "type" | "size";

/** The image type from a file's first bytes, or null when it is not PNG, JPEG, WebP or GIF. */
export function sniffImageType(bytes: Uint8Array): "png" | "jpeg" | "webp" | "gif" | null {
  const at = (index: number, ...values: number[]) =>
    values.every((value, offset) => bytes[index + offset] === value);
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "png";
  if (at(0, 0xff, 0xd8, 0xff)) return "jpeg";
  if (at(0, 0x47, 0x49, 0x46, 0x38)) return "gif";
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return "webp";
  return null;
}

/** Refuse a file before it is decoded: a wrong type (SVG included) or more than 20 MB. */
export async function checkAvatarFile(file: Blob): Promise<AvatarTypeError | null> {
  if (file.size > MAX_AVATAR_BYTES) return "size";
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  return sniffImageType(head) ? null : "type";
}

/** The centre square of a width by height image: its offset and side. */
export function centreSquare(
  width: number,
  height: number
): { x: number; y: number; side: number } {
  const side = Math.min(width, height);
  return { x: Math.floor((width - side) / 2), y: Math.floor((height - side) / 2), side };
}

/**
 * Crop the centre square of a checked image and redraw it at 128 × 128 as a PNG.
 * Redrawing drops any embedded metadata. Returns base64 without a prefix.
 */
export async function avatarPng(file: Blob): Promise<string> {
  const bitmap = await createImageBitmap(file);
  try {
    const { x, y, side } = centreSquare(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = AVATAR_SIZE;
    canvas.height = AVATAR_SIZE;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser cannot draw the image");
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, x, y, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
    const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!png) throw new Error("This browser cannot save the image");
    const bytes = new Uint8Array(await png.arrayBuffer());
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  } finally {
    bitmap.close();
  }
}
