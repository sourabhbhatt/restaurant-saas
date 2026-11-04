import type { Metadata } from "next";

import { BranchOrdersPage } from "@/features/orders/branch-orders-page";

export const metadata: Metadata = { title: "Orders" };

export default function OrdersPage() {
  return <BranchOrdersPage />;
}
