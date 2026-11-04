import type { Metadata } from "next";

import { BillsPage } from "@/features/billing/bills-page";

export const metadata: Metadata = { title: "Bills" };

export default function BranchBillsPage() {
  return <BillsPage />;
}
