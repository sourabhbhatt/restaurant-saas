import { ContactPage } from "@ros/web-core/features/site/contact-page";
import { publicPageMetadata } from "@ros/web-core/features/site/seo/page-metadata";
import { PageStructuredData } from "@ros/web-core/features/site/seo/page-structured-data";

export function generateMetadata() {
  return publicPageMetadata("/contact");
}

export default function Page() {
  return (
    <>
      <ContactPage />
      <PageStructuredData path="/contact" />
    </>
  );
}
