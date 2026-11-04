"use client";

import { ArrowLeft, Wallet } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { ReactNode } from "react";

import { ErrorState, PageSkeleton } from "@/components/shared/feedback";
import { Toaster } from "@/components/ui/sonner";
import { errorMessage } from "@/lib/api-client";
import { PaymentSummaryStrip } from "@/features/billing/components/payment-summary-strip";
import { OfflineBanner, SyncStatusIndicator } from "@/features/offline";
import { ProfileMenu } from "@/features/navigation/profile-menu";
import { AuthGate } from "@/features/session/auth-gate";
import { permissionChecker, useBranchContext } from "@/features/session/queries";

function Inner({ children }: { children: ReactNode }) {
  const { branchId } = useParams<{ branchId: string }>();
  const ctx = useBranchContext(branchId);
  if (ctx.isPending) return <PageSkeleton variant="detail" />;
  if (ctx.isError) {
    return (
      <div className="mx-auto max-w-lg p-6">
        <ErrorState
          title="Cashier console unavailable"
          message={errorMessage(ctx.error)}
          onRetry={() => void ctx.refetch()}
        />
      </div>
    );
  }
  const b = ctx.data;
  const can = permissionChecker(b.permissions);
  return (
    <div className="flex min-h-dvh flex-col bg-muted/30">
      <header className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <Link
              href={`/app/b/${branchId}`}
              className="inline-flex size-9 items-center justify-center rounded-md hover:bg-accent"
              aria-label="Back to branch"
            >
              <ArrowLeft className="size-4" aria-hidden />
            </Link>
            <span
              className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary"
              aria-hidden
            >
              <Wallet className="size-5" />
            </span>
            <div className="min-w-0">
              <h1 className="truncate text-base font-semibold">Cashier</h1>
              <p className="truncate text-xs text-muted-foreground">
                {b.restaurantName} · {b.branchName}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <SyncStatusIndicator />
            <ProfileMenu
              workspaceId={b.workspaceId}
              workspaceName={b.workspaceName}
              roleLabel={b.roleLabel}
              branchLabel={`${b.restaurantName} · ${b.branchName}`}
            />
            {can("payments.summary.view") && <PaymentSummaryStrip branchId={branchId} />}
          </div>
        </div>
      </header>
      <OfflineBanner />
      <main className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col px-4 py-4">
        {children}
      </main>
      <Toaster position="top-center" richColors />
    </div>
  );
}

/** Full-screen cashier layout (own chrome, no dashboard sidebar). */
export function CashierShell({ children }: { children: ReactNode }) {
  return (
    <AuthGate>
      <Inner>{children}</Inner>
    </AuthGate>
  );
}
