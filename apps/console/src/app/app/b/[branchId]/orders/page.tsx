import type { Metadata } from "next";

import { BranchOrdersPage } from "@ros/web-core/features/orders/branch-orders-page";

export const metadata: Metadata = { title: "Orders" };

export default function OrdersPage() {
  return <BranchOrdersPage />;
}
