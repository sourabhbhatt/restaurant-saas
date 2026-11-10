/**
 * URL hygiene for analytics: what GA4 may see of the page the visitor is on.
 * Paths keep their shape but lose every identifier (tokens, UUIDs, numeric
 * ids); query strings keep only campaign tags; fragments are dropped.
 */

/** Routes that carry a secret token as their second segment. */
const TOKEN_ROUTES = new Set(["t", "invite"]);

/**
 * Static segments of the signed-in app (`apps/console/src/app/app/**`). Under
 * `/app` anything else is a tenant id and becomes `:id`; a test keeps this
 * list in step with the route tree.
 */
export const PRODUCT_SEGMENTS = new Set([
  "app",
  "account",
  "analytics",
  "audit",
  "b",
  "bills",
  "members",
  "menu",
  "notifications",
  "onboarding",
  "orders",
  "reports",
  "restaurants",
  "settings",
  "staff",
  "subscription",
  "support",
  "tables",
  "w",
]);

/**
 * Static segments of the public site and the auth pages (`(public)/**`,
 * `(auth)/**`). Outside `/app` anything else (a future tenant slug such as
 * `/r/spice-garden`, a token, a mistyped URL) becomes `:redacted`; a test
 * keeps this list in step with the route tree.
 */
export const PUBLIC_SEGMENTS = new Set([
  "contact",
  "faq",
  "features",
  "forgot-password",
  "invite",
  "kitchen-display-system",
  "legal",
  "offline-mode",
  "pricing",
  "privacy",
  "qr-code-ordering",
  "refunds",
  "reset-password",
  "restaurant-billing",
  "sign-in",
  "sign-up",
  "terms",
  "verify-email",
]);

/** Campaign parameters GA4 uses for acquisition; everything else (token, next, email, q) is dropped. */
const KEPT_QUERY = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "utm_id",
]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function sanitizeSegment(segment: string, inProduct: boolean): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    return ":redacted";
  }
  if (UUID.test(decoded) || /^\d+$/.test(decoded)) return ":id";
  if (inProduct) return PRODUCT_SEGMENTS.has(decoded) ? decoded : ":id";
  return PUBLIC_SEGMENTS.has(decoded) ? decoded : ":redacted";
}

/** `/t/<token>` → `/t/:token`, `/app/w/<uuid>/menu` → `/app/w/:id/menu`. */
export function sanitizePath(pathname: string): string {
  const segments = pathname.split("/");
  const inProduct = segments[1] === "app";
  const out = segments.map((segment, i) => {
    if (!segment) return segment;
    if (i === 1 && TOKEN_ROUTES.has(segment)) return segment;
    if (i === 2 && TOKEN_ROUTES.has(segments[1]!)) return ":token";
    return sanitizeSegment(segment, inProduct);
  });
  const path = out.join("/") || "/";
  return path.length > 200 ? path.slice(0, 200) : path;
}

function keptQuery(search: URLSearchParams): string {
  const kept = new URLSearchParams();
  for (const [key, value] of search) {
    const k = key.toLowerCase();
    // A campaign tag may not smuggle an address, a phone number or a token in.
    if (
      KEPT_QUERY.has(k) &&
      /^[A-Za-z0-9 ._+-]{1,100}$/.test(value) &&
      !/\d{6,}/.test(value) &&
      !/[A-Za-z0-9_-]{24,}/.test(value)
    )
      kept.set(k, value);
  }
  const s = kept.toString();
  return s ? `?${s}` : "";
}

/** Absolute page_location for GA4: origin + sanitized path + campaign tags only. */
export function sanitizeUrl(href: string): string {
  const url = new URL(href);
  return `${url.origin}${sanitizePath(url.pathname)}${keptQuery(url.searchParams)}`;
}

/**
 * page_referrer for GA4. Another site: its origin only (all that source
 * attribution needs). This site: the sanitized path. Anything else: nothing.
 */
export function sanitizeReferrer(referrer: string, ownOrigin: string): string {
  if (!referrer) return "";
  try {
    const url = new URL(referrer);
    if (!["http:", "https:"].includes(url.protocol)) return "";
    if (url.origin !== ownOrigin) return `${url.origin}/`;
    return `${url.origin}${sanitizePath(url.pathname)}`;
  } catch {
    return "";
  }
}

/**
 * GA4's built-in `content_group`: separates marketing acquisition (the
 * public site) from product use (the signed-in app) within one stream.
 */
export type ContentGroup = "marketing" | "auth" | "product";

/** Never measured: guest QR ordering (diners get no banner and no analytics cookies), print, dev. */
const UNTRACKED = ["/t", "/print", "/dev", "/design-system", "/~offline", "/serwist", "/api"];
const AUTH = [
  "/sign-in",
  "/sign-up",
  "/forgot-password",
  "/reset-password",
  "/verify-email",
  "/invite",
];

/** Null for an untracked route; any other public page counts as marketing. */
export function contentGroupFor(pathname: string): ContentGroup | null {
  const p = pathname.replace(/\/+$/, "") || "/";
  const under = (prefix: string) => p === prefix || p.startsWith(`${prefix}/`);
  if (UNTRACKED.some(under)) return null;
  if (AUTH.some(under)) return "auth";
  if (under("/app")) return "product";
  return "marketing";
}
