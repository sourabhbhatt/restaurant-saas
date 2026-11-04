"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { ReactNode } from "react";

import { DashboardShell } from "@/components/layouts/dashboard-shell";
import { ErrorState, PageSkeleton } from "@/components/shared/feedback";
import { errorMessage } from "@/lib/api-client";
import { branchConsoles, branchNav } from "@/features/navigation/nav-config";
import { AuthGate } from "@/features/session/auth-gate";
import { permissionChecker, useBranchContext } from "@/features/session/queries";
import { ShellExtras } from "@/features/workspaces/shell-extras";

function Inner({ children }: { children: ReactNode }) {
  const { branchId } = useParams<{ branchId: string }>();
  const ctx = useBranchContext(branchId);
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
  const consoles = branchConsoles(branchId).filter((c) => !c.permission || can(c.permission));
  return (
    <DashboardShell
      can={can}
      nav={branchNav(branchId)}
      topbarActions={<ShellExtras.TopbarActions workspaceId={b.workspaceId} />}
      banner={<ShellExtras.Banner workspaceId={b.workspaceId} entitlements={b.entitlements} />}
      sidebarHeader={
        <div className="flex flex-col gap-2">
          <Link
            href={`/app/w/${b.workspaceId}`}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3" aria-hidden /> {b.workspaceName}
          </Link>
          <div className="px-1">
            <p className="truncate text-sm font-semibold">{b.restaurantName}</p>
            <p className="truncate text-xs text-muted-foreground">{b.branchName}</p>
          </div>
        </div>
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
