import { LandingPage } from "@ros/web-core/features/site/landing/landing-page";
import { publicPageMetadata } from "@ros/web-core/features/site/seo/page-metadata";
import { PageStructuredData } from "@ros/web-core/features/site/seo/page-structured-data";

export function generateMetadata() {
  return publicPageMetadata("/");
}

export default function HomePage() {
  return (
    <>
      <LandingPage />
      <PageStructuredData path="/" />
    </>
  );
}
