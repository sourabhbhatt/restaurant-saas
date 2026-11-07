import { Suspense } from "react";

import { BranchShell } from "@/features/branches/branch-shell";

// AuthGate renders a skeleton instead of {children} on the server, so the page segment cannot be prerendered for validation.
export const instant = false;

export default function BranchLayout({ children }: LayoutProps<"/app/b/[branchId]">) {
  return (
    <Suspense fallback={null}>
      <BranchShell>{children}</BranchShell>
    </Suspense>
  );
}
