import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { SITE_PAGES } from "@ros/web-core/features/site/seo/site-pages";

const APP_DIR = import.meta.dirname;
const PUBLIC_DIR = path.join(APP_DIR, "(public)");

/** Route path of every page.tsx under (public), e.g. "(public)/legal/terms/page.tsx" → "/legal/terms". */
function publicRoutes(dir = PUBLIC_DIR, prefix = ""): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return publicRoutes(full, `${prefix}/${name}`);
    return name === "page.tsx" ? [prefix || "/"] : [];
  });
}

const pageFile = (route: string) =>
  route === "/" ? path.join(APP_DIR, "page.tsx") : path.join(PUBLIC_DIR, route, "page.tsx");

describe("public pages and the SEO page list", () => {
  it("every listed page exists, so the sitemap never points at a 404", () => {
    for (const page of SITE_PAGES) expect(() => statSync(pageFile(page.path))).not.toThrow();
  });

  it("every public page is listed, so none ships without metadata and canonical", () => {
    const listed = new Set<string>(SITE_PAGES.map((p) => p.path));
    for (const route of publicRoutes()) expect(listed.has(route)).toBe(true);
  });

  it("every public page uses the runtime metadata and JSON-LD helpers for its own path", () => {
    for (const page of SITE_PAGES) {
      const source = readFileSync(pageFile(page.path), "utf8");
      expect(source).toContain(`publicPageMetadata("${page.path}")`);
      expect(source).toContain(`<PageStructuredData path="${page.path}" />`);
    }
  });
});
