import { describe, expect, it } from "vitest";

import { SECURITY_HEADERS } from "../security-headers";
import { GOOGLE_ANALYTICS_CSP } from "./gtag";

/** Directive → its CSP fallback chain (CSP Level 3). */
const FALLBACKS: Record<keyof typeof GOOGLE_ANALYTICS_CSP, string[]> = {
  "script-src": ["script-src-elem", "script-src", "default-src"],
  "img-src": ["img-src", "default-src"],
  "connect-src": ["connect-src", "default-src"],
};

function directives(policy: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const part of policy.split(";")) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (name) out.set(name.toLowerCase(), sources);
  }
  return out;
}

describe("Content-Security-Policy and Google Analytics", () => {
  it("lets gtag.js load and send once a Measurement ID is configured", () => {
    // The policy is fixed at build time while the Measurement ID is read at runtime, so if
    // fetch directives are ever added they must list these hosts (docs/growth/analytics-events.md).
    const policy = directives(
      SECURITY_HEADERS.find((h) => h.key === "Content-Security-Policy")?.value ?? "",
    );
    for (const [directive, hosts] of Object.entries(GOOGLE_ANALYTICS_CSP)) {
      const effective = FALLBACKS[directive as keyof typeof GOOGLE_ANALYTICS_CSP]
        .map((name) => policy.get(name))
        .find(Boolean);
      if (!effective || effective.includes("*") || effective.includes("https:")) continue;
      for (const host of hosts)
        expect(effective, `${directive} must allow ${host}`).toContain(host);
    }
  });
});
