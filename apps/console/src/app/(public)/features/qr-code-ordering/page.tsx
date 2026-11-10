import { FeatureDetailPage } from "@ros/web-core/features/site/feature-detail-page";
import { publicPageMetadata } from "@ros/web-core/features/site/seo/page-metadata";
import { PageStructuredData } from "@ros/web-core/features/site/seo/page-structured-data";

export function generateMetadata() {
  return publicPageMetadata("/features/qr-code-ordering");
}

export default function Page() {
  return (
    <>
      <FeatureDetailPage path="/features/qr-code-ordering" />
      <PageStructuredData path="/features/qr-code-ordering" />
    </>
  );
}
