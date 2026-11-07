import type { Metadata } from "next";
import { Suspense } from "react";

import { PageSkeleton } from "@ros/ui/shared/feedback";
import { WaiterConsole } from "@/features/waiter/waiter-console";

export const metadata: Metadata = { title: "Waiter" };

export default function WaiterPage() {
  return (
    <Suspense fallback={<PageSkeleton variant="cards" />}>
      <WaiterConsole />
    </Suspense>
  );
}
