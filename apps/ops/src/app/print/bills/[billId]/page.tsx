import { Suspense } from "react";

import { PageSkeleton } from "@ros/ui/shared/feedback";
import { ReceiptPrint } from "@ros/web-core/features/billing/receipt-print";

export default function PrintReceiptPage() {
  return (
    <Suspense fallback={<PageSkeleton variant="detail" />}>
      <ReceiptPrint />
    </Suspense>
  );
}
