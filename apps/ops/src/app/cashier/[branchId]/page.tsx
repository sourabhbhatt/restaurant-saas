import type { Metadata } from "next";

import { CashierConsole } from "@/features/cashier/cashier-console";

export const metadata: Metadata = { title: "Cashier" };

export default function CashierPage() {
  return <CashierConsole />;
}
