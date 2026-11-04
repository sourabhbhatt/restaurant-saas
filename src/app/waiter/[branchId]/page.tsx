import type { Metadata } from "next";

import { WaiterConsole } from "@/features/waiter/waiter-console";

export const metadata: Metadata = { title: "Waiter" };

export default function WaiterPage() {
  return <WaiterConsole />;
}
