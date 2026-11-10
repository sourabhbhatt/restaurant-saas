"use client";

import Image from "next/image";
import { PlusIcon, SearchXIcon, SparklesIcon, UtensilsCrossedIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import type { BranchMenuCategory, BranchMenuItem } from "@ros/contracts/menu";
import type { PublicBrandingDto } from "@ros/contracts/ordering";
import { effectiveItemPrice, startingPrice } from "@ros/domain/menu/pricing";
import { formatMoney } from "@ros/domain/shared/money";
import { Button } from "@ros/ui/ui/button";
import { SearchInput } from "@ros/ui/ui/search-input";
import { EmptyState } from "@ros/ui/shared/feedback/empty-state";
import { cn } from "@ros/ui/utils";

import { DietaryMark } from "./dietary-mark";

type DietFilter = "veg" | "nonveg" | "featured";

interface MenuViewProps {
  categories: BranchMenuCategory[];
  branding: PublicBrandingDto;
  currency: string;
  canOrder: boolean;
  onOpenItem: (item: BranchMenuItem) => void;
  onQuickAdd: (item: BranchMenuItem) => void;
}

const isCustomizable = (item: BranchMenuItem) =>
  item.variants.length > 0 || item.addonGroups.length > 0;

function matches(item: BranchMenuItem, query: string, filters: ReadonlySet<DietFilter>): boolean {
  if (filters.has("veg") && item.dietary !== "VEG" && item.dietary !== "VEGAN") return false;
  if (filters.has("nonveg") && item.dietary !== "NON_VEG" && item.dietary !== "EGG") return false;
  if (filters.has("featured") && !item.isFeatured) return false;
  if (!query) return true;
  const q = query.toLowerCase();
  return item.name.toLowerCase().includes(q) || (item.description ?? "").toLowerCase().includes(q);
}

/** Browsable customer menu: search, dietary filters, category chips with scroll-spy. */
export function MenuView({
  categories,
  branding,
  currency,
  canOrder,
  onOpenItem,
  onQuickAdd,
}: MenuViewProps) {
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<Set<DietFilter>>(new Set());
  const [active, setActive] = useState<string | null>(categories[0]?.id ?? null);
  const chipBar = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef(new Map<string, HTMLElement>());
  const clickScrolling = useRef(false);

  const visible = useMemo(
    () =>
      categories
        .map((c) => ({ ...c, items: c.items.filter((i) => matches(i, query.trim(), filters)) }))
        .filter((c) => c.items.length > 0),
    [categories, query, filters],
  );
  const featured = useMemo(
    () => categories.flatMap((c) => c.items).filter((i) => i.isFeatured),
    [categories],
  );

  // Scroll-spy: highlight the category whose section is at the top of the viewport.
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (clickScrolling.current) return;
        const top = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (top) setActive((top.target as HTMLElement).dataset.categoryId ?? null);
      },
      { rootMargin: "-140px 0px -55% 0px", threshold: 0 },
    );
    for (const el of sectionRefs.current.values()) observer.observe(el);
    return () => observer.disconnect();
  }, [visible]);

  // Keep the active chip in view inside the horizontal chip bar.
  useEffect(() => {
    if (!active) return;
    const chip = chipBar.current?.querySelector<HTMLElement>(`[data-chip="${active}"]`);
    chip?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }, [active]);

  const jumpTo = (id: string) => {
    const el = sectionRefs.current.get(id);
    if (!el) return;
    setActive(id);
    clickScrolling.current = true;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    window.setTimeout(() => {
      clickScrolling.current = false;
    }, 700);
  };

  const toggleFilter = (f: DietFilter) =>
    setFilters((current) => {
      const next = new Set(current);
      if (next.has(f)) next.delete(f);
      else {
        next.add(f);
        if (f === "veg") next.delete("nonveg");
        if (f === "nonveg") next.delete("veg");
      }
      return next;
    });

  const filtering = query.trim() !== "" || filters.size > 0;

  if (categories.length === 0) {
    return (
      <EmptyState
        className="mx-4 mt-8"
        icon={<UtensilsCrossedIcon />}
        title="The menu is being prepared"
        description="Nothing is available to order right now. Please check back shortly or ask a member of staff."
      />
    );
  }

  return (
    <div>
      {(branding.coverUrl || branding.welcomeMessage) && (
        <section className="px-4 pt-4">
          {branding.coverUrl && (
            <div className="relative aspect-[21/9] overflow-hidden rounded-2xl bg-muted">
              <Image
                src={branding.coverUrl}
                alt=""
                fill
                priority
                sizes="(min-width: 768px) 720px, 100vw"
                className="object-cover"
                unoptimized
              />
            </div>
          )}
          {branding.welcomeMessage && (
            <p className="mt-3 text-sm text-muted-foreground">{branding.welcomeMessage}</p>
          )}
        </section>
      )}

      <div className="sticky top-[var(--customer-header-h,64px)] z-20 border-b bg-background/95 pt-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="flex flex-col gap-2 px-4">
          <SearchInput
            value={query}
            onValueChange={setQuery}
            placeholder="Search dishes"
            aria-label="Search the menu"
            className="h-11"
          />
          <div className="-mx-4 flex [scrollbar-width:none] gap-2 overflow-x-auto px-4 pb-1">
            <FilterChip pressed={filters.has("veg")} onClick={() => toggleFilter("veg")}>
              <DietaryMark dietary="VEG" /> Veg
            </FilterChip>
            <FilterChip pressed={filters.has("nonveg")} onClick={() => toggleFilter("nonveg")}>
              <DietaryMark dietary="NON_VEG" /> Non-veg
            </FilterChip>
            {featured.length > 0 && (
              <FilterChip
                pressed={filters.has("featured")}
                onClick={() => toggleFilter("featured")}
              >
                <SparklesIcon className="size-3.5" aria-hidden /> Chef&apos;s picks
              </FilterChip>
            )}
          </div>
        </div>
        {visible.length > 1 && (
          <nav aria-label="Menu categories">
            <div
              ref={chipBar}
              className="flex [scrollbar-width:none] gap-1 overflow-x-auto px-3 py-2"
            >
              {visible.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  data-chip={c.id}
                  aria-current={active === c.id ? "true" : undefined}
                  onClick={() => jumpTo(c.id)}
                  className={cn(
                    "min-h-11 shrink-0 rounded-full px-4 text-sm font-medium whitespace-nowrap outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 motion-safe:transition-colors",
                    active === c.id
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                >
                  {c.name}
                </button>
              ))}
            </div>
          </nav>
        )}
      </div>

      {visible.length === 0 ? (
        <EmptyState
          className="mx-4 mt-8"
          icon={<SearchXIcon />}
          title="No dishes match"
          description="Try a different search or clear the filters."
          action={
            filtering ? (
              <Button
                variant="outline"
                onClick={() => {
                  setQuery("");
                  setFilters(new Set());
                }}
              >
                Clear search and filters
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-8 px-4 pt-4 pb-6">
          {visible.map((category) => (
            <section
              key={category.id}
              data-category-id={category.id}
              ref={(el) => {
                if (el) sectionRefs.current.set(category.id, el);
                else sectionRefs.current.delete(category.id);
              }}
              aria-labelledby={`cat-${category.id}`}
              className="scroll-mt-[calc(var(--customer-header-h,64px)+150px)]"
            >
              <h2 id={`cat-${category.id}`} className="text-lg font-semibold tracking-tight">
                {category.name}
              </h2>
              {category.description && (
                <p className="mt-0.5 text-sm text-muted-foreground">{category.description}</p>
              )}
              <ul className="mt-3 divide-y">
                {category.items.map((item) => (
                  <li key={item.id}>
                    <ItemCard
                      item={item}
                      currency={currency}
                      canOrder={canOrder}
                      onOpen={() => onOpenItem(item)}
                      onQuickAdd={() => onQuickAdd(item)}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function FilterChip({
  pressed,
  onClick,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        "inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 motion-safe:transition-colors",
        pressed
          ? "border-primary bg-primary/10 font-medium text-foreground"
          : "bg-background text-muted-foreground hover:bg-accent",
      )}
    >
      {children}
    </button>
  );
}

function ItemCard({
  item,
  currency,
  canOrder,
  onOpen,
  onQuickAdd,
}: {
  item: BranchMenuItem;
  currency: string;
  canOrder: boolean;
  onOpen: () => void;
  onQuickAdd: () => void;
}) {
  const customizable = isCustomizable(item);
  const from = startingPrice(item);
  const showFrom =
    item.variants.length > 1 ||
    item.addonGroups.some((g) => g.minSelect > 0 && g.addons.length > 1);
  const discounted =
    item.variants.length === 0 &&
    item.discountedPrice !== null &&
    effectiveItemPrice(item) < item.price;

  return (
    <div className="relative flex gap-3 py-4">
      <button
        type="button"
        onClick={onOpen}
        className="absolute inset-0 rounded-lg outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        aria-label={`${item.name}, view details`}
      />
      <div className="pointer-events-none min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <DietaryMark dietary={item.dietary} />
          {item.isFeatured && (
            <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
              <SparklesIcon className="size-3" aria-hidden /> Chef&apos;s pick
            </span>
          )}
        </div>
        <h3 className="mt-1 leading-snug font-medium">{item.name}</h3>
        <p className="mt-0.5 text-sm font-semibold tabular-nums">
          {showFrom && <span className="font-normal text-muted-foreground">from </span>}
          {formatMoney(from, currency)}
          {discounted && (
            <s className="ml-1.5 text-xs font-normal text-muted-foreground">
              {formatMoney(item.price, currency)}
            </s>
          )}
        </p>
        {item.description && (
          <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{item.description}</p>
        )}
      </div>
      <div className="relative flex w-28 shrink-0 flex-col items-center">
        {item.imageUrl ? (
          <div className="pointer-events-none relative size-28 overflow-hidden rounded-xl bg-muted">
            <Image
              src={item.imageUrl}
              alt=""
              fill
              sizes="112px"
              className="object-cover"
              loading="lazy"
              unoptimized
            />
          </div>
        ) : (
          <div className="h-10" aria-hidden />
        )}
        {canOrder && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={customizable ? onOpen : onQuickAdd}
            className={cn(
              "relative z-10 h-11 min-w-24 rounded-full border-primary/40 bg-background font-semibold text-primary shadow-sm hover:bg-primary/5 hover:text-primary",
              item.imageUrl && "-mt-5",
            )}
            // Starts with the visible "Add" (WCAG 2.5.3).
            aria-label={customizable ? `Add, customize ${item.name}` : `Add ${item.name}`}
          >
            <PlusIcon className="size-4" aria-hidden />
            Add
          </Button>
        )}
        {canOrder && customizable && (
          <span className="mt-1 text-[11px] text-muted-foreground">Customizable</span>
        )}
      </div>
    </div>
  );
}
