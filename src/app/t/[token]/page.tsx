import { Suspense } from "react";

import { CustomerApp } from "@/features/customer/components/customer-app";

export default function CustomerTablePage() {
  return (
    <Suspense>
      <CustomerApp />
    </Suspense>
  );
}
