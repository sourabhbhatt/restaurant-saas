"use client";

import { Menu } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";

import { Button } from "@ros/ui/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@ros/ui/ui/sheet";
import { ErrorState } from "@ros/ui/shared/feedback";
import { requiredPermissionFor, type NavItem } from "../features/navigation/nav-config";
import { ProfileMenu, type ProfileContext } from "../features/navigation/profile-menu";
import { OfflineBanner, SyncStatusIndicator } from "../features/offline";
import { cn } from "@ros/ui/utils";

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
  /** Who/where, shown in the profile menu. */
  profile?: ProfileContext;
  area?: "app" | "admin";
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

/** Sidebar dashboard layout used by the workspace, branch-management and Super Admin areas. */
export function DashboardShell({
  sidebarHeader,
  nav,
  sidebarFooter,
  topbarActions,
  banner,
  can,
  profile,
  area = "app",
  children,
}: DashboardShellProps) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  // Direct URL entry: show an explanation instead of a page the user cannot use.
  const required = can ? requiredPermissionFor(pathname, nav) : null;
  const denied = Boolean(required && can && !can(required));
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
          <ProfileMenu {...profile} area={area} />
        </header>
        <OfflineBanner />
        {banner}
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8">
          {denied ? (
            <ErrorState
              title="You don't have access to this section"
              message="Your role doesn't include it. Ask a workspace owner if you need access."
            />
          ) : (
            children
          )}
        </main>
      </div>
    </div>
  );
}
