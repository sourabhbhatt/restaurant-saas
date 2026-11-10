import { describe, expect, it } from "vitest";

import { parsePublicPlans } from "../pricing/plan-model";
import { resolveSiteConfig } from "./site-config";
import { SITE_PAGES } from "./site-pages";
import { pageGraph, planOffers, serializeJsonLd } from "./structured-data";

const PROD = resolveSiteConfig({
  SITE_INDEXABLE: "true",
  PUBLIC_SITE_URL: "https://www.restaurantos.in",
});

/** The public plans as the API returns them (the seeded defaults). */
const { plans } = parsePublicPlans([
  { key: "starter", name: "Starter", currency: "INR", monthlyPrice: 49_900, annualPrice: 499_000 },
  { key: "pro", name: "Pro", currency: "INR", monthlyPrice: 99_900, annualPrice: 999_000 },
  { key: "enterprise", name: "Enterprise", currency: "INR", monthlyPrice: null, annualPrice: null },
]);

type Node = Record<string, unknown>;
const nodes = (graph: Node) => graph["@graph"] as Node[];
const ofType = (graph: Node, type: string) => nodes(graph).filter((n) => n["@type"] === type);

describe("pageGraph", () => {
  it("describes the organisation, website and product on the homepage", () => {
    const graph = pageGraph(PROD, "/", plans);
    expect(graph["@context"]).toBe("https://schema.org");
    const [org] = ofType(graph, "Organization");
    expect(org).toMatchObject({
      "@id": "https://www.restaurantos.in/#organization",
      name: "RestaurantOS",
      url: "https://www.restaurantos.in/",
      logo: { url: "https://www.restaurantos.in/logo.png", width: 512, height: 512 },
    });
    expect(ofType(graph, "WebSite")).toHaveLength(1);
    const [app] = ofType(graph, "WebApplication");
    expect(app).toMatchObject({ applicationCategory: "BusinessApplication", name: "RestaurantOS" });
  });

  it("never publishes ratings, reviews or template placeholders", () => {
    const json = JSON.stringify(pageGraph(PROD, "/", plans));
    expect(json).not.toMatch(/aggregateRating|"review"|ratingValue/);
    // Default contact values are placeholders ("[Your company legal name]", *.example).
    expect(json).not.toContain("[Your company legal name]");
    expect(json).not.toMatch(/restaurantos\.example/);
  });

  it("publishes the runtime contact details once they are real", () => {
    const config = resolveSiteConfig({
      SITE_INDEXABLE: "true",
      PUBLIC_SITE_URL: "https://www.restaurantos.in",
      SITE_SUPPORT_EMAIL: "hello@restaurantos.in",
      SITE_LEGAL_ENTITY: "RestaurantOS Technologies Private Limited",
    });
    const [org] = ofType(pageGraph(config, "/", plans), "Organization");
    expect(org).toMatchObject({
      legalName: "RestaurantOS Technologies Private Limited",
      email: "hello@restaurantos.in",
      contactPoint: { "@type": "ContactPoint", email: "hello@restaurantos.in" },
    });
    const [placeholderOrg] = ofType(pageGraph(PROD, "/", plans), "Organization");
    expect(placeholderOrg).not.toHaveProperty("legalName");
    expect(placeholderOrg).not.toHaveProperty("email");
    expect(placeholderOrg).not.toHaveProperty("contactPoint");
  });

  it("states the live plan prices as offers, excluding custom-priced plans", () => {
    const offers = planOffers(PROD, plans);
    expect(offers.map((o) => [o.name, o.price, o.priceCurrency])).toEqual([
      ["Starter plan, billed monthly", 499, "INR"],
      ["Starter plan, billed yearly", 4990, "INR"],
      ["Pro plan, billed monthly", 999, "INR"],
      ["Pro plan, billed yearly", 9990, "INR"],
    ]);
    expect(offers[0]).toMatchObject({
      url: "https://www.restaurantos.in/pricing",
      priceSpecification: { billingDuration: "P1M", valueAddedTaxIncluded: false },
    });
  });

  it("omits offers when plans could not be loaded", () => {
    const [app] = ofType(pageGraph(PROD, "/pricing", null), "WebApplication");
    expect(app).toBeDefined();
    expect(app).not.toHaveProperty("offers");
  });

  it("publishes a breadcrumb trail matching the visible one on every other page", () => {
    for (const page of SITE_PAGES.filter((p) => p.path !== "/")) {
      const [crumbs] = ofType(pageGraph(PROD, page.path, null), "BreadcrumbList");
      const items = crumbs!.itemListElement as Node[];
      expect(items[0]).toMatchObject({
        position: 1,
        name: "Home",
        item: "https://www.restaurantos.in/",
      });
      expect(items.at(-1)).toMatchObject({
        position: items.length,
        item: `https://www.restaurantos.in${page.path}`,
      });
    }
    const [billing] = ofType(
      pageGraph(PROD, "/features/restaurant-billing", null),
      "BreadcrumbList",
    );
    expect((billing!.itemListElement as Node[]).map((i) => i.name)).toEqual([
      "Home",
      "Features",
      "Restaurant billing",
    ]);
  });

  it("does not emit FAQPage markup (Google retired FAQ rich results in 2026)", () => {
    for (const page of SITE_PAGES) {
      expect(JSON.stringify(pageGraph(PROD, page.path, plans))).not.toContain("FAQPage");
    }
  });
});

describe("serializeJsonLd", () => {
  it("cannot be broken out of with a closing script tag and still parses", () => {
    const data = { name: "</script><script>alert(1)</script> & more" };
    const out = serializeJsonLd(data);
    expect(out).not.toContain("<");
    expect(out).not.toContain(">");
    expect(JSON.parse(out)).toEqual(data);
  });
});
