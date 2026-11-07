"use client";

import { Check, ChevronsUpDown, LayoutDashboard, Store } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@ros/ui/ui/dropdown-menu";
import { Skeleton } from "@ros/ui/ui/skeleton";
import { useWorkspaceStructure } from "../session/queries";
import { WorkspaceSwitcher } from "../workspaces/workspace-switcher";

/** `/app/b/<old>/menu` → `/app/b/<new>/menu`, so the section is kept when the branch changes. */
export function pathForBranch(pathname: string, branchId: string): string {
  const match = /^\/app\/b\/[^/]+(\/.*)?$/.exec(pathname);
  return `/app/b/${branchId}${match?.[1] ?? ""}`;
}

/**
 * Sidebar context: Workspace (business name) → Restaurant → Branch.
 * The workspace block never shows a branch name; the branch is its own control.
 */
export function ContextSwitcher({
  workspaceId,
  workspaceName,
  currentBranchId,
}: {
  workspaceId: string;
  workspaceName: string;
  currentBranchId?: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const structure = useWorkspaceStructure(workspaceId);
  const restaurants = structure.data?.restaurants.filter((r) => r.branches.length > 0) ?? [];
  const current = restaurants
    .flatMap((r) => r.branches.map((b) => ({ restaurant: r, branch: b })))
    .find((x) => x.branch.id === currentBranchId);

  return (
    <div className="flex flex-col gap-1">
      <WorkspaceSwitcher currentId={workspaceId} currentName={workspaceName} />
      {structure.isPending ? (
        <Skeleton className="mx-2 h-10" />
      ) : restaurants.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            className="ml-4 flex items-center gap-2 rounded-lg border border-sidebar-border p-2 text-left hover:bg-sidebar-accent"
            aria-label={
              current
                ? `Branch ${current.branch.name} of ${current.restaurant.name}. Switch branch`
                : "Choose a branch"
            }
          >
            <Store className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs text-muted-foreground">
                {current ? current.restaurant.name : "Restaurant & branch"}
              </span>
              <span className="block truncate text-sm font-medium">
                {current ? current.branch.name : "All branches"}
              </span>
            </span>
            <ChevronsUpDown className="size-4 text-muted-foreground" aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64">
            <DropdownMenuItem asChild>
              <Link href={`/app/w/${workspaceId}`}>
                <LayoutDashboard className="size-4" aria-hidden /> All branches (workspace overview)
              </Link>
            </DropdownMenuItem>
            {restaurants.map((r) => (
              <div key={r.id}>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-xs text-muted-foreground">
                  {r.name}
                </DropdownMenuLabel>
                {r.branches.map((b) => (
                  <DropdownMenuItem
                    key={b.id}
                    onSelect={() => router.push(pathForBranch(pathname, b.id))}
                  >
                    <span className="flex-1 truncate">{b.name}</span>
                    {b.id === currentBranchId ? (
                      <Check className="size-4" aria-label="Current" />
                    ) : null}
                  </DropdownMenuItem>
                ))}
              </div>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}
