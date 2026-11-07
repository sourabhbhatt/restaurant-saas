import { describe, expect, it } from "vitest";

import { clientIpFrom } from "./client-ip";

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
