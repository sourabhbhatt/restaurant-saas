import { describe, expect, it } from "vitest";

import { SECURITY_HEADERS } from "../security-headers";
import { GOOGLE_ANALYTICS_CSP } from "./gtag";

type GaDirective = keyof typeof GOOGLE_ANALYTICS_CSP;

/** Directive → its CSP fallback chain (CSP Level 3). */
const FALLBACKS: Record<GaDirective, string[]> = {
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

/** Why `policy` would stop gtag.js loading or sending; empty when GA works under it. */
function gaBlockers(policy: string): string[] {
  const parsed = directives(policy);
  const problems: string[] = [];
  for (const [directive, hosts] of Object.entries(GOOGLE_ANALYTICS_CSP) as [
    GaDirective,
    readonly string[],
  ][]) {
    const name = FALLBACKS[directive].find((n) => parsed.has(n));
    if (!name) continue; // No directive in the chain: the browser allows everything.
    const sources = parsed.get(name)!;
    if (directive === "script-src" && sources.includes("'strict-dynamic'")) {
      problems.push(`${name}: 'strict-dynamic' ignores host lists; pass the nonce to <Script>`);
      continue;
    }
    if (sources.includes("*") || sources.includes("https:")) continue;
    for (const host of hosts) if (!sources.includes(host)) problems.push(`${name}: ${host}`);
  }
  return problems;
}

const shipped = SECURITY_HEADERS.find((h) => h.key === "Content-Security-Policy")?.value ?? "";

describe("Content-Security-Policy and Google Analytics", () => {
  it("the policy we ship lets gtag.js load and send once a Measurement ID is configured", () => {
    // The policy is fixed at build time while the Measurement ID is read at runtime, so if
    // fetch directives are ever added they must list these hosts (docs/growth/analytics-events.md).
    expect(gaBlockers(shipped)).toEqual([]);
  });

  it("catches a stricter policy that would block it, directive by directive", () => {
    expect(gaBlockers("default-src 'self'")).toEqual([
      "default-src: https://www.googletagmanager.com",
      "default-src: https://www.googletagmanager.com",
      "default-src: https://*.google-analytics.com",
      "default-src: https://www.googletagmanager.com",
      "default-src: https://*.google-analytics.com",
      "default-src: https://*.google.com",
    ]);
    expect(gaBlockers("script-src 'self'; img-src *; connect-src https:")).toEqual([
      "script-src: https://www.googletagmanager.com",
    ]);
  });

  it("accepts a strict policy that lists Google's hosts (what a future fetch policy must add)", () => {
    const policy = [
      "default-src 'self'",
      `script-src 'self' ${GOOGLE_ANALYTICS_CSP["script-src"].join(" ")}`,
      `img-src 'self' data: ${GOOGLE_ANALYTICS_CSP["img-src"].join(" ")}`,
      `connect-src 'self' ${GOOGLE_ANALYTICS_CSP["connect-src"].join(" ")}`,
    ].join("; ");
    expect(gaBlockers(policy)).toEqual([]);
  });

  it("flags a nonce + 'strict-dynamic' script policy: hosts are ignored there", () => {
    expect(gaBlockers("script-src 'nonce-r4nd0m' 'strict-dynamic'")).toEqual([
      "script-src: 'strict-dynamic' ignores host lists; pass the nonce to <Script>",
    ]);
  });
});
