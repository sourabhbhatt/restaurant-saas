import { TermsOfService } from "@ros/web-core/features/site/legal/terms";
import { publicPageMetadata } from "@ros/web-core/features/site/seo/page-metadata";
import { PageStructuredData } from "@ros/web-core/features/site/seo/page-structured-data";

export function generateMetadata() {
  return publicPageMetadata("/legal/terms");
}

export default function Page() {
  return (
    <>
      <TermsOfService />
      <PageStructuredData path="/legal/terms" />
    </>
  );
}
