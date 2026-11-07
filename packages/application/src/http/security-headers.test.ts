import { describe, expect, it } from "vitest";
import { SECURITY_HEADERS } from "./security-headers";

const byKey = (key: string) => SECURITY_HEADERS.find((h) => h.key === key)?.value;

describe("SECURITY_HEADERS", () => {
  it.each([
    ["X-Content-Type-Options", "nosniff"],
    ["Referrer-Policy", "strict-origin-when-cross-origin"],
    ["X-Frame-Options", "DENY"],
    ["Strict-Transport-Security", "max-age=31536000; includeSubDomains"],
    [
      "Content-Security-Policy",
      "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'",
    ],
    ["Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()"],
  ])("sets %s exactly", (key, value) => {
    expect(byKey(key)).toBe(value);
  });

  it("does not set a script-src directive (needs nonces; out of scope)", () => {
    expect(byKey("Content-Security-Policy")).not.toContain("script-src");
  });
});
