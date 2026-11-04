"use client";

import { ArrowRight, MapPin, Plus, Store } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";

import {
  EmptyState,
  ErrorState,
  PageHeader,
  PageSkeleton,
  StatusBadge,
} from "@/components/shared/feedback";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type { RestaurantListItemDto } from "@/contracts/tenancy";
import { permissionChecker, useWorkspaceStructure } from "@/features/session/queries";
import { errorMessage } from "@/lib/api-client";

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
  canAddBranch,
  onAddBranch,
}: {
  workspaceId: string;
  restaurant: RestaurantListItemDto;
  canAddBranch: boolean;
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
          <p className="text-sm text-muted-foreground">No branches yet.</p>
        )}
        <div className="mt-auto flex flex-wrap gap-2 pt-2">
          {canAddBranch && (
            <Button variant="outline" size="sm" onClick={onAddBranch}>
              <Plus aria-hidden /> Add branch
            </Button>
          )}
          <Button variant="ghost" size="sm" asChild>
            <Link href={`/app/w/${workspaceId}/restaurants/${restaurant.id}`}>
              Details <ArrowRight aria-hidden />
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function RestaurantsPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const structure = useWorkspaceStructure(workspaceId);
  const restaurants = useRestaurants(workspaceId);
  const [createOpen, setCreateOpen] = useState(false);
  const [branchFor, setBranchFor] = useState<{ id: string; name: string } | null>(null);
  const can = permissionChecker(structure.data?.permissions);
  const canCreate = can("restaurant.create");
  // Workspace-level permission list; restaurant managers also hold branch.create via assignments.
  const canAddBranch = can("branch.create");

  const header = (
    <PageHeader
      title="Restaurants"
      description="Your brands and their branches. Each restaurant has its own menu."
      actions={
        canCreate ? (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus aria-hidden /> New restaurant
          </Button>
        ) : null
      }
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
            : "You haven't been assigned to a restaurant yet."
        }
        action={
          canCreate ? (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus aria-hidden /> New restaurant
            </Button>
          ) : null
        }
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
            canAddBranch={canAddBranch}
            onAddBranch={() => setBranchFor({ id: r.id, name: r.name })}
          />
        ))}
      </div>
    );

  return (
    <div className="flex flex-col gap-6">
      {header}
      {body}
      <CreateRestaurantDialog
        workspaceId={workspaceId}
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(r) => setBranchFor({ id: r.id, name: r.name })}
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
