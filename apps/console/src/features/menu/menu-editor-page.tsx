"use client";

import {
  ArrowDown,
  ArrowUp,
  Eye,
  EyeOff,
  FolderPlus,
  ImageIcon,
  MoreHorizontal,
  Pencil,
  Plus,
  Star,
  Trash2,
  UtensilsCrossed,
} from "lucide-react";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import {
  ConfirmDialog,
  EmptyState,
  ErrorState,
  FilterBar,
  GatedAction,
  PageHeader,
  PageSkeleton,
} from "@ros/ui/shared/feedback";
import { Alert, AlertDescription } from "@ros/ui/ui/alert";
import { Badge } from "@ros/ui/ui/badge";
import { Button } from "@ros/ui/ui/button";
import { Card } from "@ros/ui/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@ros/ui/ui/dropdown-menu";
import { SearchInput } from "@ros/ui/ui/search-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ros/ui/ui/select";
import { Switch } from "@ros/ui/ui/switch";
import {
  DIETARY_LABELS,
  type BranchMenu,
  type BranchOverrideDto,
  type MenuCategoryDto,
  type MenuItemDto,
  type MenuTreeDto,
} from "@ros/contracts/menu";
import { DIETARY_TYPES, startingPrice, type PricedItem } from "@ros/domain/menu/pricing";
import { formatMoney } from "@ros/domain/shared/money";
import { errorMessage } from "@ros/api-client";
import { cn } from "@ros/ui/utils";
import { permissionChecker, useBranchContext } from "@ros/web-core/features/session/queries";
import { LimitNoticeView, useLimit } from "@ros/web-core/features/subscriptions/limit-notice";

import { CategoryDialog } from "./category-dialog";
import { ItemEditorSheet } from "./item-editor-sheet";
import { DietaryMark } from "./menu-ui";
import {
  useBranchMenu,
  useBranchOverrides,
  useDeleteCategory,
  useMenuTree,
  usePutOverride,
  useSetAvailability,
  useUpdateCategory,
  useUpdateItem,
} from "./queries";

interface ViewCategory {
  id: string;
  name: string;
  description: string | null;
  isVisible: boolean;
  dto: MenuCategoryDto | null;
}

interface ViewItem {
  id: string;
  categoryId: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  dietary: MenuItemDto["dietary"];
  isFeatured: boolean;
  /** Restaurant-wide flag (tree mode) or effective flag (branch mode). */
  isAvailable: boolean;
  /** Effective at this branch. */
  branchAvailable: boolean;
  /** Lowest price a guest pays at this branch. */
  fromPrice: number;
  hasOverride: boolean;
  variantCount: number;
  dto: MenuItemDto | null;
}

function fromTree(tree: MenuTreeDto, overrides: BranchOverrideDto[]) {
  const byItem = new Map(overrides.map((o) => [o.itemId, o]));
  const categories: ViewCategory[] = tree.categories.map((c) => ({
    id: c.id,
    name: c.name,
    description: c.description,
    isVisible: c.isVisible,
    dto: c,
  }));
  const items: ViewItem[] = tree.categories.flatMap((c) =>
    c.items.map((i) => {
      const ov = byItem.get(i.id);
      const priced: PricedItem = {
        ...i,
        price: ov?.price ?? i.price,
        discountedPrice: ov?.discountedPrice ?? i.discountedPrice,
      };
      const hasOverride =
        Boolean(ov) &&
        (ov!.price !== null || ov!.discountedPrice !== null || ov!.isAvailable !== null);
      return {
        id: i.id,
        categoryId: i.categoryId,
        name: i.name,
        description: i.description,
        imageUrl: i.imageUrl,
        dietary: i.dietary,
        isFeatured: i.isFeatured,
        isAvailable: i.isAvailable,
        branchAvailable: ov?.isAvailable ?? i.isAvailable,
        fromPrice: startingPrice(priced),
        hasOverride,
        variantCount: i.variants.length,
        dto: i,
      };
    }),
  );
  return { categories, items };
}

function fromBranch(menu: BranchMenu, overrides: BranchOverrideDto[]) {
  const ovIds = new Set(
    overrides
      .filter((o) => o.price !== null || o.discountedPrice !== null || o.isAvailable !== null)
      .map((o) => o.itemId),
  );
  const categories: ViewCategory[] = menu.categories.map((c) => ({
    id: c.id,
    name: c.name,
    description: c.description,
    isVisible: true,
    dto: null,
  }));
  const items: ViewItem[] = menu.categories.flatMap((c) =>
    c.items.map((i) => ({
      id: i.id,
      categoryId: i.categoryId,
      name: i.name,
      description: i.description,
      imageUrl: i.imageUrl,
      dietary: i.dietary,
      isFeatured: i.isFeatured,
      isAvailable: i.isAvailable,
      branchAvailable: i.isAvailable,
      fromPrice: startingPrice(i),
      hasOverride: ovIds.has(i.id),
      variantCount: i.variants.length,
      dto: null,
    })),
  );
  return { categories, items };
}

type AvailabilityFilter = "all" | "available" | "unavailable";

/** /app/b/[branchId]/menu — menu editor (managers) or read-only menu with branch toggles. */
export function MenuEditorPage() {
  const { branchId } = useParams<{ branchId: string }>();
  const ctx = useBranchContext(branchId);
  const can = permissionChecker(ctx.data?.permissions);
  const canView = can("menu.view");
  const canEdit = can("menu.manage");
  const canBranch = can("menu.availability.manage");
  const ready = Boolean(ctx.data);

  const tree = useMenuTree(ctx.data?.restaurantId, ready && canView);
  const branchMenu = useBranchMenu(branchId, ready && !canView);
  const overrides = useBranchOverrides(branchId, ready && (canView || canBranch));
  const limit = useLimit(canEdit ? ctx.data?.workspaceId : undefined, "maxMenuItems");

  const [categoryId, setCategoryId] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [dietary, setDietary] = useState<string>("all");
  const [availability, setAvailability] = useState<AvailabilityFilter>("all");
  const [editing, setEditing] = useState<{ item: MenuItemDto | null } | null>(null);
  const [categoryDialog, setCategoryDialog] = useState<{ category: MenuCategoryDto | null } | null>(
    null,
  );
  const [deleteCategory, setDeleteCategory] = useState<ViewCategory | null>(null);

  const source = canView ? tree : branchMenu;
  const view = useMemo(() => {
    const ov = overrides.data ?? [];
    if (canView && tree.data) return fromTree(tree.data, ov);
    if (!canView && branchMenu.data) return fromBranch(branchMenu.data, ov);
    return null;
  }, [canView, tree.data, branchMenu.data, overrides.data]);

  const filtered = useMemo(() => {
    if (!view) return [];
    const q = search.trim().toLowerCase();
    return view.items.filter(
      (i) =>
        (categoryId === "all" || i.categoryId === categoryId) &&
        (dietary === "all" || i.dietary === dietary) &&
        (availability === "all" ||
          (availability === "available" ? i.branchAvailable : !i.branchAvailable)) &&
        (!q || i.name.toLowerCase().includes(q) || i.description?.toLowerCase().includes(q)),
    );
  }, [view, search, categoryId, dietary, availability]);

  if (ctx.isPending || (source.isPending && source.fetchStatus !== "idle")) {
    return <PageSkeleton variant="cards" />;
  }
  if (ctx.isError || source.isError) {
    return (
      <ErrorState
        title="Couldn't load the menu"
        message={errorMessage(ctx.error ?? source.error)}
        onRetry={() => void (ctx.isError ? ctx.refetch() : source.refetch())}
      />
    );
  }
  const b = ctx.data;
  if (!view) return <PageSkeleton variant="cards" />;

  const overrideFor = (itemId: string) =>
    (overrides.data ?? []).find((o) => o.itemId === itemId) ?? null;
  const filtersActive =
    search !== "" || dietary !== "all" || availability !== "all" || categoryId !== "all";
  const addItemReason =
    view.categories.length === 0
      ? "Add a category first. Every item belongs to a category, such as Starters."
      : limit.reason;
  const addItemButton = (align: "start" | "end") => (
    <GatedAction reason={addItemReason} align={align}>
      {(gate) => (
        <Button onClick={() => setEditing({ item: null })} {...gate}>
          <Plus aria-hidden /> Add menu item
        </Button>
      )}
    </GatedAction>
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Menu"
        description={
          canEdit
            ? `Shared by every ${b.restaurantName} branch. Branch prices and availability are set per item.`
            : `What guests at ${b.branchName} can order.`
        }
        actions={
          canEdit ? (
            <>
              <Button variant="outline" onClick={() => setCategoryDialog({ category: null })}>
                <FolderPlus aria-hidden /> Add category
              </Button>
              {view.categories.length > 0 ? addItemButton("end") : null}
            </>
          ) : undefined
        }
      />

      {!canEdit && (
        <Alert>
          <AlertDescription>
            {canBranch
              ? `You can switch items on or off for ${b.branchName}. Ask a menu manager to change items or prices.`
              : "You can view the menu. Ask a manager to change items or availability."}
          </AlertDescription>
        </Alert>
      )}

      {canEdit && limit.data ? (
        <LimitNoticeView
          workspaceId={b.workspaceId}
          limitKey="maxMenuItems"
          entitlements={limit.data.entitlements}
          usage={limit.data.usage}
          scopeNote="Menu items count across all restaurants in this workspace."
        />
      ) : null}

      {view.categories.length === 0 ? (
        <EmptyState
          icon={<UtensilsCrossed />}
          title="No menu yet"
          description={
            canEdit
              ? "Start with a category such as Starters or Drinks, then add items to it."
              : "Your managers haven't published a menu for this branch yet."
          }
          action={
            canEdit ? (
              <Button onClick={() => setCategoryDialog({ category: null })}>
                <FolderPlus aria-hidden /> Add category
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[16rem_1fr]">
          <CategoryPanel
            categories={view.categories}
            items={view.items}
            selected={categoryId}
            onSelect={setCategoryId}
            canEdit={canEdit}
            onEdit={(c) => c.dto && setCategoryDialog({ category: c.dto })}
            onDelete={setDeleteCategory}
          />

          <section className="flex min-w-0 flex-col gap-4" aria-label="Menu items">
            <FilterBar>
              <SearchInput
                value={search}
                onValueChange={setSearch}
                placeholder="Search items"
                aria-label="Search items"
              />
              <Select value={dietary} onValueChange={setDietary}>
                <SelectTrigger aria-label="Dietary filter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All diets</SelectItem>
                  {DIETARY_TYPES.map((d) => (
                    <SelectItem key={d} value={d}>
                      {DIETARY_LABELS[d]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={availability}
                onValueChange={(v) => setAvailability(v as AvailabilityFilter)}
              >
                <SelectTrigger aria-label="Availability filter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Any availability</SelectItem>
                  <SelectItem value="available">Available here</SelectItem>
                  <SelectItem value="unavailable">Unavailable here</SelectItem>
                </SelectContent>
              </Select>
            </FilterBar>

            {filtered.length === 0 ? (
              <EmptyState
                size="compact"
                icon={<UtensilsCrossed />}
                title={filtersActive ? "No items match" : "No items in this category"}
                description={
                  filtersActive
                    ? "Try a different search or clear the filters."
                    : canEdit
                      ? "Add the first item to this category."
                      : undefined
                }
                action={
                  filtersActive ? (
                    <Button
                      variant="outline"
                      onClick={() => {
                        setSearch("");
                        setDietary("all");
                        setAvailability("all");
                        setCategoryId("all");
                      }}
                    >
                      Clear filters
                    </Button>
                  ) : canEdit ? (
                    addItemButton("start")
                  ) : undefined
                }
              />
            ) : (
              <ul className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
                {filtered.map((item) => (
                  <ItemCard
                    key={item.id}
                    item={item}
                    currency={b.currency}
                    branchId={branchId}
                    branchName={b.branchName}
                    restaurantId={b.restaurantId}
                    categoryName={view.categories.find((c) => c.id === item.categoryId)?.name}
                    categoryHidden={
                      !view.categories.find((c) => c.id === item.categoryId)?.isVisible
                    }
                    canEdit={canEdit}
                    canBranch={canBranch}
                    onOpen={() => item.dto && setEditing({ item: item.dto })}
                  />
                ))}
              </ul>
            )}
          </section>
        </div>
      )}

      {canEdit && (
        <>
          <ItemEditorSheet
            open={editing !== null}
            onOpenChange={(open) => !open && setEditing(null)}
            item={editing?.item ?? null}
            categories={tree.data?.categories ?? []}
            defaultCategoryId={categoryId !== "all" ? categoryId : undefined}
            restaurantId={b.restaurantId}
            workspaceId={b.workspaceId}
            branchId={branchId}
            branchName={b.branchName}
            currency={b.currency}
            override={editing?.item ? overrideFor(editing.item.id) : null}
            canManageBranch={canBranch}
          />
          <CategoryDialog
            open={categoryDialog !== null}
            onOpenChange={(open) => !open && setCategoryDialog(null)}
            restaurantId={b.restaurantId}
            category={categoryDialog?.category ?? null}
          />
          <DeleteCategoryDialog
            category={deleteCategory}
            onClose={() => setDeleteCategory(null)}
            onDeleted={(id) => categoryId === id && setCategoryId("all")}
          />
        </>
      )}
    </div>
  );
}

function DeleteCategoryDialog({
  category,
  onClose,
  onDeleted,
}: {
  category: ViewCategory | null;
  onClose: () => void;
  onDeleted: (id: string) => void;
}) {
  const del = useDeleteCategory();
  return (
    <ConfirmDialog
      open={category !== null}
      onOpenChange={(open) => !open && onClose()}
      title={`Delete ${category?.name ?? "category"}?`}
      description="Only empty categories can be deleted. Move or delete its items first."
      confirmLabel="Delete category"
      destructive
      getErrorMessage={errorMessage}
      onConfirm={async () => {
        if (!category) return;
        await del.mutateAsync(category.id);
        toast.success(`${category.name} deleted`);
        onDeleted(category.id);
      }}
    />
  );
}

function CategoryPanel({
  categories,
  items,
  selected,
  onSelect,
  canEdit,
  onEdit,
  onDelete,
}: {
  categories: ViewCategory[];
  items: ViewItem[];
  selected: string;
  onSelect: (id: string) => void;
  canEdit: boolean;
  onEdit: (c: ViewCategory) => void;
  onDelete: (c: ViewCategory) => void;
}) {
  const update = useUpdateCategory();
  const count = (id: string) => items.filter((i) => i.categoryId === id).length;

  const run = async (label: string, input: Parameters<typeof update.mutateAsync>[0]) => {
    try {
      await update.mutateAsync(input);
      toast.success(label);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <Card className="min-w-0 gap-0 self-start p-2 lg:sticky lg:top-20">
      <nav aria-label="Categories">
        <ul className="flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
          <li className="shrink-0">
            <button
              type="button"
              onClick={() => onSelect("all")}
              aria-current={selected === "all" ? "true" : undefined}
              className={cn(
                "flex min-h-10 w-full items-center justify-between gap-2 rounded-md px-3 text-left text-sm hover:bg-accent",
                selected === "all" && "bg-accent font-medium",
              )}
            >
              All items <span className="text-xs text-muted-foreground">{items.length}</span>
            </button>
          </li>
          {categories.map((c, index) => (
            <li key={c.id} className="group flex shrink-0 items-center gap-0.5">
              <button
                type="button"
                onClick={() => onSelect(c.id)}
                aria-current={selected === c.id ? "true" : undefined}
                className={cn(
                  "flex min-h-10 min-w-0 flex-1 items-center justify-between gap-2 rounded-md px-3 text-left text-sm hover:bg-accent",
                  selected === c.id && "bg-accent font-medium",
                  !c.isVisible && "text-muted-foreground",
                )}
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  {!c.isVisible && <EyeOff className="size-3.5 shrink-0" aria-label="Hidden" />}
                  <span className="truncate">{c.name}</span>
                </span>
                <span className="text-xs text-muted-foreground">{count(c.id)}</span>
              </button>
              {canEdit && c.dto && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-sm" aria-label={`${c.name} options`}>
                      <MoreHorizontal aria-hidden />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => onEdit(c)}>
                      <Pencil aria-hidden /> Edit category
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() =>
                        void run(c.isVisible ? `${c.name} hidden` : `${c.name} visible`, {
                          id: c.id,
                          isVisible: !c.isVisible,
                          version: c.dto!.version,
                        })
                      }
                    >
                      {c.isVisible ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
                      {c.isVisible ? "Hide from guests" : "Show to guests"}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={index === 0}
                      onSelect={() => void run("Order updated", { id: c.id, sortOrder: index - 1 })}
                    >
                      <ArrowUp aria-hidden /> Move up
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={index === categories.length - 1}
                      onSelect={() => void run("Order updated", { id: c.id, sortOrder: index + 1 })}
                    >
                      <ArrowDown aria-hidden /> Move down
                    </DropdownMenuItem>
                    <DropdownMenuItem variant="destructive" onSelect={() => onDelete(c)}>
                      <Trash2 aria-hidden /> Delete category
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </li>
          ))}
        </ul>
      </nav>
    </Card>
  );
}

function ItemCard({
  item,
  currency,
  branchId,
  branchName,
  restaurantId,
  categoryName,
  categoryHidden,
  canEdit,
  canBranch,
  onOpen,
}: {
  item: ViewItem;
  currency: string;
  branchId: string;
  branchName: string;
  restaurantId: string;
  categoryName: string | undefined;
  categoryHidden: boolean;
  canEdit: boolean;
  canBranch: boolean;
  onOpen: () => void;
}) {
  const setAvailability = useSetAvailability(restaurantId);
  const putOverride = usePutOverride(branchId);
  const updateItem = useUpdateItem();

  const toggleAvailable = async (on: boolean) => {
    try {
      if (canEdit) {
        await setAvailability.mutateAsync({ id: item.id, isAvailable: on });
        toast.success(`${item.name} ${on ? "available" : "unavailable"} at all branches`);
      } else {
        await putOverride.mutateAsync({ itemId: item.id, isAvailable: on });
        toast.success(`${item.name} ${on ? "available" : "unavailable"} at ${branchName}`);
      }
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const toggleFeatured = async () => {
    if (!item.dto) return;
    try {
      await updateItem.mutateAsync({
        id: item.id,
        isFeatured: !item.isFeatured,
        version: item.dto.version,
      });
      toast.success(item.isFeatured ? "Removed from featured" : `${item.name} featured`);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const switchOn = canEdit ? item.isAvailable : item.branchAvailable;
  const showSwitch = canEdit || canBranch;
  const pending = setAvailability.isPending || putOverride.isPending;

  const body = (
    <>
      <div className="relative size-16 shrink-0 overflow-hidden rounded-lg bg-muted sm:size-20">
        {item.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- user uploads served from our files route
          <img src={item.imageUrl} alt="" className="size-full object-cover" loading="lazy" />
        ) : (
          <ImageIcon className="absolute inset-0 m-auto size-6 text-muted-foreground" aria-hidden />
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-start gap-2">
          <DietaryMark dietary={item.dietary} className="mt-0.5" />
          <span className="line-clamp-2 font-medium">{item.name}</span>
        </div>
        <span className="text-sm font-semibold tabular-nums">
          {item.variantCount > 0 ? "From " : ""}
          {formatMoney(item.fromPrice, currency)}
        </span>
        <div className="flex flex-wrap gap-1">
          {categoryName && <Badge variant="outline">{categoryName}</Badge>}
          {categoryHidden && <Badge variant="secondary">Hidden category</Badge>}
          {!item.branchAvailable && <Badge variant="destructive">Unavailable here</Badge>}
          {item.hasOverride && <Badge variant="info">Branch override</Badge>}
        </div>
      </div>
    </>
  );

  return (
    <li
      className={cn(
        "relative flex gap-3 rounded-xl border bg-card p-3 shadow-xs",
        !item.branchAvailable && "bg-muted/40",
      )}
    >
      {canEdit && item.dto ? (
        <button
          type="button"
          onClick={onOpen}
          className="flex min-w-0 flex-1 gap-3 rounded-lg text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <span className="sr-only">Edit </span>
          {body}
        </button>
      ) : (
        <div className="flex min-w-0 flex-1 gap-3">{body}</div>
      )}
      <div className="flex shrink-0 flex-col items-end justify-between gap-2">
        {canEdit ? (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-pressed={item.isFeatured}
            aria-label={item.isFeatured ? `Unfeature ${item.name}` : `Feature ${item.name}`}
            disabled={updateItem.isPending}
            onClick={() => void toggleFeatured()}
          >
            <Star aria-hidden className={cn(item.isFeatured && "fill-warning text-warning")} />
          </Button>
        ) : item.isFeatured ? (
          <Star aria-label="Featured" className="size-4 fill-warning text-warning" />
        ) : (
          <span />
        )}
        {showSwitch && (
          <Switch
            checked={switchOn}
            disabled={pending}
            onCheckedChange={(on) => void toggleAvailable(on)}
            aria-label={
              canEdit
                ? `${item.name} available at all branches`
                : `${item.name} available at ${branchName}`
            }
          />
        )}
      </div>
    </li>
  );
}
