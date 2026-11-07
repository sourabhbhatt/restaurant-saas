"use client";

import { useParams } from "next/navigation";
import type { ReactNode } from "react";

import { DashboardShell } from "../../layouts/dashboard-shell";
import { ErrorState, PageSkeleton } from "@ros/ui/shared/feedback";
import { errorMessage } from "@ros/api-client";
import { workspaceNav } from "../navigation/nav-config";
import { AuthGate } from "../session/auth-gate";
import { permissionChecker, useWorkspaceStructure } from "../session/queries";
import { ShellExtras } from "./shell-extras";

import { ContextSwitcher } from "../navigation/context-switcher";

function Inner({ children }: { children: ReactNode }) {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const structure = useWorkspaceStructure(workspaceId);

  if (structure.isPending) return <PageSkeleton variant="cards" />;
  if (structure.isError) {
    return (
      <div className="mx-auto max-w-lg p-6">
        <ErrorState
          title="Workspace unavailable"
          message={errorMessage(structure.error)}
          onRetry={() => void structure.refetch()}
        />
      </div>
    );
  }
  const s = structure.data;
  const can = permissionChecker(s.permissions);
  return (
    <DashboardShell
      can={can}
      nav={workspaceNav(workspaceId)}
      profile={{
        workspaceId: s.workspaceId,
        workspaceName: s.workspaceName,
        roleLabel: s.roleLabel,
      }}
      sidebarHeader={
        <ContextSwitcher workspaceId={s.workspaceId} workspaceName={s.workspaceName} />
      }
      topbarActions={<ShellExtras.TopbarActions workspaceId={s.workspaceId} />}
      banner={<ShellExtras.Banner workspaceId={s.workspaceId} entitlements={s.entitlements} />}
    >
      {children}
    </DashboardShell>
  );
}

export function WorkspaceShell({ children }: { children: ReactNode }) {
  return (
    <AuthGate>
      <Inner>{children}</Inner>
    </AuthGate>
  );
}
