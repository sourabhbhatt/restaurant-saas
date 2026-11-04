import { Suspense } from "react";

import { WorkspaceShell } from "@/features/workspaces/workspace-shell";

export default function WorkspaceLayout({ children }: LayoutProps<"/app/w/[workspaceId]">) {
  return (
    <Suspense fallback={null}>
      <WorkspaceShell>{children}</WorkspaceShell>
    </Suspense>
  );
}
