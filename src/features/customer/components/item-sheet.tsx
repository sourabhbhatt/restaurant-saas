"use client";

import Image from "next/image";
import { ClockIcon } from "lucide-react";
import { useId, useRef, useState } from "react";

import { ALLERGEN_LABELS, DIETARY_LABELS, type BranchMenuItem } from "@ros/contracts/menu";
import { effectiveItemPrice, priceSelection } from "@ros/domain/menu/pricing";
import { DomainError } from "@ros/domain/shared/errors";
import { formatMoney } from "@ros/domain/shared/money";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import type { CartLine } from "../cart-store";
import { DietaryMark } from "./dietary-mark";
import { QuantityStepper } from "./quantity-stepper";

interface ItemSheetProps {
  item: BranchMenuItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currency: string;
  showAllergens: boolean;
  showPrepTime: boolean;
  canAdd: boolean;
  onAdd: (line: Omit<CartLine, "id">) => void;
}

/** Item detail + customization bottom sheet with live pricing and inline min/max validation. */
export function ItemSheet({ item, open, onOpenChange, ...rest }: ItemSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="mx-auto max-h-[92dvh] w-full max-w-2xl gap-0 sm:rounded-t-2xl"
        aria-describedby={undefined}
      >
        {item && (
          <ItemSheetBody key={item.id} item={item} onDone={() => onOpenChange(false)} {...rest} />
        )}
      </SheetContent>
    </Sheet>
  );
}

function defaultVariantId(item: BranchMenuItem): string | null {
  const available = item.variants.filter((v) => v.isAvailable);
  const preferred = available.find((v) => (v as { isDefault?: boolean }).isDefault) ?? available[0];
  return preferred?.id ?? null;
}

function ItemSheetBody({
  item,
  currency,
  showAllergens,
  showPrepTime,
  canAdd,
  onAdd,
  onDone,
}: Omit<ItemSheetProps, "item" | "open" | "onOpenChange"> & {
  item: BranchMenuItem;
  onDone: () => void;
}) {
  const ids = useId();
  const [variantId, setVariantId] = useState<string | null>(() => defaultVariantId(item));
  const [addonIds, setAddonIds] = useState<string[]>([]);
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  // Validation with the same rules the server applies.
  let errors: Record<string, string[]> = {};
  try {
    priceSelection(item, { variantId, addonIds, quantity });
  } catch (error) {
    if (error instanceof DomainError) errors = error.fieldErrors ?? {};
    else throw error;
  }
  const valid = Object.keys(errors).length === 0;

  const variant = item.variants.find((v) => v.id === variantId) ?? null;
  const base = variant ? variant.price : effectiveItemPrice(item);
  const selectedAddons = item.addonGroups.flatMap((g) =>
    g.addons.filter((a) => addonIds.includes(a.id)).map((a) => ({ ...a, groupName: g.name })),
  );
  const unitPrice = base + selectedAddons.reduce((acc, a) => acc + a.price, 0);
  const discounted =
    !variant && item.discountedPrice !== null && effectiveItemPrice(item) < item.price;

  const toggleAddon = (groupId: string, addonId: string, checked: boolean) => {
    const group = item.addonGroups.find((g) => g.id === groupId);
    if (!group) return;
    setAddonIds((current) => {
      const inGroup = current.filter((id) => group.addons.some((a) => a.id === id));
      if (!checked) return current.filter((id) => id !== addonId);
      if (group.maxSelect === 1) {
        return [...current.filter((id) => !inGroup.includes(id)), addonId];
      }
      if (inGroup.length >= group.maxSelect) return current;
      return [...current, addonId];
    });
  };

  const submit = () => {
    setSubmitted(true);
    if (!valid) {
      // Bring the first problem into view and move focus to it.
      requestAnimationFrame(() => {
        const invalid = bodyRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
        invalid?.scrollIntoView({ block: "center" });
        invalid?.querySelector<HTMLElement>("button:not([disabled])")?.focus();
      });
      return;
    }
    if (!canAdd) return;
    onAdd({
      menuItemId: item.id,
      variantId: variant?.id ?? null,
      addonIds,
      quantity,
      notes: notes.trim(),
      name: item.name,
      variantName: variant?.name ?? null,
      addonNames: selectedAddons.map((a) => a.name),
      unitPrice,
      dietary: item.dietary,
      imageUrl: item.imageUrl,
    });
    onDone();
  };

  const errorFor = (key: string) => (submitted ? errors[key]?.[0] : undefined);

  return (
    <>
      {item.imageUrl && (
        <div className="relative aspect-[16/9] w-full shrink-0 overflow-hidden rounded-t-xl bg-muted sm:rounded-t-2xl">
          <Image
            src={item.imageUrl}
            alt=""
            fill
            sizes="(min-width: 672px) 672px, 100vw"
            className="object-cover"
            unoptimized
          />
        </div>
      )}
      <SheetHeader className="pb-2">
        <div className="flex items-center gap-2">
          <DietaryMark dietary={item.dietary} />
          <span className="text-xs text-muted-foreground">{DIETARY_LABELS[item.dietary]}</span>
          {showPrepTime && item.prepTimeMinutes > 0 && (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <ClockIcon className="size-3.5" aria-hidden />~{item.prepTimeMinutes} min
            </span>
          )}
        </div>
        <SheetTitle className="text-xl">{item.name}</SheetTitle>
        {item.description ? (
          <SheetDescription>{item.description}</SheetDescription>
        ) : (
          <SheetDescription className="sr-only">Customize and add to your order</SheetDescription>
        )}
        {showAllergens && item.allergens.length > 0 && (
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Allergens:</span>{" "}
            {item.allergens.map((a) => ALLERGEN_LABELS[a]).join(", ")}
          </p>
        )}
      </SheetHeader>

      <SheetBody ref={bodyRef} className="space-y-6 pb-4">
        {item.variants.length > 0 && (
          <fieldset className="space-y-2" aria-describedby={`${ids}-variant-error`}>
            <legend className="flex w-full items-center justify-between text-sm font-semibold">
              Choose a size
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                Required
              </span>
            </legend>
            <RadioGroup
              value={variantId ?? ""}
              onValueChange={(v) => setVariantId(v)}
              className="gap-0 divide-y rounded-lg border"
              aria-invalid={Boolean(errorFor("variantId"))}
            >
              {item.variants.map((v) => (
                <label
                  key={v.id}
                  htmlFor={`${ids}-v-${v.id}`}
                  className={cn(
                    "flex min-h-12 cursor-pointer items-center gap-3 px-3",
                    !v.isAvailable && "cursor-not-allowed opacity-50",
                  )}
                >
                  <RadioGroupItem id={`${ids}-v-${v.id}`} value={v.id} disabled={!v.isAvailable} />
                  <span className="flex-1 text-sm">
                    {v.name}
                    {!v.isAvailable && <span className="ml-1 text-xs">(sold out)</span>}
                  </span>
                  <span className="text-sm tabular-nums">{formatMoney(v.price, currency)}</span>
                </label>
              ))}
            </RadioGroup>
            {errorFor("variantId") && (
              <p id={`${ids}-variant-error`} className="text-sm text-destructive" role="alert">
                {errorFor("variantId")}
              </p>
            )}
          </fieldset>
        )}

        {item.addonGroups.map((group) => {
          const chosen = group.addons.filter((a) => addonIds.includes(a.id)).length;
          const error = errorFor(`addonGroups.${group.id}`);
          const atMax = chosen >= group.maxSelect && group.maxSelect > 1;
          const hint =
            group.minSelect > 0 && group.minSelect === group.maxSelect
              ? `Choose ${group.minSelect}`
              : group.minSelect > 0
                ? `Choose ${group.minSelect}–${group.maxSelect}`
                : `Up to ${group.maxSelect}`;
          return (
            <fieldset
              key={group.id}
              className="space-y-2"
              aria-describedby={`${ids}-${group.id}-hint`}
            >
              <legend className="flex w-full items-center justify-between text-sm font-semibold">
                {group.name}
                <span
                  id={`${ids}-${group.id}-hint`}
                  className={cn(
                    "rounded-full px-2 py-0.5 text-xs font-medium",
                    error ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground",
                  )}
                >
                  {hint}
                  {group.minSelect > 0 && " · Required"}
                </span>
              </legend>
              <div
                className={cn("divide-y rounded-lg border", error && "border-destructive")}
                aria-invalid={Boolean(error)}
              >
                {group.addons.map((addon) => {
                  const checked = addonIds.includes(addon.id);
                  const disabled = !addon.isAvailable || (!checked && atMax);
                  return (
                    <label
                      key={addon.id}
                      htmlFor={`${ids}-a-${addon.id}`}
                      className={cn(
                        "flex min-h-12 cursor-pointer items-center gap-3 px-3",
                        disabled && "cursor-not-allowed opacity-50",
                      )}
                    >
                      <Checkbox
                        id={`${ids}-a-${addon.id}`}
                        checked={checked}
                        disabled={disabled}
                        onCheckedChange={(v) => toggleAddon(group.id, addon.id, v === true)}
                      />
                      <span className="flex-1 text-sm">
                        {addon.name}
                        {!addon.isAvailable && <span className="ml-1 text-xs">(sold out)</span>}
                      </span>
                      <span className="text-sm text-muted-foreground tabular-nums">
                        {addon.price > 0 ? `+${formatMoney(addon.price, currency)}` : "Free"}
                      </span>
                    </label>
                  );
                })}
              </div>
              {error && (
                <p className="text-sm text-destructive" role="alert">
                  {error}
                </p>
              )}
            </fieldset>
          );
        })}

        <div className="space-y-2">
          <label htmlFor={`${ids}-notes`} className="text-sm font-semibold">
            Notes for the kitchen{" "}
            <span className="font-normal text-muted-foreground">(optional)</span>
          </label>
          <Textarea
            id={`${ids}-notes`}
            value={notes}
            maxLength={200}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. less spicy, no onions"
            rows={2}
          />
          <p className="text-right text-xs text-muted-foreground tabular-nums">
            {notes.length}/200
          </p>
        </div>
      </SheetBody>

      <SheetFooter className="flex-row items-center gap-3 border-t bg-background">
        <QuantityStepper value={quantity} onChange={setQuantity} label={item.name} />
        <Button
          type="button"
          size="lg"
          className="h-12 flex-1 justify-between text-base sm:h-12"
          onClick={submit}
          disabled={!canAdd || (submitted && !valid)}
        >
          <span>{canAdd ? "Add to order" : "Ordering paused"}</span>
          <span className="tabular-nums">
            {discounted && (
              <s className="mr-1.5 text-sm font-normal opacity-70">
                {formatMoney((item.price + unitPrice - base) * quantity, currency)}
              </s>
            )}
            {formatMoney(unitPrice * quantity, currency)}
          </span>
        </Button>
      </SheetFooter>
    </>
  );
}
