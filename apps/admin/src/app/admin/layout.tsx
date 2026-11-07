import { AdminShell } from "@ros/web-core/features/superadmin/admin-shell";

export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return <AdminShell>{children}</AdminShell>;
}
