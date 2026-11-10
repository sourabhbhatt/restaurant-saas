import { isCurrencyCode, toMajor } from "@ros/domain/shared/money";
import { ADVERTISED_FEATURES, FEATURES } from "@ros/domain/subscriptions/entitlements";

import { BRAND } from "../brand";
import type { PublicPlan } from "../pricing/plan-model";
import { absoluteUrl, type SiteConfig } from "./site-config";
import { breadcrumbTrail, type SitePath } from "./site-pages";

/**
 * schema.org JSON-LD for the public site. Only facts that are visible on the
 * page and true in the product: no ratings, reviews, customer counts or
 * placeholder contact details. FAQPage is deliberately not emitted: Google
 * stopped showing FAQ rich results in May 2026 (see docs/growth/seo-strategy.md).
 */

type Node = Record<string, unknown>;

/** Logo for Organization markup, rendered by app/logo.png/route.tsx. */
export const LOGO = { path: "/logo.png", size: 512 } as const;

const ids = (config: SiteConfig) => ({
  organization: absoluteUrl(config, "/#organization"),
  website: absoluteUrl(config, "/#website"),
  app: absoluteUrl(config, "/#software"),
});

export function organizationNode(config: SiteConfig): Node {
  const node: Node = {
    "@type": "Organization",
    "@id": ids(config).organization,
    name: BRAND.name,
    url: absoluteUrl(config, "/"),
    logo: {
      "@type": "ImageObject",
      url: absoluteUrl(config, LOGO.path),
      width: LOGO.size,
      height: LOGO.size,
    },
    description: BRAND.description,
    areaServed: { "@type": "Country", name: "India" },
  };
  // Runtime settings; placeholders ("[…]", *.example) are never published.
  const { contact } = config;
  if (!contact.legalEntityIsPlaceholder) node.legalName = contact.legalEntity;
  if (!contact.supportEmailIsPlaceholder) {
    node.email = contact.supportEmail;
    node.contactPoint = {
      "@type": "ContactPoint",
      contactType: "customer support",
      email: contact.supportEmail,
      availableLanguage: ["English"],
    };
  }
  return node;
}

export function websiteNode(config: SiteConfig): Node {
  return {
    "@type": "WebSite",
    "@id": ids(config).website,
    url: absoluteUrl(config, "/"),
    name: BRAND.name,
    description: BRAND.description,
    inLanguage: "en-IN",
    publisher: { "@id": ids(config).organization },
  };
}

function price(minor: number, currency: string): number {
  return toMajor(minor, isCurrencyCode(currency) ? currency : "INR");
}

/** One Offer per published price (monthly and/or annual). Custom-priced plans have none. */
export function planOffers(config: SiteConfig, plans: readonly PublicPlan[]): Node[] {
  const url = absoluteUrl(config, "/pricing");
  return plans.flatMap((plan) => {
    const offers: Node[] = [];
    const add = (minor: number | null, period: "P1M" | "P1Y", label: string) => {
      if (minor == null || minor <= 0) return;
      const amount = price(minor, plan.currency);
      offers.push({
        "@type": "Offer",
        name: `${plan.name} plan, billed ${label}`,
        url,
        price: amount,
        priceCurrency: plan.currency,
        priceSpecification: {
          "@type": "UnitPriceSpecification",
          price: amount,
          priceCurrency: plan.currency,
          billingDuration: period,
          valueAddedTaxIncluded: false,
        },
      });
    };
    add(plan.monthlyPrice, "P1M", "monthly");
    add(plan.annualPrice, "P1Y", "yearly");
    return offers;
  });
}

/**
 * The product. No aggregateRating/review: there are no genuine ones yet, so
 * Google's software-app rich result is not expected; the markup still states
 * what the product is, its category and its published prices.
 */
export function softwareNode(config: SiteConfig, plans: readonly PublicPlan[] | null): Node {
  const node: Node = {
    "@type": "WebApplication",
    "@id": ids(config).app,
    name: BRAND.name,
    url: absoluteUrl(config, "/"),
    description: BRAND.description,
    applicationCategory: "BusinessApplication",
    applicationSubCategory: "Restaurant management software",
    operatingSystem: "Any (runs in a web browser; installable as a PWA)",
    browserRequirements: "A current version of Chrome, Edge, Safari or Firefox",
    inLanguage: "en-IN",
    featureList: [
      ...ADVERTISED_FEATURES.map((f) => FEATURES[f]),
      "Waiter approval of guest orders",
      "Counter billing with taxes, service charge, discounts and split payments",
      "Offline-ready staff devices",
    ],
    publisher: { "@id": ids(config).organization },
  };
  const offers = plans ? planOffers(config, plans) : [];
  if (offers.length > 0) node.offers = offers;
  return node;
}

export function breadcrumbNode(config: SiteConfig, path: SitePath): Node {
  return {
    "@type": "BreadcrumbList",
    itemListElement: breadcrumbTrail(path).map((page, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: page.label,
      item: absoluteUrl(config, page.path),
    })),
  };
}

/** The JSON-LD graph for a public page. */
export function pageGraph(
  config: SiteConfig,
  path: SitePath,
  plans: readonly PublicPlan[] | null,
): Node {
  const graph: Node[] = [];
  if (path === "/") {
    graph.push(organizationNode(config), websiteNode(config), softwareNode(config, plans));
  } else {
    if (path === "/pricing") graph.push(organizationNode(config), softwareNode(config, plans));
    graph.push(breadcrumbNode(config, path));
  }
  return { "@context": "https://schema.org", "@graph": graph };
}

/**
 * JSON for a `<script type="application/ld+json">`. `<`, `>` and `&` are
 * escaped so no value can close the script element (see the Next.js JSON-LD guide).
 */
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}
