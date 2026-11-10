import { PricingPage } from "@ros/web-core/features/site/pricing-page";
import { loadPublicPlans } from "@ros/web-core/features/site/pricing/server-plans";
import {
  pricingPageDescription,
  publicPageMetadata,
} from "@ros/web-core/features/site/seo/page-metadata";
import { PageStructuredData } from "@ros/web-core/features/site/seo/page-structured-data";

export function generateMetadata() {
  // The starting price from the same cached plans as the cards and the JSON-LD.
  return publicPageMetadata("/pricing", {
    description: async () => pricingPageDescription((await loadPublicPlans())?.data ?? null),
  });
}

export default function Page() {
  return (
    <>
      <PricingPage />
      <PageStructuredData path="/pricing" />
    </>
  );
}
