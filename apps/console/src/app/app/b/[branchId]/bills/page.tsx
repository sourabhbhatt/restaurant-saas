import type { Metadata } from "next";

import { BillsPage } from "@ros/web-core/features/billing/bills-page";

export const metadata: Metadata = { title: "Bills" };

export default function BranchBillsPage() {
  return <BillsPage />;
}
