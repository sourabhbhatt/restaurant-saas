import {
  ACTIVE_ORDER_STATUSES,
  BILLABLE_ORDER_STATUSES,
  KITCHEN_STATUSES,
  type OrderStatus,
} from "../orders/order-status";

/**
 * Turn a table session's orders (with their order-time snapshots) into bill
 * lines. Prices always come from the order item snapshot, never the current
 * menu. Pure: the same orders always produce the same lines.
 */

export interface SnapshotAddon {
  groupName: string;
  addonName: string;
}

export interface SnapshotOrderItem {
  id: string;
  itemName: string;
  variantName: string | null;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  status: string;
  sortOrder: number;
  addons: SnapshotAddon[];
}

export interface SnapshotOrder {
  id: string;
  orderNumber: number;
  status: OrderStatus;
  items: SnapshotOrderItem[];
}

export interface BillLine {
  orderId: string;
  orderItemId: string;
  orderNumber: number;
  name: string;
  variantName: string | null;
  addonsSummary: string | null;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

export interface SessionOrderCounts {
  billableOrderCount: number;
  pendingOrderCount: number;
  activeOrderCount: number;
  /** Accepted but not served yet (in the kitchen). */
  inKitchenOrderCount: number;
}

export function isBillableOrder(status: OrderStatus): boolean {
  return BILLABLE_ORDER_STATUSES.includes(status);
}

export function addonsSummary(addons: readonly SnapshotAddon[]): string | null {
  if (addons.length === 0) return null;
  return addons.map((a) => a.addonName).join(", ");
}

export function buildBillLines(orders: readonly SnapshotOrder[]): BillLine[] {
  return [...orders]
    .filter((o) => isBillableOrder(o.status))
    .sort((a, b) => a.orderNumber - b.orderNumber)
    .flatMap((order) =>
      [...order.items]
        .filter((item) => item.status !== "CANCELLED")
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((item) => ({
          orderId: order.id,
          orderItemId: item.id,
          orderNumber: order.orderNumber,
          name: item.itemName,
          variantName: item.variantName,
          addonsSummary: addonsSummary(item.addons),
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          lineTotal: item.lineTotal,
        })),
    );
}

export function countSessionOrders(orders: readonly { status: OrderStatus }[]): SessionOrderCounts {
  return {
    billableOrderCount: orders.filter((o) => isBillableOrder(o.status)).length,
    pendingOrderCount: orders.filter((o) => o.status === "PENDING").length,
    activeOrderCount: orders.filter((o) => ACTIVE_ORDER_STATUSES.includes(o.status)).length,
    inKitchenOrderCount: orders.filter((o) => KITCHEN_STATUSES.includes(o.status)).length,
  };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Warnings shown with a bill preview. */
export function billWarnings(counts: SessionOrderCounts, lineCount: number): string[] {
  const warnings: string[] = [];
  if (counts.pendingOrderCount > 0) {
    warnings.push(
      `${plural(counts.pendingOrderCount, "order is", "orders are")} still pending approval and won't be billed. Pending orders also block closing the table.`,
    );
  }
  if (counts.inKitchenOrderCount > 0) {
    warnings.push(
      `${plural(counts.inKitchenOrderCount, "order is", "orders are")} still being prepared; ${counts.inKitchenOrderCount === 1 ? "it is" : "they are"} included in the bill.`,
    );
  }
  if (lineCount === 0) warnings.push("There is nothing to bill for this table yet.");
  return warnings;
}
