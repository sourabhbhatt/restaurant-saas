import type { Metadata } from "next";

import { KitchenDisplay } from "@/features/kitchen/kitchen-display";

export const metadata: Metadata = { title: "Kitchen" };

export default function KitchenPage() {
  return <KitchenDisplay />;
}
