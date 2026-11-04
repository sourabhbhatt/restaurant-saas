import type { Metadata } from "next";

import { BRAND } from "@/features/site/brand";
import { LandingPage } from "@/features/site/landing/landing-page";

export const metadata: Metadata = {
  title: { absolute: `${BRAND.name} — QR ordering, kitchen display and billing for restaurants` },
  description: BRAND.description,
};

export default function HomePage() {
  return <LandingPage />;
}
