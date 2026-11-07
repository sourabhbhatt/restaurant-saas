"use client";

import { ArrowRight, MapPin, Plus, Store } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";

import {
  EmptyState,
  ErrorState,
  GatedAction,
  PageHeader,
  PageSkeleton,
  StatusBadge,
} from "@ros/ui/shared/feedback";
import { Badge } from "@ros/ui/ui/badge";
import { Button } from "@ros/ui/ui/button";
import { Card, CardContent, CardHeader } from "@ros/ui/ui/card";
import type { WorkspaceUsageDto } from "@ros/contracts/platform";
import type { RestaurantListItemDto } from "@ros/contracts/tenancy";
import type { Entitlements } from "@ros/domain/subscriptions/entitlements";
import { permissionChecker, useWorkspaceStructure } from "@ros/web-core/features/session/queries";
import { canAddBranch } from "@ros/web-core/features/subscriptions/limits";
import { LimitNoticeView, useLimit } from "@ros/web-core/features/subscriptions/limit-notice";
import { StructureExplainer } from "@ros/web-core/features/workspaces/structure-explainer";
import { errorMessage } from "@ros/api-client";

import { CreateBranchDialog } from "./create-branch-dialog";
import { CreateRestaurantDialog } from "./create-restaurant-dialog";
import { fileUrl, useRestaurants } from "./queries";

export function RestaurantLogo({
  name,
  logoKey,
  brandColor,
  className = "size-12",
}: {
  name: string;
  logoKey: string | null;
  brandColor: string | null;
  className?: string;
}) {
  const src = fileUrl(logoKey);
  return (
    <div
      className={`flex shrink-0 items-center justify-center overflow-hidden rounded-xl border text-base font-semibold text-white ${className}`}
      style={{ backgroundColor: src ? undefined : (brandColor ?? "var(--color-primary)") }}
      aria-hidden
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="size-full object-cover" />
      ) : (
        name.slice(0, 1).toUpperCase()
      )}
    </div>
  );
}

function RestaurantCard({
  workspaceId,
  restaurant,
  canAddBranch: mayAddBranch,
  branchBlockedReason,
  onAddBranch,
}: {
  workspaceId: string;
  restaurant: RestaurantListItemDto;
  canAddBranch: boolean;
  /** Plan reason the branch button is disabled, if any. */
  branchBlockedReason: string | null;
  onAddBranch: () => void;
}) {
  return (
    <Card className="flex flex-col">
      <CardHeader className="flex flex-row items-start gap-3">
        <RestaurantLogo
          name={restaurant.name}
          logoKey={restaurant.logoKey}
          brandColor={restaurant.brandColor}
        />
        <div className="min-w-0 flex-1">
          <Link
            href={`/app/w/${workspaceId}/restaurants/${restaurant.id}`}
            className="block truncate font-semibold hover:underline"
          >
            {restaurant.name}
          </Link>
          {restaurant.cuisineTypes.length ? (
            <div className="mt-1 flex flex-wrap gap-1">
              {restaurant.cuisineTypes.slice(0, 3).map((c) => (
                <Badge key={c} variant="secondary">
                  {c}
                </Badge>
              ))}
            </div>
          ) : (
            <p className="truncate text-sm text-muted-foreground">
              {restaurant.description ?? "No description yet"}
            </p>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Branches ({restaurant.branches.length})
        </p>
        {restaurant.branches.length ? (
          <ul className="flex flex-col gap-1">
            {restaurant.branches.map((b) => (
              <li key={b.id}>
                <Link
                  href={`/app/b/${b.id}`}
                  className="flex min-h-10 items-center gap-2 rounded-lg px-2 text-sm hover:bg-accent"
                >
                  <MapPin className="size-3.5 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">
                    {b.name}
                    {b.city ? <span className="text-muted-foreground"> · {b.city}</span> : null}
                  </span>
                  <span className="font-mono text-xs text-muted-foreground">{b.code}</span>
                  {b.status !== "ACTIVE" && <StatusBadge tone="neutral">Archived</StatusBadge>}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            No branches yet. Add one to start taking orders.
          </p>
        )}
        <div className="mt-auto flex flex-wrap items-start gap-2 pt-2">
          {mayAddBranch && (
            <GatedAction reason={branchBlockedReason}>
              {(gate) => (
                <Button variant="outline" size="sm" onClick={onAddBranch} {...gate}>
                  <Plus aria-hidden /> Add branch
                </Button>
              )}
            </GatedAction>
          )}
          <Button variant="ghost" size="sm" asChild>
            <Link href={`/app/w/${workspaceId}/restaurants/${restaurant.id}`}>
              Manage restaurant <ArrowRight aria-hidden />
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function branchReason(
  data: { entitlements: Entitlements; usage: WorkspaceUsageDto } | undefined,
  restaurant: RestaurantListItemDto,
): string | null {
  if (!data) return null;
  return canAddBranch(data.entitlements, data.usage, restaurant.branches.length).reason;
}

export function RestaurantsPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const structure = useWorkspaceStructure(workspaceId);
  const restaurants = useRestaurants(workspaceId);
  const limit = useLimit(workspaceId, "maxRestaurants");
  const [createOpen, setCreateOpen] = useState(false);
  const [branchFor, setBranchFor] = useState<{ id: string; name: string } | null>(null);
  const can = permissionChecker(structure.data?.permissions);
  const canCreate = can("restaurant.create");
  // Workspace-level permission list; restaurant managers also hold branch.create via assignments.
  const mayAddBranch = can("branch.create");

  const createButton = (
    <GatedAction reason={limit.reason} align="end">
      {(gate) => (
        <Button onClick={() => setCreateOpen(true)} {...gate}>
          <Plus aria-hidden /> Create restaurant
        </Button>
      )}
    </GatedAction>
  );

  const header = (
    <PageHeader
      title="Restaurants"
      description="Your brands and their branches. Each restaurant has its own menu; each branch is a location with its own tables and staff."
      actions={canCreate ? createButton : null}
    />
  );

  let body: React.ReactNode;
  if (restaurants.isPending) body = <PageSkeleton variant="cards" count={3} />;
  else if (restaurants.isError)
    body = (
      <ErrorState
        title="Couldn't load restaurants"
        message={errorMessage(restaurants.error)}
        onRetry={() => void restaurants.refetch()}
        retrying={restaurants.isFetching}
      />
    );
  else if (restaurants.data.length === 0)
    body = (
      <EmptyState
        icon={<Store />}
        title="No restaurants yet"
        description={
          canCreate
            ? "Create your first restaurant to set up its menu, branches and tables."
            : "You haven't been assigned to a restaurant yet. Ask a workspace owner or admin to give you access."
        }
        action={canCreate ? createButton : null}
      />
    );
  else
    body = (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {restaurants.data.map((r) => (
          <RestaurantCard
            key={r.id}
            workspaceId={workspaceId}
            restaurant={r}
            canAddBranch={mayAddBranch}
            branchBlockedReason={branchReason(limit.data, r)}
            onAddBranch={() => setBranchFor({ id: r.id, name: r.name })}
          />
        ))}
      </div>
    );

  return (
    <div className="flex flex-col gap-6">
      {header}
      <StructureExplainer
        storageKey="restaurants"
        title="About restaurants and branches"
        entitlements={limit.data?.entitlements}
      />
      {limit.data && (canCreate || mayAddBranch) ? (
        <LimitNoticeView
          workspaceId={workspaceId}
          limitKey="maxRestaurants"
          entitlements={limit.data.entitlements}
          usage={limit.data.usage}
        />
      ) : null}
      {body}
      <CreateRestaurantDialog
        workspaceId={workspaceId}
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(r) => {
          // Offer the first branch only when the plan still has room for one.
          if (limit.data && !canAddBranch(limit.data.entitlements, limit.data.usage, 0).allowed)
            return;
          setBranchFor({ id: r.id, name: r.name });
        }}
      />
      <CreateBranchDialog
        workspaceId={workspaceId}
        restaurant={branchFor}
        open={branchFor !== null}
        onOpenChange={(open) => {
          if (!open) setBranchFor(null);
        }}
      />
    </div>
  );
}
