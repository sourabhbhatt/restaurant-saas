import { Suspense } from "react";

import { BranchShell } from "@/features/branches/branch-shell";

export default function BranchLayout({ children }: LayoutProps<"/app/b/[branchId]">) {
  return (
    <Suspense fallback={null}>
      <BranchShell>{children}</BranchShell>
    </Suspense>
  );
}
