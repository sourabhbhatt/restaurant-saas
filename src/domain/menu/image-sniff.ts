/**
 * Image type detection from magic bytes. The client-declared content type and
 * file name are never trusted. Only raster formats a browser renders safely
 * are accepted; SVG (scriptable XML) and everything else is rejected.
 */
export type SniffedImage = { contentType: "image/png" | "image/jpeg" | "image/webp"; ext: string };

const startsWith = (bytes: Uint8Array, sig: readonly number[], offset = 0) =>
  bytes.length >= offset + sig.length && sig.every((b, i) => bytes[offset + i] === b);

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
const JPEG = [0xff, 0xd8, 0xff] as const;
const RIFF = [0x52, 0x49, 0x46, 0x46] as const; // "RIFF"
const WEBP = [0x57, 0x45, 0x42, 0x50] as const; // "WEBP"

export function sniffImage(bytes: Uint8Array): SniffedImage | null {
  if (startsWith(bytes, PNG)) return { contentType: "image/png", ext: "png" };
  if (startsWith(bytes, JPEG)) return { contentType: "image/jpeg", ext: "jpg" };
  if (startsWith(bytes, RIFF) && startsWith(bytes, WEBP, 8)) {
    return { contentType: "image/webp", ext: "webp" };
  }
  return null;
}

/**
 * Additional storage (whole MB, as plans count it) that adding `addBytes` to
 * `currentBytes` consumes: ceil(total) − ceil(current). Using this as the
 * "adding" amount makes `current + adding` equal the rounded-up new total.
 */
export function additionalStorageMb(currentBytes: number, addBytes: number): number {
  const MB = 1024 * 1024;
  return Math.ceil((currentBytes + addBytes) / MB) - Math.ceil(currentBytes / MB);
}
