/**
 * Public-site configuration read from the runtime environment, so one image
 * runs in every environment. Search indexing is opt-in: it is allowed only when
 * `SITE_INDEXABLE=true` AND `PUBLIC_SITE_URL` is an https origin on a host that
 * is not a development or platform-default host (localhost, IPs, *.run.app ...).
 * Everything else (local, CI, staging) is served with noindex.
 */

export interface SiteEnv {
  PUBLIC_SITE_URL?: string;
  SITE_INDEXABLE?: string;
  CONSOLE_URL?: string;
}

export interface SiteConfig {
  /** Origin used for canonical URLs, Open Graph, JSON-LD and the sitemap (no trailing slash). */
  origin: string;
  /** Lower-case host of `origin` (with a non-default port, if any). */
  host: string;
  /** True only for the production public site. */
  indexable: boolean;
  /** Why the site is (not) indexable; logged and shown in tests. */
  reason: string;
}

const LOCAL_ORIGIN = "http://localhost:3000";

/**
 * Hosts that must never be indexed even if SITE_INDEXABLE is set by mistake:
 * local hosts, IP literals, platform-default URLs (Cloud Run, Firebase Hosting)
 * and private-use names. A production site needs its own domain.
 */
const NON_PRODUCTION_SUFFIXES = [
  ".run.app",
  ".web.app",
  ".firebaseapp.com",
  ".localhost",
  ".local",
  ".internal",
];

export function isNonProductionHost(host: string): boolean {
  const name = host.toLowerCase().replace(/:\d+$/, "");
  if (name === "localhost" || name.startsWith("[")) return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(name)) return true;
  return NON_PRODUCTION_SUFFIXES.some((suffix) => name.endsWith(suffix));
}

function parseOrigin(raw: string | undefined): URL | null {
  if (!raw) return null;
  try {
    const url = new URL(raw.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

export function resolveSiteConfig(env: SiteEnv): SiteConfig {
  const explicit = parseOrigin(env.PUBLIC_SITE_URL);
  const base = explicit ?? parseOrigin(env.CONSOLE_URL) ?? new URL(LOCAL_ORIGIN);
  const origin = base.origin;
  const host = base.host.toLowerCase();

  let reason: string;
  if (env.SITE_INDEXABLE !== "true") reason = "SITE_INDEXABLE is not 'true'";
  else if (!explicit) reason = "PUBLIC_SITE_URL is missing or invalid";
  else if (explicit.protocol !== "https:") reason = "PUBLIC_SITE_URL is not https";
  else if (isNonProductionHost(host)) reason = `${host} is a development or platform-default host`;
  else reason = "production public site";

  return { origin, host, indexable: reason === "production public site", reason };
}

/** Reads the environment; call it only at request time (after `connection()`). */
export function getSiteConfig(): SiteConfig {
  return resolveSiteConfig({
    PUBLIC_SITE_URL: process.env.PUBLIC_SITE_URL,
    SITE_INDEXABLE: process.env.SITE_INDEXABLE,
    CONSOLE_URL: process.env.CONSOLE_URL,
  });
}

/** Absolute URL of a site path. The homepage is `origin/`. */
export function absoluteUrl(config: Pick<SiteConfig, "origin">, path: string): string {
  const clean = path.startsWith("/") ? path : `/${path}`;
  return `${config.origin}${clean}`;
}
