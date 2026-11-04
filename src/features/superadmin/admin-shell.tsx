"use client";

import { ShieldCheck } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { DashboardShell } from "@/components/layouts/dashboard-shell";
import { adminNav } from "@/features/navigation/nav-config";
import { AuthGate } from "@/features/session/auth-gate";

import { AnnouncementBar } from "./announcement-bar";

/** Super Admin area chrome. AuthGate is UX only: every /admin API enforces SUPER_ADMIN. */
export function AdminShell({ children }: { children: ReactNode }) {
  return (
    <AuthGate requirePlatformAdmin>
      <DashboardShell
        nav={adminNav()}
        area="admin"
        profile={{ workspaceName: "Platform administration", roleLabel: "Super Admin" }}
        banner={<AnnouncementBar />}
        sidebarHeader={
          <Link href="/admin" className="flex items-center gap-3 rounded-lg px-2 py-1.5">
            <span className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <ShieldCheck className="size-5" aria-hidden />
            </span>
            <span className="flex flex-col leading-tight">
              <span className="text-sm font-semibold">Super Admin</span>
              <span className="text-xs text-muted-foreground">Platform console</span>
            </span>
          </Link>
        }
      >
        {children}
      </DashboardShell>
    </AuthGate>
  );
}
