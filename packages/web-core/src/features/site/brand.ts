/**
 * Single source of truth for the public brand. Rename the product here and
 * every marketing, legal and auth page follows. The support email and legal
 * entity are runtime settings (SITE_SUPPORT_EMAIL, SITE_LEGAL_ENTITY): see
 * seo/site-config.ts and site-contact.tsx.
 */
export const BRAND = {
  name: "RestaurantOS",
  tagline: "QR ordering, waiter approval, kitchen display and counter billing in one place.",
  description:
    "RestaurantOS is restaurant management software for multi-branch restaurants: QR table ordering without an app, waiter approval, a kitchen display, counter billing and offline-ready staff devices.",
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
