import { AdminShell } from "@ros/web-core/features/superadmin/admin-shell";

// AuthGate renders a skeleton instead of {children} on the server, so the page segment cannot be prerendered for validation.
export const instant = false;

export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return <AdminShell>{children}</AdminShell>;
}
