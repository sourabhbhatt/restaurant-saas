import { readdirSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  PRODUCT_SEGMENTS,
  contentGroupFor,
  sanitizePath,
  sanitizeReferrer,
  sanitizeUrl,
} from "./sanitize";

const ORIGIN = "https://app.example.in";
const UUID = "0b3c6c2e-5d0e-4f43-9d55-0a4c3f0e5c11";
const TOKEN = "GYw3TEwFZ7bpHJOKMnagBoWJxEwV-PffDfEFKcigOg4";

describe("sanitizeUrl strips secrets and identifiers", () => {
  it.each([
    [`/t/${TOKEN}`, "/t/:token"],
    [`/t/${TOKEN}/`, "/t/:token/"],
    [`/invite/${TOKEN}`, "/invite/:token"],
    [`/reset-password?token=${TOKEN}`, "/reset-password"],
    [`/verify-email?token=${TOKEN}&email=asha%40example.com`, "/verify-email"],
    [`/sign-in?next=%2Fapp%2Fw%2F${UUID}`, "/sign-in"],
    [`/app/w/${UUID}/restaurants/${UUID}`, "/app/w/:id/restaurants/:id"],
    [`/app/b/${UUID}/menu#item-42`, "/app/b/:id/menu"],
    ["/app/w/spice-garden/settings", "/app/w/:id/settings"],
    ["/app/w/12345/members", "/app/w/:id/members"],
    ["/legal/privacy", "/legal/privacy"],
    ["/", "/"],
  ])("%s → %s", (input, expected) => {
    expect(sanitizeUrl(`${ORIGIN}${input}`)).toBe(`${ORIGIN}${expected}`);
  });

  it("keeps campaign tags for acquisition reports and drops everything else", () => {
    expect(
      sanitizeUrl(
        `${ORIGIN}/pricing?utm_source=google&utm_medium=cpc&utm_campaign=diwali-2026&ref=abc&q=asha`,
      ),
    ).toBe(`${ORIGIN}/pricing?utm_source=google&utm_medium=cpc&utm_campaign=diwali-2026`);
  });

  it("drops a campaign tag carrying an email, a phone number or a token", () => {
    expect(
      sanitizeUrl(
        `${ORIGIN}/?utm_source=asha%40example.com&utm_medium=9845012345&utm_content=${TOKEN}&utm_term=menu`,
      ),
    ).toBe(`${ORIGIN}/?utm_term=menu`);
  });

  it("redacts unexpected public path segments that look like ids or tokens", () => {
    expect(sanitizePath(`/blog/${TOKEN}`)).toBe("/blog/:redacted");
    expect(sanitizePath("/blog/order-123456")).toBe("/blog/:redacted");
    expect(sanitizePath("/blog/qr-menu-for-cafes")).toBe("/blog/qr-menu-for-cafes");
  });
});

describe("sanitizeReferrer", () => {
  it("keeps only the origin of another site", () => {
    expect(sanitizeReferrer("https://mail.google.com/mail/u/0/#inbox/FMfcgz?x=1", ORIGIN)).toBe(
      "https://mail.google.com/",
    );
  });

  it("sanitizes this site's own pages", () => {
    expect(sanitizeReferrer(`${ORIGIN}/invite/${TOKEN}?a=1`, ORIGIN)).toBe(
      `${ORIGIN}/invite/:token`,
    );
  });

  it.each(["", "not a url", "android-app://com.google.android.gm/"])("drops %j", (r) => {
    expect(sanitizeReferrer(r, ORIGIN)).toBe("");
  });
});

describe("contentGroupFor separates marketing from product", () => {
  it.each([
    ["/", "marketing"],
    ["/pricing", "marketing"],
    ["/legal/terms", "marketing"],
    ["/some-new-seo-page", "marketing"],
    ["/sign-up", "auth"],
    [`/invite/${TOKEN}`, "auth"],
    ["/app", "product"],
    [`/app/w/${UUID}/subscription`, "product"],
    [`/t/${TOKEN}`, null],
    ["/print/tables", null],
    ["/dev/mailbox", null],
    ["/design-system", null],
  ])("%s → %s", (pathname, group) => {
    expect(contentGroupFor(pathname)).toBe(group);
  });
});

describe("PRODUCT_SEGMENTS", () => {
  it("lists every static segment of the console's /app route tree (add new ones here)", () => {
    const root = path.resolve(import.meta.dirname, "../../../../apps/console/src/app/app");
    const found = new Set<string>(["app"]);
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry);
        if (!statSync(full).isDirectory()) continue;
        if (!entry.startsWith("[") && !entry.startsWith("(")) found.add(entry);
        walk(full);
      }
    };
    walk(root);
    expect([...found].sort()).toEqual([...PRODUCT_SEGMENTS].sort());
  });
});
