"use client";

import { Check, ChevronsUpDown, LayoutDashboard, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@ros/ui/ui/dropdown-menu";
import { useIdentity } from "../session/queries";

import { useSwitchWorkspace } from "./use-switch-workspace";

/**
 * Workspace identity (always the business name, never a branch) with switching
 * between the workspaces the user belongs to.
 */
export function WorkspaceSwitcher({
  currentId,
  currentName,
}: {
  currentId: string;
  currentName: string;
}) {
  const { workspaces } = useIdentity();
  const router = useRouter();
  const switchWorkspace = useSwitchWorkspace(currentId);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex w-full items-center gap-3 rounded-lg p-2 text-left hover:bg-sidebar-accent"
        aria-label={`Workspace ${currentName}. Switch workspace`}
        title={currentName}
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground">
          {currentName.slice(0, 1).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{currentName}</span>
          <span className="block text-xs text-muted-foreground">Workspace</span>
        </span>
        <ChevronsUpDown className="size-4 text-muted-foreground" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuItem asChild>
          <Link href={`/app/w/${currentId}`}>
            <LayoutDashboard className="size-4" aria-hidden /> Workspace overview
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Your workspaces</DropdownMenuLabel>
        {workspaces.map((w) => (
          <DropdownMenuItem key={w.id} onSelect={() => void switchWorkspace(w.id)}>
            <span className="flex-1 truncate">{w.name}</span>
            <span className="text-xs text-muted-foreground">{w.roleName}</span>
            {w.id === currentId ? <Check className="size-4" aria-label="Current" /> : null}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => router.push("/app/onboarding?new=1")}>
          <Plus className="size-4" aria-hidden /> Create workspace
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
