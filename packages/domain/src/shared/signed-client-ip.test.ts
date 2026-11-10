import { describe, expect, it } from "vitest";

import {
  CLIENT_IP_HEADER,
  CLIENT_IP_SIGNATURE_HEADER,
  signClientIp,
  verifySignedClientIp,
} from "./signed-client-ip";

const secret = "proxy-shared-secret-for-tests-0123456789";
const now = Date.UTC(2026, 10, 10, 12, 0, 0);

async function signed(ip: string, at = now, key = secret): Promise<Headers> {
  return new Headers(await signClientIp({ ip, secret: key, nowMs: at }));
}

describe("signClientIp / verifySignedClientIp", () => {
  it("round-trips the client IP", async () => {
    const headers = await signed("203.0.113.9");
    expect(headers.get(CLIENT_IP_HEADER)).toBe("203.0.113.9");
    expect(headers.get(CLIENT_IP_SIGNATURE_HEADER)).toMatch(/^v1\.\d+\.[A-Za-z0-9_-]+$/);
    await expect(verifySignedClientIp(headers, { secret, nowMs: now })).resolves.toEqual({
      ok: true,
      ip: "203.0.113.9",
    });
  });

  it("accepts IPv6 literals", async () => {
    const headers = await signed("2001:db8::1");
    const result = await verifySignedClientIp(headers, { secret, nowMs: now });
    expect(result).toEqual({ ok: true, ip: "2001:db8::1" });
  });

  it("returns missing when neither header is present", async () => {
    const result = await verifySignedClientIp(new Headers(), { secret, nowMs: now });
    expect(result).toEqual({ ok: false, reason: "missing" });
  });

  it("rejects an IP header without a signature", async () => {
    const headers = new Headers({ [CLIENT_IP_HEADER]: "1.2.3.4" });
    const result = await verifySignedClientIp(headers, { secret, nowMs: now });
    expect(result).toEqual({ ok: false, reason: "malformed" });
  });

  it("rejects a signature made with another secret", async () => {
    const headers = await signed("203.0.113.9", now, "a-different-secret-0123456789abcdef");
    const result = await verifySignedClientIp(headers, { secret, nowMs: now });
    expect(result).toEqual({ ok: false, reason: "signature" });
  });

  it("rejects a swapped IP under a valid signature", async () => {
    const headers = await signed("203.0.113.9");
    headers.set(CLIENT_IP_HEADER, "9.9.9.9");
    const result = await verifySignedClientIp(headers, { secret, nowMs: now });
    expect(result).toEqual({ ok: false, reason: "signature" });
  });

  it("rejects a tampered timestamp", async () => {
    const headers = await signed("203.0.113.9");
    const [v, ts, sig] = headers.get(CLIENT_IP_SIGNATURE_HEADER)!.split(".");
    headers.set(CLIENT_IP_SIGNATURE_HEADER, `${v}.${Number(ts) + 1}.${sig}`);
    const result = await verifySignedClientIp(headers, { secret, nowMs: now });
    expect(result).toEqual({ ok: false, reason: "signature" });
  });

  it("rejects a signature older than the replay window", async () => {
    const headers = await signed("203.0.113.9", now - 61_000);
    const result = await verifySignedClientIp(headers, { secret, nowMs: now });
    expect(result).toEqual({ ok: false, reason: "expired" });
    // Inside the window it is still fine.
    const fresh = await signed("203.0.113.9", now - 59_000);
    expect((await verifySignedClientIp(fresh, { secret, nowMs: now })).ok).toBe(true);
  });

  it("rejects a signature from the future beyond the allowed skew", async () => {
    const headers = await signed("203.0.113.9", now + 61_000);
    const result = await verifySignedClientIp(headers, { secret, nowMs: now });
    expect(result).toEqual({ ok: false, reason: "expired" });
  });

  it("honours a custom replay window", async () => {
    const headers = await signed("203.0.113.9", now - 5_000);
    const result = await verifySignedClientIp(headers, { secret, nowMs: now, maxAgeMs: 2_000 });
    expect(result).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects malformed signature headers", async () => {
    for (const value of ["", "v1", "v2.1.abc", "v1.notanumber.abc", "v1.1.", "v1.1.$$$"]) {
      const headers = new Headers({
        [CLIENT_IP_HEADER]: "203.0.113.9",
        [CLIENT_IP_SIGNATURE_HEADER]: value,
      });
      const result = await verifySignedClientIp(headers, { secret, nowMs: now });
      expect(result.ok).toBe(false);
    }
  });

  it("refuses to sign with an empty secret", async () => {
    await expect(signClientIp({ ip: "203.0.113.9", secret: "", nowMs: now })).rejects.toThrow();
  });
});
