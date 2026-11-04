import { AdminShell } from "@/features/superadmin/admin-shell";

export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return <AdminShell>{children}</AdminShell>;
}
