import { DomainError, type FieldErrors } from "../shared/errors";
import {
  priceSelection,
  type DietaryType,
  type PricedItem,
  type PricedLine,
} from "../menu/pricing";

/**
 * Order repricing. Every line a client submits is priced again from the
 * branch-effective menu: client-side prices are never read. The result is the
 * snapshot persisted on the order (names, variant, add-ons, prices, category
 * and dietary marker), so later menu edits never change a placed order.
 *
 * Used by both customer (QR) and staff order placement.
 */

export interface MenuCatalogEntry {
  item: PricedItem;
  categoryName: string | null;
  dietary: DietaryType | null;
}

export interface OrderLineRequest {
  menuItemId: string;
  variantId?: string | null;
  addonIds?: readonly string[];
  quantity: number;
  notes?: string | null;
}

export interface SnapshotLine extends PricedLine {
  categoryName: string | null;
  dietary: DietaryType | null;
  notes: string | null;
}

export interface PricedOrder {
  lines: SnapshotLine[];
  subtotal: number;
  itemCount: number;
}

/**
 * Price all lines or throw one VALIDATION_FAILED error whose field keys are
 * prefixed with the line index (`lines.0.variantId`, `lines.2.item`, ...), so a
 * cart can highlight every problem at once.
 */
export function priceOrderLines(
  catalog: ReadonlyMap<string, MenuCatalogEntry>,
  lines: readonly OrderLineRequest[],
): PricedOrder {
  const errors: FieldErrors = {};
  const priced: SnapshotLine[] = [];

  lines.forEach((line, index) => {
    const prefix = `lines.${index}`;
    const entry = catalog.get(line.menuItemId);
    if (!entry) {
      (errors[`${prefix}.menuItemId`] ??= []).push(
        "This item is no longer on the menu. Remove it and try again.",
      );
      return;
    }
    try {
      const p = priceSelection(entry.item, {
        variantId: line.variantId ?? null,
        addonIds: line.addonIds ?? [],
        quantity: line.quantity,
      });
      priced.push({
        ...p,
        categoryName: entry.categoryName,
        dietary: entry.dietary,
        notes: line.notes?.trim() ? line.notes.trim() : null,
      });
    } catch (error) {
      if (error instanceof DomainError && error.code === "VALIDATION_FAILED") {
        for (const [field, messages] of Object.entries(error.fieldErrors ?? {})) {
          (errors[`${prefix}.${field}`] ??= []).push(...messages);
        }
        return;
      }
      throw error;
    }
  });

  if (Object.keys(errors).length > 0) {
    throw new DomainError(
      "VALIDATION_FAILED",
      "Some items in your order need attention. Review your cart and try again.",
      { fieldErrors: errors },
    );
  }

  return {
    lines: priced,
    subtotal: priced.reduce((acc, l) => acc + l.lineTotal, 0),
    itemCount: priced.reduce((acc, l) => acc + l.quantity, 0),
  };
}
