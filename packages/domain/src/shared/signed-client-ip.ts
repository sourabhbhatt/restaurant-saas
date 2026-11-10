/**
 * Authenticated client-IP forwarding between a frontend's `/api/v1` proxy and
 * the API. The proxy is the only hop that knows the browser's address (its own
 * trusted `X-Forwarded-For` entry); it forwards that address in
 * `x-ros-client-ip` with an HMAC over `v1.<unix seconds>.<ip>` in
 * `x-ros-client-ip-signature`, keyed by a secret both services share. The API
 * accepts the address only when the signature verifies and the timestamp is
 * inside a short replay window; anyone who can reach the API directly can
 * send the headers but cannot forge the signature. Web Crypto only, so the
 * same code runs in the proxy and in the API.
 */

export const CLIENT_IP_HEADER = "x-ros-client-ip";
export const CLIENT_IP_SIGNATURE_HEADER = "x-ros-client-ip-signature";

/** Signatures older (or further in the future) than this are refused. */
export const CLIENT_IP_SIGNATURE_MAX_AGE_MS = 60_000;

const VERSION = "v1";
const SIGNATURE = /^v1\.(\d{1,12})\.([A-Za-z0-9_-]{43})$/;

export type SignedClientIpResult =
  | { ok: true; ip: string }
  | { ok: false; reason: "missing" | "malformed" | "expired" | "signature" };

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const padded = text
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(text.length / 4) * 4, "=");
  const binary = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

const keyCache = new Map<string, Promise<CryptoKey>>();

function hmacKey(secret: string): Promise<CryptoKey> {
  if (!secret) throw new Error("A non-empty secret is required to sign the client IP");
  let key = keyCache.get(secret);
  if (!key) {
    key = crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"],
    );
    // One secret per process in practice; never let a rotation leak memory.
    keyCache.clear();
    keyCache.set(secret, key);
  }
  return key;
}

const payload = (ts: number, ip: string) => new TextEncoder().encode(`${VERSION}.${ts}.${ip}`);

/** Headers to add to the upstream request for `ip`, signed with `secret`. */
export async function signClientIp(input: {
  ip: string;
  secret: string;
  nowMs?: number;
}): Promise<Record<string, string>> {
  const key = await hmacKey(input.secret);
  const ts = Math.floor((input.nowMs ?? Date.now()) / 1000);
  const mac = await crypto.subtle.sign("HMAC", key, payload(ts, input.ip));
  return {
    [CLIENT_IP_HEADER]: input.ip,
    [CLIENT_IP_SIGNATURE_HEADER]: `${VERSION}.${ts}.${toBase64Url(new Uint8Array(mac))}`,
  };
}

/**
 * The forwarded client IP when the signature is valid and fresh. The result
 * says why it was refused so the caller can log it; the IP itself is returned
 * exactly as signed (validate its shape before use).
 */
export async function verifySignedClientIp(
  headers: Headers,
  options: { secret: string; nowMs?: number; maxAgeMs?: number },
): Promise<SignedClientIpResult> {
  const ip = headers.get(CLIENT_IP_HEADER);
  const signature = headers.get(CLIENT_IP_SIGNATURE_HEADER);
  if (ip === null && signature === null) return { ok: false, reason: "missing" };
  if (!ip || !signature || !options.secret) return { ok: false, reason: "malformed" };
  const match = SIGNATURE.exec(signature);
  if (!match) return { ok: false, reason: "malformed" };
  const ts = Number(match[1]);
  const maxAge = options.maxAgeMs ?? CLIENT_IP_SIGNATURE_MAX_AGE_MS;
  const nowSeconds = (options.nowMs ?? Date.now()) / 1000;
  if (Math.abs(nowSeconds - ts) * 1000 > maxAge) return { ok: false, reason: "expired" };
  const key = await hmacKey(options.secret);
  // Web Crypto's verify is constant-time; never compare MACs as strings.
  const ok = await crypto.subtle.verify("HMAC", key, fromBase64Url(match[2]!), payload(ts, ip));
  return ok ? { ok: true, ip } : { ok: false, reason: "signature" };
}
