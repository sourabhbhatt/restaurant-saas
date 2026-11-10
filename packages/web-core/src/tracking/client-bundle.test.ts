import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The tracker is mounted in the console's root layout and "Cookie settings"
 * sits in the site footer, so whatever they import eagerly ships to every
 * console page, the marketing site and guest QR pages included. This walks
 * the static import graph of the browser-side tracking code (type-only
 * imports are erased and skipped) and checks:
 * - nothing reaches zod, not even the lazily loaded tracker (full zod alone
 *   is about 34 KB gzip; the catalog's runtime rules are hand-written);
 * - what every page loads up front is the small loader and the footer link:
 *   the tracker itself is a separate chunk, fetched only with a Measurement ID.
 * The measured effect on first-load JavaScript is in the W5 report.
 */
const PACKAGES = path.resolve(import.meta.dirname, "../../..");
const TRACKING = path.resolve(import.meta.dirname);
const at = (...files: string[]) => files.map((f) => path.join(TRACKING, f));

/** All browser-side tracking code, the lazily loaded parts included. */
const BROWSER_ENTRIES = at(
  "tracking-loader.tsx",
  "tracking-client.tsx",
  "privacy-choices.tsx",
  "privacy-choices-menu.tsx",
  "consent-banner.tsx",
  "track.ts",
  "api-events.ts",
  "page-views.ts",
);
/** What the root layout and the site footer load on every page, before any dynamic import. */
const EAGER_ENTRIES = at("tracking-loader.tsx", "privacy-choices.tsx");

const EXTENSIONS = [".ts", ".tsx", "/index.ts", "/index.tsx"];

function resolveFile(base: string): string | null {
  if (/\.(ts|tsx)$/.test(base) && existsSync(base)) return base;
  for (const ext of EXTENSIONS) if (existsSync(base + ext)) return base + ext;
  return null;
}

/** A workspace file, or the bare package name of an external dependency. */
function resolve(specifier: string, from: string): { file: string } | { external: string } {
  if (specifier.startsWith(".")) {
    const file = resolveFile(path.resolve(path.dirname(from), specifier));
    if (!file) throw new Error(`cannot resolve ${specifier} from ${from}`);
    return { file };
  }
  const ros = /^@ros\/([^/]+)(?:\/(.+))?$/.exec(specifier);
  if (ros) {
    const file = resolveFile(path.join(PACKAGES, ros[1]!, "src", ros[2] ?? "index"));
    if (!file) throw new Error(`cannot resolve ${specifier} from ${from}`);
    return { file };
  }
  const parts = specifier.split("/");
  return { external: specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]! };
}

/** Runtime imports of a source file: `import`/`export … from`, side-effect and (optionally) dynamic. */
function runtimeImports(source: string, dynamicToo: boolean): string[] {
  const out: string[] = [];
  const fromClause = /^\s*(?:import|export)\s+(?!type\s)[^'";]*?\sfrom\s+["']([^"']+)["']/gm;
  const sideEffect = /^\s*import\s+["']([^"']+)["']/gm;
  const dynamic = /\bimport\(\s*["']([^"']+)["']\s*\)/g;
  for (const re of dynamicToo ? [fromClause, sideEffect, dynamic] : [fromClause, sideEffect])
    for (const m of source.matchAll(re)) out.push(m[1]!);
  return out;
}

/** Walks the graph from `entries`: the workspace files reached, and each external with its chain. */
function walk(entries: string[], { dynamicToo }: { dynamicToo: boolean }) {
  const parent = new Map<string, string | null>(entries.map((e) => [e, null]));
  const queue = [...entries];
  const externals = new Map<string, string[]>();
  const chain = (file: string) => {
    const out: string[] = [];
    for (let f: string | null = file; f; f = parent.get(f) ?? null)
      out.unshift(path.relative(PACKAGES, f));
    return out;
  };
  while (queue.length) {
    const file = queue.shift()!;
    for (const specifier of runtimeImports(readFileSync(file, "utf8"), dynamicToo)) {
      const target = resolve(specifier, file);
      if ("external" in target) {
        if (!externals.has(target.external))
          externals.set(target.external, [...chain(file), target.external]);
      } else if (!parent.has(target.file)) {
        parent.set(target.file, file);
        queue.push(target.file);
      }
    }
  }
  return { files: [...parent.keys()], externals };
}

describe("browser bundle of growth tracking", () => {
  it("never imports zod, not even in the lazily loaded tracker", () => {
    const { externals } = walk(BROWSER_ENTRIES, { dynamicToo: true });
    expect(externals.get("zod"), `zod via ${externals.get("zod")?.join(" → ")}`).toBeUndefined();
  });

  it("the check sees zod where it is used (control: the platform contracts)", () => {
    const { externals } = walk([path.join(PACKAGES, "contracts/src/platform.ts")], {
      dynamicToo: true,
    });
    expect(externals.has("zod")).toBe(true);
  });

  it("loads only a tiny loader and the footer link up front on every page", () => {
    const { files, externals } = walk(EAGER_ENTRIES, { dynamicToo: false });
    expect(files.map((f) => path.relative(PACKAGES, f)).sort()).toEqual([
      "contracts/src/analytics-consent.ts",
      "web-core/src/tracking/consent.ts",
      "web-core/src/tracking/privacy-choices.tsx",
      "web-core/src/tracking/tracking-loader.tsx",
    ]);
    // Next's own dynamic() and zustand's store: both tiny, the first already in every page.
    expect([...externals.keys()].sort()).toEqual(["next", "zustand"]);
  });

  it("keeps the lazily loaded tracker's dependencies to the expected few", () => {
    const { externals } = walk(BROWSER_ENTRIES, { dynamicToo: true });
    // A new entry here ships with the tracker: check its size before adding it.
    expect([...externals.keys()].sort()).toEqual([
      "class-variance-authority",
      "clsx",
      "lucide-react",
      "next",
      "radix-ui",
      "react",
      "tailwind-merge",
      "zustand",
    ]);
  });
});
