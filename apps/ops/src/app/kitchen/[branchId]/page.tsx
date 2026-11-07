import type { Metadata } from "next";
import { Suspense } from "react";

import { PageSkeleton } from "@ros/ui/shared/feedback";
import { KitchenDisplay } from "@/features/kitchen/kitchen-display";

export const metadata: Metadata = { title: "Kitchen" };

export default function KitchenPage() {
  return (
    <Suspense fallback={<PageSkeleton variant="cards" />}>
      <KitchenDisplay />
    </Suspense>
  );
}
