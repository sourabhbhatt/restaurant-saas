"use client";

import { Check, LayoutDashboard, LogOut, Settings, ShieldCheck, UserRound } from "lucide-react";
import Link from "next/link";

import { Avatar, AvatarFallback, getInitials } from "@ros/ui/ui/avatar";
import { Button } from "@ros/ui/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@ros/ui/ui/dropdown-menu";
import { Skeleton } from "@ros/ui/ui/skeleton";
import { useIdentity, useSignOut } from "../session/queries";
import { useSwitchWorkspace } from "../workspaces/use-switch-workspace";
import { appHref, useAppLinks } from "../../app-links";

export interface ProfileContext {
  /** Workspace being worked in (omit on platform/account pages). */
  workspaceId?: string;
  workspaceName?: string;
  /** Role of the user in this context, e.g. "Waiter". */
  roleLabel?: string;
  /** Restaurant · branch, shown under the workspace. */
  branchLabel?: string;
}

/**
 * The one profile menu, used by every layout (dashboards, waiter, kitchen,
 * cashier, Super Admin). Identity comes from the server-confirmed session and
 * does not change when the workspace or branch changes.
 */
export function ProfileMenu({
  workspaceId,
  workspaceName,
  roleLabel,
  branchLabel,
  area = "app",
}: ProfileContext & { area?: "app" | "admin" }) {
  const { user, workspaces, ready } = useIdentity();
  const signOut = useSignOut();
  const switchWorkspace = useSwitchWorkspace(workspaceId);
  const links = useAppLinks();

  if (!ready || !user) {
    return <Skeleton className="size-9 rounded-full" aria-label="Loading account" />;
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="h-10 gap-2 rounded-full px-1 sm:pr-3"
          aria-label={`Account menu for ${user.name}`}
        >
          <Avatar className="size-8">
            <AvatarFallback>
              {user.name ? getInitials(user.name) : <UserRound className="size-4" />}
            </AvatarFallback>
          </Avatar>
          <span className="hidden max-w-32 truncate text-sm font-medium sm:inline">
            {user.name}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel className="flex flex-col gap-0.5 font-normal">
          <span className="truncate text-sm font-semibold">{user.name}</span>
          <span className="truncate text-xs text-muted-foreground">{user.email}</span>
          {(roleLabel || workspaceName) && (
            <span className="mt-1 text-xs text-muted-foreground">
              {roleLabel ? (
                <strong className="font-medium text-foreground">{roleLabel}</strong>
              ) : null}
              {roleLabel && workspaceName ? " · " : ""}
              {workspaceName}
            </span>
          )}
          {branchLabel && (
            <span className="truncate text-xs text-muted-foreground">{branchLabel}</span>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {workspaceId && (
          <DropdownMenuItem asChild>
            <Link href={appHref(links.console, `/app/w/${workspaceId}`)}>
              <LayoutDashboard className="size-4" aria-hidden /> Dashboard
            </Link>
          </DropdownMenuItem>
        )}
        {workspaces.length > 1 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">
              Switch workspace
            </DropdownMenuLabel>
            {workspaces.map((w) => (
              <DropdownMenuItem key={w.id} onSelect={() => void switchWorkspace(w.id)}>
                <span className="flex-1 truncate">{w.name}</span>
                <span className="text-xs text-muted-foreground">{w.roleName}</span>
                {w.id === workspaceId ? <Check className="size-4" aria-label="Current" /> : null}
              </DropdownMenuItem>
            ))}
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href={appHref(links.console, "/app/account")}>
            <Settings className="size-4" aria-hidden /> Account settings
          </Link>
        </DropdownMenuItem>
        {area === "app" && "isPlatformAdmin" in user && user.isPlatformAdmin ? (
          <DropdownMenuItem asChild>
            <Link href={appHref(links.admin, "/admin")}>
              <ShieldCheck className="size-4" aria-hidden /> Super Admin
            </Link>
          </DropdownMenuItem>
        ) : null}
        {area === "admin" && (
          <DropdownMenuItem asChild>
            <Link href={appHref(links.console, "/app")}>
              <LayoutDashboard className="size-4" aria-hidden /> Back to my workspaces
            </Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void signOut()}>
          <LogOut className="size-4" aria-hidden /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
