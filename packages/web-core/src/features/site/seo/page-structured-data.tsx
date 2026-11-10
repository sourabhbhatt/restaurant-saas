import { connection } from "next/server";
import { Suspense } from "react";

import { loadPublicPlans } from "../pricing/server-plans";
import { getSiteConfig } from "./site-config";
import type { SitePath } from "./site-pages";
import { pageGraph, serializeJsonLd } from "./structured-data";

/** Pages whose graph includes the product with its live prices. */
const PRODUCT_PAGES: readonly SitePath[] = ["/", "/pricing"];

async function StructuredDataScript({ path }: { path: SitePath }) {
  // Absolute URLs and prices come from the runtime environment and the API.
  await connection();
  const plans = PRODUCT_PAGES.includes(path) ? await loadPublicPlans() : null;
  const graph = pageGraph(getSiteConfig(), path, plans?.data.plans ?? null);
  return (
    <script
      type="application/ld+json"
      // Escaped by serializeJsonLd: no value can close the script element.
      dangerouslySetInnerHTML={{ __html: serializeJsonLd(graph) }}
    />
  );
}

/** JSON-LD for a public page, outside the static shell. */
export function PageStructuredData({ path }: { path: SitePath }) {
  return (
    <Suspense fallback={null}>
      <StructuredDataScript path={path} />
    </Suspense>
  );
}
