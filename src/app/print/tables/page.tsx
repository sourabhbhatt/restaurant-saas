import { Suspense } from "react";

import { PageSkeleton } from "@/components/shared/feedback";
import { QrPrintSheet } from "@/features/tables/qr-print-sheet";

export default function PrintTablesPage() {
  return (
    <Suspense fallback={<PageSkeleton variant="cards" />}>
      <QrPrintSheet />
    </Suspense>
  );
}
