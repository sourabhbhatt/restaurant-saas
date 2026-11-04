import { DomainError, type FieldErrors } from "../shared/errors";
import { assertMinorUnits } from "../shared/money";

/**
 * Item pricing and customization validation. Shared by the customer cart
 * (preview) and the server (authoritative price at order time). The server
 * always recomputes from the database; a price sent by a client is ignored.
 */

export const DIETARY_TYPES = ["VEG", "NON_VEG", "EGG", "VEGAN"] as const;
export type DietaryType = (typeof DIETARY_TYPES)[number];

export const ALLERGENS = [
  "GLUTEN",
  "DAIRY",
  "EGG",
  "PEANUT",
  "TREE_NUT",
  "SOY",
  "FISH",
  "SHELLFISH",
  "SESAME",
  "MUSTARD",
  "CELERY",
  "SULPHITES",
] as const;
export type Allergen = (typeof ALLERGENS)[number];

export interface PricedVariant {
  id: string;
  name: string;
  price: number;
  isAvailable: boolean;
}

export interface PricedAddon {
  id: string;
  name: string;
  price: number;
  isAvailable: boolean;
}

export interface PricedAddonGroup {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  addons: readonly PricedAddon[];
}

/** The menu item as the pricing engine sees it, after branch overrides. */
export interface PricedItem {
  id: string;
  name: string;
  /** Base price used when the item has no variants. */
  price: number;
  /** Optional sale price; when set and lower than price it is charged instead. */
  discountedPrice: number | null;
  isAvailable: boolean;
  variants: readonly PricedVariant[];
  addonGroups: readonly PricedAddonGroup[];
}

export interface ItemSelection {
  variantId?: string | null;
  addonIds?: readonly string[];
  quantity: number;
}

export interface PricedLine {
  itemId: string;
  itemName: string;
  variantId: string | null;
  variantName: string | null;
  /** Unit price of item/variant before add-ons. */
  baseUnitPrice: number;
  addons: { id: string; groupName: string; name: string; price: number }[];
  addonsUnitTotal: number;
  /** baseUnitPrice + addonsUnitTotal */
  unitPrice: number;
  quantity: number;
  lineTotal: number;
}

export const MAX_LINE_QUANTITY = 99;

/** Effective selling price of an item without variants. */
export function effectiveItemPrice(item: Pick<PricedItem, "price" | "discountedPrice">): number {
  if (
    item.discountedPrice !== null &&
    item.discountedPrice >= 0 &&
    item.discountedPrice < item.price
  ) {
    return item.discountedPrice;
  }
  return item.price;
}

/**
 * Validate a selection and compute its price. Throws a VALIDATION_FAILED
 * DomainError with field-level messages when a rule is broken.
 */
export function priceSelection(item: PricedItem, selection: ItemSelection): PricedLine {
  const errors: FieldErrors = {};
  const push = (field: string, message: string) => {
    (errors[field] ??= []).push(message);
  };

  if (!item.isAvailable) push("item", `${item.name} is currently unavailable`);
  if (!Number.isInteger(selection.quantity) || selection.quantity < 1) {
    push("quantity", "Quantity must be at least 1");
  } else if (selection.quantity > MAX_LINE_QUANTITY) {
    push("quantity", `Quantity cannot exceed ${MAX_LINE_QUANTITY}`);
  }

  let variant: PricedVariant | null = null;
  if (item.variants.length > 0) {
    if (!selection.variantId) {
      push("variantId", "Choose a size or variant");
    } else {
      variant = item.variants.find((v) => v.id === selection.variantId) ?? null;
      if (!variant) push("variantId", "Selected variant does not exist");
      else if (!variant.isAvailable) push("variantId", `${variant.name} is currently unavailable`);
    }
  } else if (selection.variantId) {
    push("variantId", "This item has no variants");
  }

  const addonIds = [...new Set(selection.addonIds ?? [])];
  if (addonIds.length !== (selection.addonIds ?? []).length) {
    push("addonIds", "An add-on was selected more than once");
  }
  const chosen: PricedLine["addons"] = [];
  const known = new Set<string>();
  for (const group of item.addonGroups) {
    const inGroup = group.addons.filter((a) => addonIds.includes(a.id));
    for (const addon of group.addons) known.add(addon.id);
    if (inGroup.length < group.minSelect) {
      push(
        `addonGroups.${group.id}`,
        group.minSelect === 1
          ? `Choose an option for ${group.name}`
          : `Choose at least ${group.minSelect} options for ${group.name}`,
      );
    }
    if (inGroup.length > group.maxSelect) {
      push(
        `addonGroups.${group.id}`,
        `Choose at most ${group.maxSelect} options for ${group.name}`,
      );
    }
    for (const addon of inGroup) {
      if (!addon.isAvailable)
        push(`addonGroups.${group.id}`, `${addon.name} is currently unavailable`);
      chosen.push({ id: addon.id, groupName: group.name, name: addon.name, price: addon.price });
    }
  }
  if (addonIds.some((id) => !known.has(id))) push("addonIds", "Selected add-on does not exist");

  if (Object.keys(errors).length > 0) {
    throw new DomainError("VALIDATION_FAILED", `Please review your choices for ${item.name}`, {
      fieldErrors: errors,
    });
  }

  const baseUnitPrice = variant ? variant.price : effectiveItemPrice(item);
  const addonsUnitTotal = chosen.reduce((acc, a) => acc + a.price, 0);
  const unitPrice = baseUnitPrice + addonsUnitTotal;
  const lineTotal = unitPrice * selection.quantity;
  assertMinorUnits(lineTotal, "lineTotal");

  return {
    itemId: item.id,
    itemName: item.name,
    variantId: variant?.id ?? null,
    variantName: variant?.name ?? null,
    baseUnitPrice,
    addons: chosen,
    addonsUnitTotal,
    unitPrice,
    quantity: selection.quantity,
    lineTotal,
  };
}

/** Lowest price a customer could pay for one unit (for "from ₹x" labels). */
export function startingPrice(item: PricedItem): number {
  const available = item.variants.filter((v) => v.isAvailable);
  const base =
    available.length > 0 ? Math.min(...available.map((v) => v.price)) : effectiveItemPrice(item);
  const requiredAddons = item.addonGroups.reduce((acc, group) => {
    if (group.minSelect === 0) return acc;
    const prices = group.addons
      .filter((a) => a.isAvailable)
      .map((a) => a.price)
      .sort((a, b) => a - b)
      .slice(0, group.minSelect);
    return acc + prices.reduce((x, y) => x + y, 0);
  }, 0);
  return base + requiredAddons;
}
