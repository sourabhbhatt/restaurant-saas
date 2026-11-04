"use client";

import { Store } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { ReactNode } from "react";

import { DashboardShell } from "@/components/layouts/dashboard-shell";
import { ErrorState, PageSkeleton } from "@/components/shared/feedback";
import { errorMessage } from "@/lib/api-client";
import { workspaceNav } from "@/features/navigation/nav-config";
import { AuthGate } from "@/features/session/auth-gate";
import { permissionChecker, useWorkspaceStructure } from "@/features/session/queries";
import { ShellExtras } from "@/features/workspaces/shell-extras";

import { WorkspaceSwitcher } from "./workspace-switcher";

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
      sidebarHeader={<WorkspaceSwitcher currentId={s.workspaceId} currentName={s.workspaceName} />}
      topbarActions={<ShellExtras.TopbarActions workspaceId={s.workspaceId} />}
      banner={<ShellExtras.Banner workspaceId={s.workspaceId} entitlements={s.entitlements} />}
      sidebarFooter={
        s.restaurants.length ? (
          <div>
            <p className="px-3 pb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Branches
            </p>
            <ul className="flex flex-col gap-0.5">
              {s.restaurants.flatMap((r) =>
                r.branches.map((b) => (
                  <li key={b.id}>
                    <Link
                      href={`/app/b/${b.id}`}
                      className="flex min-h-9 items-center gap-2 rounded-lg px-3 text-sm hover:bg-sidebar-accent/60"
                    >
                      <Store className="size-3.5 text-muted-foreground" aria-hidden />
                      <span className="truncate">
                        {r.name} · {b.name}
                      </span>
                    </Link>
                  </li>
                )),
              )}
            </ul>
          </div>
        ) : null
      }
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
