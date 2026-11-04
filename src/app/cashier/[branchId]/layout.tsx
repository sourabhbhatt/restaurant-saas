import { CashierShell } from "@/features/cashier/cashier-shell";

export default function CashierLayout({ children }: LayoutProps<"/cashier/[branchId]">) {
  return <CashierShell>{children}</CashierShell>;
}
