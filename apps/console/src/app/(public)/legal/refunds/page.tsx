import { RefundPolicy } from "@ros/web-core/features/site/legal/refunds";
import { publicPageMetadata } from "@ros/web-core/features/site/seo/page-metadata";
import { PageStructuredData } from "@ros/web-core/features/site/seo/page-structured-data";

export function generateMetadata() {
  return publicPageMetadata("/legal/refunds");
}

export default function Page() {
  return (
    <>
      <RefundPolicy />
      <PageStructuredData path="/legal/refunds" />
    </>
  );
}
