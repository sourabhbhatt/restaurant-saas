import { BranchShell } from "@/features/branches/branch-shell";

export default function BranchLayout({ children }: LayoutProps<"/app/b/[branchId]">) {
  return <BranchShell>{children}</BranchShell>;
}
