import { WorkspaceShell } from "@/features/workspaces/workspace-shell";

export default function WorkspaceLayout({ children }: LayoutProps<"/app/w/[workspaceId]">) {
  return <WorkspaceShell>{children}</WorkspaceShell>;
}
