import { describe, expect, it, vi } from "vitest";

import {
  CLIENT_IP_HEADER,
  CLIENT_IP_SIGNATURE_HEADER,
  signClientIp,
} from "@ros/domain/shared/signed-client-ip";

import { clientIpFrom, resolveClientIp } from "./client-ip";

const h = (xff: string) => new Headers({ "x-forwarded-for": xff });

describe("clientIpFrom", () => {
  it("hops 1 takes the last entry", () => {
    expect(clientIpFrom(h("6.6.6.6, 203.0.113.9"), 1)).toBe("203.0.113.9");
  });
  it("spoofed leftmost entries are ignored", () => {
    const headers = h("1.1.1.1, 2.2.2.2, 203.0.113.9");
    expect(clientIpFrom(headers, 1)).toBe("203.0.113.9");
    expect(clientIpFrom(headers, 2)).toBe("2.2.2.2");
  });
  it("hops 0 ignores headers", () => {
    const headers = new Headers({ "x-forwarded-for": "1.1.1.1", "x-real-ip": "2.2.2.2" });
    expect(clientIpFrom(headers, 0)).toBeNull();
  });
  it("returns null when there are fewer entries than hops", () => {
    expect(clientIpFrom(h("1.1.1.1"), 2)).toBeNull();
  });
  it("garbage is rejected", () => {
    expect(clientIpFrom(h("not-an-ip"), 1)).toBeNull();
  });
  it("accepts IPv6 literals", () => {
    expect(clientIpFrom(h("2001:db8::1"), 1)).toBe("2001:db8::1");
  });
});

describe("resolveClientIp", () => {
  const secret = "proxy-shared-secret-for-tests-0123456789";
  const now = new Date("2026-11-10T12:00:00Z");
  // What the API sees on Cloud Run: the frontend's egress address is the trusted hop.
  const egress = "34.93.0.10";
  const signedFrom = async (ip: string, at = now, key = secret) =>
    new Headers({
      "x-forwarded-for": `${ip}, ${egress}`,
      ...(await signClientIp({ ip, secret: key, nowMs: at.getTime() })),
    });

  it("prefers the signed client IP over X-Forwarded-For", async () => {
    const headers = await signedFrom("203.0.113.9");
    const ip = await resolveClientIp(headers, { trustedHops: 1, proxySecret: secret, now });
    expect(ip).toBe("203.0.113.9");
  });

  it("falls back to X-Forwarded-For when no secret is configured", async () => {
    const headers = await signedFrom("203.0.113.9");
    const ip = await resolveClientIp(headers, { trustedHops: 1, proxySecret: undefined, now });
    expect(ip).toBe(egress);
  });

  it("falls back to X-Forwarded-For when the headers are absent", async () => {
    const ip = await resolveClientIp(h(`1.1.1.1, ${egress}`), {
      trustedHops: 1,
      proxySecret: secret,
      now,
    });
    expect(ip).toBe(egress);
  });

  it("ignores an unsigned x-ros-client-ip (direct caller spoofing)", async () => {
    const onRejected = vi.fn();
    const headers = new Headers({
      "x-forwarded-for": `9.9.9.9, ${egress}`,
      [CLIENT_IP_HEADER]: "9.9.9.9",
    });
    const ip = await resolveClientIp(headers, {
      trustedHops: 1,
      proxySecret: secret,
      now,
      onRejected,
    });
    expect(ip).toBe(egress);
    expect(onRejected).toHaveBeenCalledWith("malformed");
  });

  it("ignores a signature made with the wrong secret", async () => {
    const onRejected = vi.fn();
    const headers = await signedFrom("9.9.9.9", now, "another-secret-0123456789abcdefghij");
    const ip = await resolveClientIp(headers, {
      trustedHops: 1,
      proxySecret: secret,
      now,
      onRejected,
    });
    expect(ip).toBe(egress);
    expect(onRejected).toHaveBeenCalledWith("signature");
  });

  it("ignores a replayed signature after the window", async () => {
    const onRejected = vi.fn();
    const headers = await signedFrom("9.9.9.9", new Date(now.getTime() - 5 * 60_000));
    const ip = await resolveClientIp(headers, {
      trustedHops: 1,
      proxySecret: secret,
      now,
      onRejected,
    });
    expect(ip).toBe(egress);
    expect(onRejected).toHaveBeenCalledWith("expired");
  });

  it("ignores a signed value that is not an IP address", async () => {
    const onRejected = vi.fn();
    const headers = new Headers({
      "x-forwarded-for": egress,
      ...(await signClientIp({ ip: "not-an-ip", secret, nowMs: now.getTime() })),
    });
    const ip = await resolveClientIp(headers, {
      trustedHops: 1,
      proxySecret: secret,
      now,
      onRejected,
    });
    expect(ip).toBe(egress);
    expect(onRejected).toHaveBeenCalledWith("malformed");
  });

  it("with hops 0 and a valid signature the signed IP is still used", async () => {
    const headers = new Headers(
      await signClientIp({ ip: "203.0.113.9", secret, nowMs: now.getTime() }),
    );
    const ip = await resolveClientIp(headers, { trustedHops: 0, proxySecret: secret, now });
    expect(ip).toBe("203.0.113.9");
    expect(headers.get(CLIENT_IP_SIGNATURE_HEADER)).toBeTruthy();
  });
});
