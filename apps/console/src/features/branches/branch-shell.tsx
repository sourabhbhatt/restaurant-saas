"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import type { ReactNode } from "react";

import { DashboardShell } from "@ros/web-core/layouts/dashboard-shell";
import { ErrorState, PageSkeleton } from "@ros/ui/shared/feedback";
import { errorMessage } from "@ros/api-client";
import { ContextSwitcher } from "@ros/web-core/features/navigation/context-switcher";
import { useAppLinks } from "@ros/web-core/app-links";
import { branchConsoles, branchNav } from "@ros/web-core/features/navigation/nav-config";
import { AuthGate } from "@ros/web-core/features/session/auth-gate";
import { permissionChecker, useBranchContext } from "@ros/web-core/features/session/queries";
import { ShellExtras } from "@ros/web-core/features/workspaces/shell-extras";

function Inner({ children }: { children: ReactNode }) {
  const { branchId } = useParams<{ branchId: string }>();
  const ctx = useBranchContext(branchId);
  const links = useAppLinks();
  if (ctx.isPending) return <PageSkeleton variant="cards" />;
  if (ctx.isError) {
    return (
      <div className="mx-auto max-w-lg p-6">
        <ErrorState
          title="Branch unavailable"
          message={errorMessage(ctx.error)}
          onRetry={() => void ctx.refetch()}
        />
      </div>
    );
  }
  const b = ctx.data;
  const can = permissionChecker(b.permissions);
  const consoles = branchConsoles(branchId, links.ops).filter(
    (c) => !c.permission || can(c.permission),
  );
  return (
    <DashboardShell
      can={can}
      nav={branchNav(branchId)}
      topbarActions={<ShellExtras.TopbarActions workspaceId={b.workspaceId} />}
      banner={<ShellExtras.Banner workspaceId={b.workspaceId} entitlements={b.entitlements} />}
      profile={{
        workspaceId: b.workspaceId,
        workspaceName: b.workspaceName,
        roleLabel: b.roleLabel,
        branchLabel: `${b.restaurantName} · ${b.branchName}`,
      }}
      sidebarHeader={
        <ContextSwitcher
          workspaceId={b.workspaceId}
          workspaceName={b.workspaceName}
          currentBranchId={b.branchId}
        />
      }
      sidebarFooter={
        consoles.length ? (
          <div>
            <p className="px-3 pb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Consoles
            </p>
            <div className="flex flex-col gap-0.5">
              {consoles.map((c) => (
                <Link
                  key={c.href}
                  href={c.href}
                  className="flex min-h-9 items-center gap-2 rounded-lg px-3 text-sm hover:bg-sidebar-accent/60"
                >
                  <c.icon className="size-4 text-muted-foreground" aria-hidden /> {c.label}
                </Link>
              ))}
            </div>
          </div>
        ) : null
      }
    >
      {children}
    </DashboardShell>
  );
}

export function BranchShell({ children }: { children: ReactNode }) {
  return (
    <AuthGate>
      <Inner>{children}</Inner>
    </AuthGate>
  );
}
