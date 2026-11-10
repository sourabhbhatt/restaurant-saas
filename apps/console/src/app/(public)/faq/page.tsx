import { FaqPage } from "@ros/web-core/features/site/faq-page";
import { publicPageMetadata } from "@ros/web-core/features/site/seo/page-metadata";
import { PageStructuredData } from "@ros/web-core/features/site/seo/page-structured-data";

export function generateMetadata() {
  return publicPageMetadata("/faq");
}

export default function Page() {
  return (
    <>
      <FaqPage />
      <PageStructuredData path="/faq" />
    </>
  );
}
