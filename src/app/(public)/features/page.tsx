import type { Metadata } from "next";

import { FeaturesPage } from "@/features/site/features-page";

export const metadata: Metadata = {
  title: "Features",
  description: "QR table ordering, waiter approval, kitchen display, counter billing, menu and staff management, multi-branch and offline-ready devices.",
};

export default function Page() {
  return <FeaturesPage />;
}
