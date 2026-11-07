#!/usr/bin/env node
/**
 * Rewrites `@/…` import specifiers to the monorepo package names (Phase 4).
 * Files are moved with `git mv` first; this only touches specifiers, in
 * `import … from`, `export … from`, `import()`, `require()` and `vi.mock()`
 * forms. A specifier that lands inside the file's own package becomes a
 * relative path, so no package imports itself by name.
 *
 * Usage: node scripts/codemod-imports.mjs [--dry] [--only=domain,contracts,...] <file|dir>...
 * `--only` limits the rewrite to specifiers whose first segment after `@/` is
 * listed (for example `--only=server,infrastructure`), so each extraction
 * commit rewrites only the imports it moved.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Infrastructure folders that become `@ros/adapters/<folder>`. */
const ADAPTER_DIRS = ["auth", "email", "logging", "push", "realtime", "storage", "payments"];

/** Features used by two or more apps, or listed as shared client plumbing. */
export const SHARED_FEATURES = [
  "account",
  "analytics",
  "audit",
  "auth",
  "billing",
  "navigation",
  "notifications",
  "offline",
  "orders",
  "realtime",
  "session",
  "site",
  "subscriptions",
  "superadmin",
  "support",
  "workspaces",
];

/** Test helpers that depend on the API composition root stay in apps/api (`@/test/*`). */
const SHARED_TEST_HELPERS = ["server-only-stub", "migrate-to"];

/** Where each package's source lives, for same-package relative rewrites. */
const PACKAGE_DIRS = {
  "@ros/domain": "packages/domain/src",
  "@ros/contracts": "packages/contracts/src",
  "@ros/application": "packages/application/src",
  "@ros/adapters": "packages/adapters/src",
  "@ros/database": "packages/database/src",
  "@ros/testing": "packages/testing/src",
  "@ros/api-client": "packages/api-client/src",
  "@ros/ui": "packages/ui/src",
  "@ros/web-core": "packages/web-core/src",
};

/**
 * Maps one `@/…` specifier to its new form, or returns it unchanged. Pure:
 * the same table as the plan's "Package names and import mapping".
 */
export function mapSpecifier(spec, only = null) {
  if (!spec.startsWith("@/")) return spec;
  const rest = spec.slice(2);
  const [head, ...tail] = rest.split("/");
  const sub = tail.join("/");
  if (only && !only.includes(head)) return spec;

  switch (head) {
    case "domain":
      return `@ros/domain/${sub}`;
    case "contracts":
      return `@ros/contracts/${sub}`;
    case "server": {
      if (sub === "container") return "@/composition/container";
      if (tail[0] === "composition") return `@/composition/${tail.slice(1).join("/")}`;
      return `@ros/application/${sub}`;
    }
    case "infrastructure": {
      const [area, ...inner] = tail;
      if (area === "database") return `@ros/database/${inner.join("/")}`;
      if (ADAPTER_DIRS.includes(area)) return `@ros/adapters/${area}/${inner.join("/")}`;
      return spec;
    }
    case "components": {
      // Pieces that import features or client plumbing live in web-core, so the
      // design system package never depends on it.
      if (sub === "shared/app-providers") return "@ros/web-core/app-providers";
      if (tail[0] === "layouts") return `@ros/web-core/${sub}`;
      return `@ros/ui/${sub}`;
    }
    case "lib": {
      if (sub === "api-client") return "@ros/api-client";
      if (sub === "utils") return "@ros/ui/utils";
      return `@ros/web-core/${sub}`;
    }
    case "features": {
      const [feature] = tail;
      if (SHARED_FEATURES.includes(feature)) return `@ros/web-core/features/${sub}`;
      return spec;
    }
    case "test": {
      if (SHARED_TEST_HELPERS.includes(sub)) return `@ros/testing/${sub}`;
      return spec;
    }
    default:
      return spec;
  }
}

/** The `@ros/*` package a repo-relative file belongs to, if any. */
function packageOf(relFile) {
  for (const [name, dir] of Object.entries(PACKAGE_DIRS)) {
    if (relFile.startsWith(`${dir}/`)) return { name, dir };
  }
  return null;
}

/** Same-package specifiers become relative so packages never self-reference by name. */
function relativize(mapped, relFile) {
  const pkg = packageOf(relFile);
  if (!pkg) return mapped;
  if (mapped !== pkg.name && !mapped.startsWith(`${pkg.name}/`)) return mapped;
  const target =
    mapped === pkg.name
      ? path.posix.join(pkg.dir, "index")
      : path.posix.join(pkg.dir, mapped.slice(pkg.name.length + 1));
  let rel = path.posix.relative(path.posix.dirname(relFile), target);
  if (!rel.startsWith(".")) rel = `./${rel}`;
  return rel;
}

const SPECIFIER_RE =
  /((?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\b(?:mock|doMock|importActual|importMock|unmock)\s*\(\s*)(["']))(@\/[^"']+)(\2)/g;

/**
 * Rewrites every matching specifier in `source`. `relFile` is the file's
 * repo-relative path after its move, used for same-package relative paths.
 */
export function transform(source, relFile = "", only = null) {
  return source.replace(SPECIFIER_RE, (whole, prefix, _quote, spec, suffix) => {
    const mapped = relativize(mapSpecifier(spec, only), relFile);
    return mapped === spec ? whole : `${prefix}${mapped}${suffix}`;
  });
}

const SOURCE_RE = /\.(m?[tj]sx?)$/;

function* walk(target) {
  const stat = statSync(target);
  if (stat.isFile()) {
    // Never rewrite the codemod or its test: their strings are inputs, not imports.
    if (SOURCE_RE.test(target) && !path.basename(target).startsWith("codemod-imports"))
      yield target;
    return;
  }
  for (const entry of readdirSync(target, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".next" || entry.name === ".turbo")
      continue;
    yield* walk(path.join(target, entry.name));
  }
}

function main(argv) {
  const dry = argv.includes("--dry");
  const onlyArg = argv.find((a) => a.startsWith("--only="));
  const only = onlyArg ? onlyArg.slice("--only=".length).split(",").filter(Boolean) : null;
  const targets = argv.filter((a) => !a.startsWith("--"));
  if (targets.length === 0) {
    console.error("usage: codemod-imports.mjs [--dry] <file|dir>...");
    process.exit(2);
  }
  let changed = 0;
  for (const target of targets) {
    for (const file of walk(path.resolve(target))) {
      const relFile = path.relative(REPO_ROOT, file).split(path.sep).join("/");
      const before = readFileSync(file, "utf8");
      const after = transform(before, relFile, only);
      if (after !== before) {
        changed++;
        if (dry) console.log(relFile);
        else writeFileSync(file, after);
      }
    }
  }
  console.error(`${dry ? "would rewrite" : "rewrote"} ${changed} file(s)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
