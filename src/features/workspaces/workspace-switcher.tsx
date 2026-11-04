"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { useRouter } from "next/navigation";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useMe } from "@/features/session/queries";
import { api } from "@/lib/api-client";

/** Switch between workspaces the user belongs to. The server verifies membership. */
export function WorkspaceSwitcher({
  currentId,
  currentName,
}: {
  currentId: string;
  currentName: string;
}) {
  const me = useMe();
  const router = useRouter();
  const qc = useQueryClient();

  const select = async (id: string) => {
    if (id === currentId) return;
    await api.put("/auth/active-workspace", { workspaceId: id });
    await qc.invalidateQueries({ queryKey: ["me"] });
    router.push(`/app/w/${id}`);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex w-full items-center gap-3 rounded-lg p-2 text-left hover:bg-sidebar-accent">
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
        <DropdownMenuLabel>Your workspaces</DropdownMenuLabel>
        {(me.data?.workspaces ?? []).map((w) => (
          <DropdownMenuItem key={w.id} onSelect={() => void select(w.id)}>
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
