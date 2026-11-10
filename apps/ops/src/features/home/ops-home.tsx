"use client";

import { RefreshCw } from "lucide-react";
import Link from "next/link";

import { EmptyState, ErrorState, PageSkeleton } from "@ros/ui/shared/feedback";
import { Button } from "@ros/ui/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@ros/ui/ui/card";
import { Skeleton } from "@ros/ui/ui/skeleton";
import { errorMessage } from "@ros/api-client";
import { branchConsoles } from "@ros/web-core/features/navigation/nav-config";
import { ProfileMenu } from "@ros/web-core/features/navigation/profile-menu";
import { AuthGate } from "@ros/web-core/features/session/auth-gate";
import {
  permissionChecker,
  useBranchContext,
  useIdentity,
  useWorkspaceStructure,
} from "@ros/web-core/features/session/queries";
import { BrandLogo } from "@ros/web-core/features/site/logo";

/** Only the consoles the user's role allows at this branch (the API enforces it too). */
function BranchConsoles({ branchId }: { branchId: string }) {
  const ctx = useBranchContext(branchId);
  if (ctx.isPending) return <Skeleton className="h-8 w-40" />;
  if (ctx.isError) {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-destructive">Couldn&apos;t load this branch.</span>
        <Button
          size="sm"
          variant="outline"
          disabled={ctx.isFetching}
          onClick={() => void ctx.refetch()}
        >
          <RefreshCw className="size-4" aria-hidden /> Try again
        </Button>
      </div>
    );
  }
  const can = permissionChecker(ctx.data.permissions);
  // The ops app hosts these consoles itself: same origin, no ops URL.
  const consoles = branchConsoles(branchId).filter((c) => !c.permission || can(c.permission));
  if (consoles.length === 0) {
    return <span className="text-sm text-muted-foreground">No consoles for your role here</span>;
  }
  return (
    <div className="flex flex-wrap gap-2">
      {consoles.map((c) => (
        <Button key={c.label} asChild size="sm" variant="outline">
          <Link href={c.href}>
            <c.icon className="size-4" aria-hidden />
            {c.label}
          </Link>
        </Button>
      ))}
    </div>
  );
}

function Consoles() {
  const { me, workspaces } = useIdentity();
  const workspaceId = me?.activeWorkspaceId ?? workspaces[0]?.id;
  const workspace = workspaces.find((w) => w.id === workspaceId);
  const structure = useWorkspaceStructure(workspaceId);

  if (!workspaceId) {
    return (
      <EmptyState
        title="No workspace yet"
        description="Ask your manager for an invitation to a restaurant workspace."
      />
    );
  }
  if (structure.isPending) return <PageSkeleton variant="cards" />;
  if (structure.isError) {
    return (
      <ErrorState
        title="We couldn't load your branches"
        message={errorMessage(structure.error)}
        onRetry={() => void structure.refetch()}
      />
    );
  }
  const restaurants = structure.data.restaurants;
  if (restaurants.length === 0) {
    return (
      <EmptyState
        title="No branches yet"
        description="Your workspace has no branches you can work in."
      />
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">{workspace?.name}</p>
      {restaurants.map((r) => (
        <Card key={r.id}>
          <CardHeader>
            <CardTitle>{r.name}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {r.branches.map((b) => (
              <div key={b.id} className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">{b.name}</span>
                <BranchConsoles branchId={b.id} />
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/** Ops start page: the signed-in user's branches with their waiter, kitchen and cashier consoles. */
export function OpsHome() {
  return (
    <AuthGate>
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-6">
        <header className="flex items-center justify-between">
          <BrandLogo />
          <ProfileMenu />
        </header>
        <main id="main" className="flex flex-col gap-4">
          <h1 className="text-2xl font-semibold tracking-tight">My consoles</h1>
          <Consoles />
        </main>
      </div>
    </AuthGate>
  );
}
