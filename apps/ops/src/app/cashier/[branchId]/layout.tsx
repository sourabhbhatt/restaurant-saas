import { CashierShell } from "@/features/cashier/cashier-shell";

// AuthGate renders a skeleton instead of {children} on the server, so the page segment cannot be prerendered for validation.
export const instant = false;

export default function CashierLayout({ children }: LayoutProps<"/cashier/[branchId]">) {
  return <CashierShell>{children}</CashierShell>;
}
