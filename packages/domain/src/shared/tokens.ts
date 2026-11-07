/**
 * Opaque token helpers built on Web Crypto (available in Node 22, browsers and
 * edge runtimes). Tokens are 32 random bytes encoded base64url. Only a SHA-256
 * hash is stored for lookup, so a database leak does not reveal usable tokens.
 */

const TOKEN_BYTES = 32;

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function generateToken(bytes = TOKEN_BYTES): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return toBase64Url(buf);
}

export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return toBase64Url(new Uint8Array(digest));
}

/** Shape check before any lookup: 43 base64url chars for a 32-byte token. */
export function isWellFormedToken(token: string, bytes = TOKEN_BYTES): boolean {
  const length = Math.ceil((bytes * 4) / 3);
  return token.length === length && /^[A-Za-z0-9_-]+$/.test(token);
}
