"use client";

import { LogOut, Menu, UserRound } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";

import { Avatar, AvatarFallback, getInitials } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import type { NavItem } from "@/features/navigation/nav-config";
import { OfflineBanner, SyncStatusIndicator } from "@/features/offline";
import { useMe, useSignOut } from "@/features/session/queries";
import { cn } from "@/lib/utils";

export interface DashboardShellProps {
  /** Brand/context block at the top of the sidebar (e.g. workspace switcher). */
  sidebarHeader: ReactNode;
  nav: NavItem[];
  /** Extra sidebar sections below the main nav (e.g. branch list, consoles). */
  sidebarFooter?: ReactNode;
  /** Items in the top bar, left of the user menu (e.g. notifications bell). */
  topbarActions?: ReactNode;
  /** Persistent banner above content (trial / announcements). */
  banner?: ReactNode;
  can?: (permission: string) => boolean;
  children: ReactNode;
}

function NavLinks({
  nav,
  can,
  onNavigate,
}: {
  nav: NavItem[];
  can?: (p: string) => boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="flex flex-col gap-0.5">
      {nav
        .filter((item) => !item.permission || !can || can(item.permission))
        .map((item) => {
          const active = item.exact
            ? pathname === item.href
            : pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex min-h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors",
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/75 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
              )}
            >
              <Icon className="size-4 shrink-0" aria-hidden />
              <span className="truncate">{item.label}</span>
            </Link>
          );
        })}
    </nav>
  );
}

function UserMenu() {
  const me = useMe();
  const signOut = useSignOut();
  const name = me.data?.user.name ?? "";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Account menu" className="rounded-full">
          <Avatar className="size-8">
            <AvatarFallback>
              {name ? getInitials(name) : <UserRound className="size-4" />}
            </AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="flex flex-col">
          <span className="truncate">{name}</span>
          <span className="truncate text-xs font-normal text-muted-foreground">
            {me.data?.user.email}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/app/account">Account settings</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/app">Switch workspace</Link>
        </DropdownMenuItem>
        {me.data?.user.isPlatformAdmin ? (
          <DropdownMenuItem asChild>
            <Link href="/admin">Super Admin</Link>
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void signOut()}>
          <LogOut className="size-4" aria-hidden /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Sidebar dashboard layout used by the workspace, branch-management and Super Admin areas. */
export function DashboardShell({
  sidebarHeader,
  nav,
  sidebarFooter,
  topbarActions,
  banner,
  can,
  children,
}: DashboardShellProps) {
  const [open, setOpen] = useState(false);
  const sidebar = (onNavigate?: () => void) => (
    <div className="flex h-full flex-col gap-6 p-4">
      <div>{sidebarHeader}</div>
      <NavLinks nav={nav} can={can} onNavigate={onNavigate} />
      {sidebarFooter ? <div className="mt-auto flex flex-col gap-4">{sidebarFooter}</div> : null}
    </div>
  );
  return (
    <div className="flex min-h-dvh bg-background">
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 overflow-y-auto border-r border-sidebar-border bg-sidebar lg:block">
        {sidebar()}
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/85 px-4 backdrop-blur">
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="lg:hidden"
                aria-label="Open navigation"
              >
                <Menu className="size-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 bg-sidebar p-0">
              <SheetTitle className="sr-only">Navigation</SheetTitle>
              {sidebar(() => setOpen(false))}
            </SheetContent>
          </Sheet>
          <div className="flex-1" />
          <SyncStatusIndicator />
          {topbarActions}
          <UserMenu />
        </header>
        <OfflineBanner />
        {banner}
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}
