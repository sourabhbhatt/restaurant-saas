import { PrivacyPolicy } from "@ros/web-core/features/site/legal/privacy";
import { publicPageMetadata } from "@ros/web-core/features/site/seo/page-metadata";
import { PageStructuredData } from "@ros/web-core/features/site/seo/page-structured-data";

export function generateMetadata() {
  return publicPageMetadata("/legal/privacy");
}

export default function Page() {
  return (
    <>
      <PrivacyPolicy />
      <PageStructuredData path="/legal/privacy" />
    </>
  );
}
