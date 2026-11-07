/**
 * Single source of truth for the public brand. Rename the product, change the
 * support address or the legal entity here (or via the NEXT_PUBLIC_* env vars)
 * and every marketing, legal and auth page follows.
 */
export const BRAND = {
  name: "RestaurantOS",
  tagline: "QR ordering, waiter approval, kitchen display and counter billing in one place.",
  description:
    "RestaurantOS is restaurant management software for multi-branch restaurants: QR table ordering without an app, waiter approval, a kitchen display, counter billing and offline-ready staff devices.",
  supportEmail: process.env.NEXT_PUBLIC_SUPPORT_EMAIL || "support@restaurantos.example",
  /** Shown in legal templates. Replace before launch. */
  legalEntity: process.env.NEXT_PUBLIC_LEGAL_ENTITY || "[Your company legal name]",
  jurisdiction: "India",
} as const;

export const SITE_NAV = [
  { href: "/features", label: "Features" },
  { href: "/pricing", label: "Pricing" },
  { href: "/faq", label: "FAQ" },
  { href: "/contact", label: "Contact" },
] as const;

export const LEGAL_NAV = [
  { href: "/legal/privacy", label: "Privacy policy" },
  { href: "/legal/terms", label: "Terms of service" },
  { href: "/legal/refunds", label: "Cancellation & refunds" },
] as const;
