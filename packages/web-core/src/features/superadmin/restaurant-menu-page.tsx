"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Eye, Star, UtensilsCrossed } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";

import {
  EmptyState,
  ErrorState,
  FilterBar,
  PageHeader,
  PageSkeleton,
  StatusBadge,
} from "@ros/ui/shared/feedback";
import { Badge } from "@ros/ui/ui/badge";
import { Card, CardContent } from "@ros/ui/ui/card";
import { SearchInput } from "@ros/ui/ui/search-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ros/ui/ui/select";
import type { AdminRestaurantMenuDto, MenuItemDto } from "@ros/contracts/menu";
import { formatMoney } from "@ros/domain/shared/money";
import { api, errorMessage } from "@ros/api-client";

const DOT = {
  VEG: "bg-success",
  VEGAN: "bg-success",
  EGG: "bg-warning",
  NON_VEG: "bg-destructive",
} as const;

function ItemCard({
  item,
  branches,
  overrides,
  currency,
}: {
  item: MenuItemDto;
  branches: AdminRestaurantMenuDto["branches"];
  overrides: AdminRestaurantMenuDto["overrides"];
  currency: string;
}) {
  const mine = overrides.filter((o) => o.itemId === item.id);
  return (
    <Card>
      <CardContent className="flex gap-4 pt-6">
        {item.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- stored uploads, no loader configured
          <img src={item.imageUrl} alt="" className="size-20 shrink-0 rounded-lg object-cover" />
        ) : (
          <div
            className="flex size-20 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"
            aria-hidden
          >
            <UtensilsCrossed className="size-6" />
          </div>
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`size-3 rounded-sm ${DOT[item.dietary]}`}
              title={item.dietary}
              aria-label={item.dietary}
            />
            <h3 className="font-medium">{item.name}</h3>
            {item.isFeatured && <Star className="size-4 text-warning" aria-label="Featured" />}
            <StatusBadge tone={item.isAvailable ? "success" : "warning"} dot>
              {item.isAvailable ? "Available" : "Unavailable"}
            </StatusBadge>
          </div>
          {item.description && <p className="text-sm text-muted-foreground">{item.description}</p>}
          <p className="text-sm">
            {item.discountedPrice !== null && item.discountedPrice < item.price ? (
              <>
                <strong>{formatMoney(item.discountedPrice, currency)}</strong>{" "}
                <s className="text-muted-foreground">{formatMoney(item.price, currency)}</s>
              </>
            ) : (
              <strong>{formatMoney(item.price, currency)}</strong>
            )}
            <span className="text-muted-foreground"> · {item.prepTimeMinutes} min</span>
          </p>
          {item.variants.length > 0 && (
            <p className="text-sm">
              <span className="text-muted-foreground">Variants: </span>
              {item.variants
                .map(
                  (v) =>
                    `${v.name} ${formatMoney(v.price, currency)}${v.isAvailable ? "" : " (unavailable)"}`,
                )
                .join(" · ")}
            </p>
          )}
          {item.addonGroups.map((g) => (
            <p key={g.id} className="text-sm">
              <span className="text-muted-foreground">
                {g.name} ({g.minSelect === 0 ? "optional" : `choose ${g.minSelect}`}, max{" "}
                {g.maxSelect}):{" "}
              </span>
              {g.addons.map((a) => `${a.name} +${formatMoney(a.price, currency)}`).join(" · ")}
            </p>
          ))}
          {item.allergens.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Allergens: {item.allergens.join(", ").toLowerCase()}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-muted-foreground">Offered at:</span>
            {branches.length === 0 ? (
              <span className="text-muted-foreground">no branches</span>
            ) : (
              branches.map((b) => {
                const o = mine.find((x) => x.branchId === b.id);
                const unavailable = (o?.isAvailable ?? item.isAvailable) === false;
                const price = o?.price != null ? formatMoney(o.price, currency) : null;
                return (
                  <Badge key={b.id} variant={unavailable ? "outline" : "secondary"}>
                    {b.name}
                    {price ? ` · ${price}` : ""}
                    {unavailable ? " · off" : ""}
                  </Badge>
                );
              })
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/** /admin/workspaces/[workspaceId]/restaurants/[restaurantId] — read-only menu inspection. */
export function AdminRestaurantMenuPage() {
  const { workspaceId, restaurantId } = useParams<{ workspaceId: string; restaurantId: string }>();
  const q = useQuery({
    queryKey: ["admin", "workspaces", "detail", workspaceId, "menu", restaurantId],
    queryFn: ({ signal }) =>
      api.get<AdminRestaurantMenuDto>(
        `/admin/workspaces/${workspaceId}/restaurants/${restaurantId}/menu`,
        undefined,
        signal,
      ),
  });
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [availability, setAvailability] = useState("all");

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (q.data?.menu.categories ?? [])
      .filter((c) => category === "all" || c.id === category)
      .map((c) => ({
        ...c,
        items: c.items.filter(
          (i) =>
            (!term ||
              i.name.toLowerCase().includes(term) ||
              (i.description ?? "").toLowerCase().includes(term)) &&
            (availability === "all" || (availability === "available") === i.isAvailable),
        ),
      }))
      .filter((c) => c.items.length > 0);
  }, [q.data, search, category, availability]);

  if (q.isPending) return <PageSkeleton variant="list" />;
  if (q.isError) {
    return (
      <ErrorState
        title="Couldn't load the menu"
        message={errorMessage(q.error)}
        onRetry={() => void q.refetch()}
      />
    );
  }
  const d = q.data;
  const total = d.menu.categories.reduce((n, c) => n + c.items.length, 0);
  const currency = d.currency;

  return (
    <div className="flex flex-col gap-6">
      <Link
        href={`/admin/workspaces/${workspaceId}`}
        className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden /> {d.workspace.name}
      </Link>
      <PageHeader
        title={`${d.restaurant.name} — Menu`}
        description={`${total} item${total === 1 ? "" : "s"} in ${d.menu.categories.length} categories · branches: ${
          d.branches.map((b) => b.name).join(", ") || "none"
        }`}
        actions={
          <Badge variant="outline">
            <Eye className="size-3" aria-hidden /> Read-only
          </Badge>
        }
      />
      <FilterBar>
        <SearchInput
          aria-label="Search menu items"
          placeholder="Search items"
          value={search}
          onValueChange={setSearch}
        />
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger aria-label="Category">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {d.menu.categories.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={availability} onValueChange={setAvailability}>
          <SelectTrigger aria-label="Availability">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All items</SelectItem>
            <SelectItem value="available">Available</SelectItem>
            <SelectItem value="unavailable">Unavailable</SelectItem>
          </SelectContent>
        </Select>
      </FilterBar>
      {total === 0 ? (
        <EmptyState
          icon={<UtensilsCrossed />}
          title="This restaurant has no menu items yet"
          description="The owner or a manager adds them from the branch Menu page."
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          title="No items match"
          description="Try a different search or clear the filters."
        />
      ) : (
        filtered.map((c) => (
          <section key={c.id} aria-label={c.name} className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold">
              {c.name} {!c.isVisible && <Badge variant="outline">Hidden from customers</Badge>}
            </h2>
            <div className="grid gap-3 xl:grid-cols-2">
              {c.items.map((i) => (
                <ItemCard
                  key={i.id}
                  item={i}
                  branches={d.branches}
                  overrides={d.overrides}
                  currency={currency}
                />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
