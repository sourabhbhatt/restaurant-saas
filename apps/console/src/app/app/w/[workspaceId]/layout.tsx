import { Suspense } from "react";

import { WorkspaceShell } from "@ros/web-core/features/workspaces/workspace-shell";

// AuthGate renders a skeleton instead of {children} on the server, so the page segment cannot be prerendered for validation.
export const instant = false;

export default function WorkspaceLayout({ children }: LayoutProps<"/app/w/[workspaceId]">) {
  return (
    <Suspense fallback={null}>
      <WorkspaceShell>{children}</WorkspaceShell>
    </Suspense>
  );
}
