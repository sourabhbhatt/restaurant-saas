import type { Metadata } from "next";

import { PricingPage } from "@/features/site/pricing-page";

export const metadata: Metadata = {
  title: "Pricing",
  description: "Plans and limits for restaurants of every size, with a free trial.",
};

export default function Page() {
  return <PricingPage />;
}
