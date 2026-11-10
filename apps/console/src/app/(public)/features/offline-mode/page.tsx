import { FeatureDetailPage } from "@ros/web-core/features/site/feature-detail-page";
import { publicPageMetadata } from "@ros/web-core/features/site/seo/page-metadata";
import { PageStructuredData } from "@ros/web-core/features/site/seo/page-structured-data";

export function generateMetadata() {
  return publicPageMetadata("/features/offline-mode");
}

export default function Page() {
  return (
    <>
      <FeatureDetailPage path="/features/offline-mode" />
      <PageStructuredData path="/features/offline-mode" />
    </>
  );
}
