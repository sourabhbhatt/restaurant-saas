import { PricingPage } from "@ros/web-core/features/site/pricing-page";
import { publicPageMetadata } from "@ros/web-core/features/site/seo/page-metadata";
import { PageStructuredData } from "@ros/web-core/features/site/seo/page-structured-data";

export function generateMetadata() {
  return publicPageMetadata("/pricing");
}

export default function Page() {
  return (
    <>
      <PricingPage />
      <PageStructuredData path="/pricing" />
    </>
  );
}
