import { Suspense } from "react";

import { PageSkeleton } from "@ros/ui/shared/feedback";
import { QrPrintSheet } from "@/features/tables/qr-print-sheet";

export default function PrintTablesPage() {
  return (
    <Suspense fallback={<PageSkeleton variant="cards" />}>
      <QrPrintSheet />
    </Suspense>
  );
}
