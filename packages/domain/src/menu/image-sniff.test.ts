import { describe, expect, it } from "vitest";

import { additionalStorageMb, sniffImage } from "./image-sniff";

const bytes = (...b: number[]) => new Uint8Array(b);
const ascii = (s: string) => new TextEncoder().encode(s);

describe("sniffImage", () => {
  it("detects PNG, JPEG and WebP from magic bytes", () => {
    expect(sniffImage(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0))).toEqual({
      contentType: "image/png",
      ext: "png",
    });
    expect(sniffImage(bytes(0xff, 0xd8, 0xff, 0xe0))?.contentType).toBe("image/jpeg");
    const webp = new Uint8Array([...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WEBPVP8 ")]);
    expect(sniffImage(webp)?.ext).toBe("webp");
  });

  it("rejects SVG, GIF, truncated and RIFF non-WebP data", () => {
    expect(sniffImage(ascii("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toBeNull();
    expect(sniffImage(ascii("<?xml version='1.0'?><svg/>"))).toBeNull();
    expect(sniffImage(ascii("GIF89a"))).toBeNull();
    expect(sniffImage(bytes(0x89, 0x50))).toBeNull();
    expect(sniffImage(new Uint8Array([...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WAVE")]))).toBeNull();
    expect(sniffImage(new Uint8Array())).toBeNull();
  });
});

describe("additionalStorageMb", () => {
  const MB = 1024 * 1024;
  it("counts only the whole MBs newly started", () => {
    expect(additionalStorageMb(0, 1)).toBe(1);
    expect(additionalStorageMb(0, MB)).toBe(1);
    expect(additionalStorageMb(0, MB + 1)).toBe(2);
    expect(additionalStorageMb(0.5 * MB, 0.25 * MB)).toBe(0);
    expect(additionalStorageMb(0.9 * MB, 0.2 * MB)).toBe(1);
  });
});
