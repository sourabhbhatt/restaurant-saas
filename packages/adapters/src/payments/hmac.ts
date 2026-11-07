import { createHmac, timingSafeEqual } from "node:crypto";

export function hmacSha256Hex(secret: string, message: string): string {
  return createHmac("sha256", secret).update(message, "utf8").digest("hex");
}

/**
 * Constant-time comparison of a presented signature with the expected hex
 * digest. Lengths are compared first because `timingSafeEqual` throws on
 * unequal buffers; a wrong-length signature is simply invalid.
 */
export function signatureMatches(expectedHex: string, presented: string): boolean {
  const expected = Buffer.from(expectedHex, "utf8");
  const actual = Buffer.from(presented.trim().toLowerCase(), "utf8");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
