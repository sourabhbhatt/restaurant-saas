import { FeatureDetailPage } from "@ros/web-core/features/site/feature-detail-page";
import { publicPageMetadata } from "@ros/web-core/features/site/seo/page-metadata";
import { PageStructuredData } from "@ros/web-core/features/site/seo/page-structured-data";

export function generateMetadata() {
  return publicPageMetadata("/features/kitchen-display-system");
}

export default function Page() {
  return (
    <>
      <FeatureDetailPage path="/features/kitchen-display-system" />
      <PageStructuredData path="/features/kitchen-display-system" />
    </>
  );
}
