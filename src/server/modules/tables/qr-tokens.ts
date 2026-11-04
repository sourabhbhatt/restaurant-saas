import "server-only";

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

import { generateToken, hashToken, isWellFormedToken } from "@/domain/shared/tokens";

/**
 * QR table tokens. A token is 32 random bytes (base64url) and appears only in
 * the QR URL `/t/<token>`; it contains no internal ids. The database stores:
 * - token_hash (SHA-256) for lookup, and
 * - token_ciphertext (AES-256-GCM, key derived from APP_SECRET) so an
 *   authorized manager can re-download the same QR without regenerating it.
 * Revoking marks the row REVOKED; resolution only accepts ACTIVE tokens.
 */

function key(appSecret: string): Buffer {
  return createHash("sha256").update(`restaurantos:qr:${appSecret}`).digest();
}

export function encryptQrToken(token: string, appSecret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(appSecret), iv);
  const enc = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), enc].map((b) => b.toString("base64url")).join(".");
}

export function decryptQrToken(ciphertext: string, appSecret: string): string {
  const [iv, tag, enc] = ciphertext.split(".").map((p) => Buffer.from(p, "base64url"));
  if (!iv || !tag || !enc) throw new Error("Malformed QR ciphertext");
  const decipher = createDecipheriv("aes-256-gcm", key(appSecret), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}

export async function newQrToken(
  appSecret: string,
): Promise<{ token: string; tokenHash: string; tokenCiphertext: string }> {
  const token = generateToken();
  return {
    token,
    tokenHash: await hashToken(token),
    tokenCiphertext: encryptQrToken(token, appSecret),
  };
}

export { hashToken as hashQrToken, isWellFormedToken as isWellFormedQrToken };

export function qrUrl(appUrl: string, token: string): string {
  return `${appUrl.replace(/\/$/, "")}/t/${token}`;
}
