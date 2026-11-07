import { describe, expect, it } from "vitest";

import { safeNextPath } from "./safe-next";

describe("safeNextPath", () => {
  it("accepts same-origin relative paths", () => {
    expect(safeNextPath("/app/w/123?tab=menu", "/app")).toBe("/app/w/123?tab=menu");
    expect(safeNextPath("/app#x", "/app")).toBe("/app#x");
  });

  it.each([
    null,
    undefined,
    "",
    "app",
    "//evil.com",
    "/\\evil.com",
    "https://evil.com/app",
    "javascript:alert(1)",
    "/\tevil",
    "/app\\..\\x",
  ])("falls back for %s", (raw) => {
    expect(safeNextPath(raw, "/app")).toBe("/app");
  });

  it("never redirects back to an auth page", () => {
    expect(safeNextPath("/sign-in?next=/app", "/app")).toBe("/app");
    expect(safeNextPath("/sign-up", "/app/onboarding")).toBe("/app/onboarding");
  });
});
