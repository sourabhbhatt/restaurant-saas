import { FeaturesPage } from "@ros/web-core/features/site/features-page";
import { publicPageMetadata } from "@ros/web-core/features/site/seo/page-metadata";
import { PageStructuredData } from "@ros/web-core/features/site/seo/page-structured-data";

export function generateMetadata() {
  return publicPageMetadata("/features");
}

export default function Page() {
  return (
    <>
      <FeaturesPage />
      <PageStructuredData path="/features" />
    </>
  );
}
