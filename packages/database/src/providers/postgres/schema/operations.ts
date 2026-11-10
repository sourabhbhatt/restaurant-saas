import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import type { TaxRate } from "@ros/domain/billing/bill-calculator";
import type { PaymentMethod } from "@ros/domain/billing/payments";
import type { Allergen, DietaryType } from "@ros/domain/menu/pricing";

import { bps, id, money, softDelete, timestamps, tstz, version } from "./_helpers";
import { users } from "./identity";
import { branches, restaurants, workspaces } from "./tenancy";

/** Operational settings per branch. One row per branch (created with the branch). */
export const branchSettings = pgTable("branch_settings", {
  branchId: uuid("branch_id")
    .primaryKey()
    .references(() => branches.id, { onDelete: "cascade" }),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  taxes: jsonb("taxes").$type<TaxRate[]>().notNull().default([]),
  pricesIncludeTax: boolean("prices_include_tax").notNull().default(false),
  serviceChargeBps: bps("service_charge_bps").notNull().default(0),
  paymentMethods: jsonb("payment_methods")
    .$type<PaymentMethod[]>()
    .notNull()
    .default(["CASH", "UPI", "CARD"]),
  /** Session can close only when the bill balance is zero. */
  requireFullPaymentToClose: boolean("require_full_payment_to_close").notNull().default(true),
  /** Mark served orders COMPLETED when the bill is fully paid. */
  autoCompleteOnPayment: boolean("auto_complete_on_payment").notNull().default(true),
  allowCustomerBillRequest: boolean("allow_customer_bill_request").notNull().default(true),
  acceptingOrders: boolean("accepting_orders").notNull().default(true),
  kitchenDelayMinutes: integer("kitchen_delay_minutes").notNull().default(20),
  kitchenSoundEnabled: boolean("kitchen_sound_enabled").notNull().default(true),
  waiterSoundEnabled: boolean("waiter_sound_enabled").notNull().default(true),
  receiptHeader: text("receipt_header"),
  receiptFooter: text("receipt_footer"),
  version: version(),
  ...timestamps,
});

/** Restaurant-wide presentation settings for the customer menu. */
export const restaurantSettings = pgTable("restaurant_settings", {
  restaurantId: uuid("restaurant_id")
    .primaryKey()
    .references(() => restaurants.id, { onDelete: "cascade" }),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  showPrepTime: boolean("show_prep_time").notNull().default(true),
  showAllergens: boolean("show_allergens").notNull().default(true),
  welcomeMessage: text("welcome_message"),
  version: version(),
  ...timestamps,
});

/** Monotonic per-branch counters (order numbers, bill numbers). */
export const branchCounters = pgTable(
  "branch_counters",
  {
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    value: integer("value").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.branchId, t.name] })],
);

// ---------------------------------------------------------------- Menu

export const menus = pgTable(
  "menus",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    restaurantId: uuid("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps,
    ...softDelete,
  },
  (t) => [index("menus_restaurant_idx").on(t.workspaceId, t.restaurantId)],
);

export const menuCategories = pgTable(
  "menu_categories",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    restaurantId: uuid("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "cascade" }),
    menuId: uuid("menu_id")
      .notNull()
      .references(() => menus.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    sortOrder: integer("sort_order").notNull().default(0),
    isVisible: boolean("is_visible").notNull().default(true),
    version: version(),
    ...timestamps,
    ...softDelete,
  },
  (t) => [index("menu_categories_menu_idx").on(t.workspaceId, t.menuId, t.sortOrder)],
);

export const menuItems = pgTable(
  "menu_items",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    restaurantId: uuid("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => menuCategories.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    description: text("description"),
    imageKey: text("image_key"),
    price: money("price").notNull(),
    discountedPrice: money("discounted_price"),
    dietary: text("dietary").$type<DietaryType>().notNull().default("VEG"),
    allergens: text("allergens")
      .array()
      .$type<Allergen[]>()
      .notNull()
      .default(sql`'{}'::text[]`),
    prepTimeMinutes: integer("prep_time_minutes").notNull().default(15),
    isAvailable: boolean("is_available").notNull().default(true),
    isFeatured: boolean("is_featured").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    version: version(),
    ...timestamps,
    ...softDelete,
  },
  (t) => [
    index("menu_items_category_idx").on(t.workspaceId, t.categoryId, t.sortOrder),
    index("menu_items_restaurant_idx").on(t.workspaceId, t.restaurantId),
    check(
      "menu_items_price_ck",
      sql`${t.price} >= 0 and (${t.discountedPrice} is null or ${t.discountedPrice} >= 0)`,
    ),
    check("menu_items_dietary_ck", sql`${t.dietary} in ('VEG', 'NON_VEG', 'EGG', 'VEGAN')`),
  ],
);

export const menuVariants = pgTable(
  "menu_variants",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    itemId: uuid("item_id")
      .notNull()
      .references(() => menuItems.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    price: money("price").notNull(),
    isDefault: boolean("is_default").notNull().default(false),
    isAvailable: boolean("is_available").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    ...timestamps,
    ...softDelete,
  },
  (t) => [
    index("menu_variants_item_idx").on(t.itemId),
    check("menu_variants_price_ck", sql`${t.price} >= 0`),
  ],
);

/** Customization group attached to one item (e.g. "Toppings", min 0 max 3). */
export const addonGroups = pgTable(
  "addon_groups",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    itemId: uuid("item_id")
      .notNull()
      .references(() => menuItems.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    minSelect: integer("min_select").notNull().default(0),
    maxSelect: integer("max_select").notNull().default(1),
    sortOrder: integer("sort_order").notNull().default(0),
    ...timestamps,
    ...softDelete,
  },
  (t) => [
    index("addon_groups_item_idx").on(t.itemId),
    check(
      "addon_groups_select_ck",
      sql`${t.minSelect} >= 0 and ${t.maxSelect} >= ${t.minSelect} and ${t.maxSelect} >= 1`,
    ),
  ],
);

export const addons = pgTable(
  "addons",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    groupId: uuid("group_id")
      .notNull()
      .references(() => addonGroups.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    price: money("price").notNull().default(0),
    isAvailable: boolean("is_available").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    ...timestamps,
    ...softDelete,
  },
  (t) => [index("addons_group_idx").on(t.groupId), check("addons_price_ck", sql`${t.price} >= 0`)],
);

/** Branch-specific price and availability. Null columns inherit the item value. */
export const menuItemBranchOverrides = pgTable(
  "menu_item_branch_overrides",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "cascade" }),
    itemId: uuid("item_id")
      .notNull()
      .references(() => menuItems.id, { onDelete: "cascade" }),
    price: money("price"),
    discountedPrice: money("discounted_price"),
    isAvailable: boolean("is_available"),
    ...timestamps,
  },
  (t) => [uniqueIndex("menu_item_branch_overrides_uq").on(t.branchId, t.itemId)],
);

// ---------------------------------------------------------------- Tables

export const diningTables = pgTable(
  "dining_tables",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    restaurantId: uuid("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    capacity: integer("capacity").notNull().default(4),
    section: text("section"),
    /** false = out of service (shown as CLOSED, QR cannot open sessions). */
    isActive: boolean("is_active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    version: version(),
    ...timestamps,
    ...softDelete,
  },
  (t) => [
    uniqueIndex("dining_tables_branch_name_uq")
      .on(t.branchId, t.name)
      .where(sql`${t.deletedAt} is null`),
    index("dining_tables_branch_idx").on(t.workspaceId, t.branchId),
    check("dining_tables_capacity_ck", sql`${t.capacity} between 1 and 100`),
  ],
);

export const tableQrTokens = pgTable(
  "table_qr_tokens",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "cascade" }),
    tableId: uuid("table_id")
      .notNull()
      .references(() => diningTables.id, { onDelete: "cascade" }),
    /** SHA-256 of the token in the QR URL; used for lookup. */
    tokenHash: text("token_hash").notNull(),
    /** AES-256-GCM encrypted token so authorized managers can re-download the QR. */
    tokenCiphertext: text("token_ciphertext").notNull(),
    status: text("status").$type<"ACTIVE" | "REVOKED">().notNull().default("ACTIVE"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: tstz("created_at").notNull().defaultNow(),
    revokedAt: tstz("revoked_at"),
    revokedBy: uuid("revoked_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [
    uniqueIndex("table_qr_tokens_hash_uq").on(t.tokenHash),
    uniqueIndex("table_qr_tokens_active_uq")
      .on(t.tableId)
      .where(sql`${t.status} = 'ACTIVE'`),
  ],
);

export const tableSessions = pgTable(
  "table_sessions",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    restaurantId: uuid("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "cascade" }),
    tableId: uuid("table_id")
      .notNull()
      .references(() => diningTables.id, { onDelete: "cascade" }),
    status: text("status")
      .$type<"OPEN" | "BILL_REQUESTED" | "BILLED" | "CLOSED">()
      .notNull()
      .default("OPEN"),
    openedAt: tstz("opened_at").notNull().defaultNow(),
    openedBy: uuid("opened_by").references(() => users.id, { onDelete: "set null" }),
    billRequestedAt: tstz("bill_requested_at"),
    closedAt: tstz("closed_at"),
    closedBy: uuid("closed_by").references(() => users.id, { onDelete: "set null" }),
    version: version(),
    ...timestamps,
  },
  (t) => [
    // At most one non-closed session per table: concurrent QR scans collapse to one.
    uniqueIndex("table_sessions_one_open_uq")
      .on(t.tableId)
      .where(sql`${t.status} <> 'CLOSED'`),
    index("table_sessions_branch_idx").on(t.workspaceId, t.branchId, t.status),
    check(
      "table_sessions_status_ck",
      sql`${t.status} in ('OPEN', 'BILL_REQUESTED', 'BILLED', 'CLOSED')`,
    ),
  ],
);

/** A guest device that joined a table session (anonymous; no personal data required). */
export const tableSessionMembers = pgTable(
  "table_session_members",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => tableSessions.id, { onDelete: "cascade" }),
    /** SHA-256 of the guest cookie token. */
    guestTokenHash: text("guest_token_hash").notNull(),
    displayName: text("display_name"),
    joinedAt: tstz("joined_at").notNull().defaultNow(),
    lastSeenAt: tstz("last_seen_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("table_session_members_token_uq").on(t.guestTokenHash),
    index("table_session_members_session_idx").on(t.sessionId),
  ],
);

// ---------------------------------------------------------------- Orders

export const orders = pgTable(
  "orders",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    restaurantId: uuid("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "cascade" }),
    tableId: uuid("table_id")
      .notNull()
      .references(() => diningTables.id),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => tableSessions.id),
    /** Guest who placed it (null when staff placed it). */
    memberId: uuid("member_id").references(() => tableSessionMembers.id, { onDelete: "set null" }),
    placedByUserId: uuid("placed_by_user_id").references(() => users.id, { onDelete: "set null" }),
    source: text("source").$type<"CUSTOMER" | "STAFF">().notNull(),
    orderNumber: integer("order_number").notNull(),
    status: text("status").notNull().default("PENDING"),
    priority: text("priority").notNull().default("NORMAL"),
    specialInstructions: text("special_instructions"),
    currency: text("currency").notNull(),
    subtotal: money("subtotal").notNull(),
    itemCount: integer("item_count").notNull(),
    /** Client-generated key; replays return the original order. */
    idempotencyKey: text("idempotency_key").notNull(),
    rejectionReason: text("rejection_reason"),
    cancellationReason: text("cancellation_reason"),
    acceptedBy: uuid("accepted_by").references(() => users.id, { onDelete: "set null" }),
    acceptedAt: tstz("accepted_at"),
    preparingAt: tstz("preparing_at"),
    readyAt: tstz("ready_at"),
    servedAt: tstz("served_at"),
    servedBy: uuid("served_by").references(() => users.id, { onDelete: "set null" }),
    completedAt: tstz("completed_at"),
    rejectedAt: tstz("rejected_at"),
    cancelledAt: tstz("cancelled_at"),
    version: version(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("orders_branch_number_uq").on(t.branchId, t.orderNumber),
    uniqueIndex("orders_branch_idempotency_uq").on(t.branchId, t.idempotencyKey),
    index("orders_branch_status_idx").on(t.workspaceId, t.branchId, t.status, t.createdAt),
    index("orders_session_idx").on(t.sessionId),
    index("orders_branch_created_idx").on(t.branchId, t.createdAt),
    // Kitchen "recently done" list (polled every few seconds): only orders that finished or were
    // cancelled recently are read, instead of scanning the branch's whole order history. Not
    // partial on purpose: Postgres ignores expression statistics of partial indexes, and without
    // them it estimates a third of the table and keeps the sequential scan.
    index("orders_branch_done_recent_idx").on(
      t.workspaceId,
      t.branchId,
      sql`coalesce(${t.servedAt}, ${t.completedAt}, ${t.updatedAt})`,
    ),
    index("orders_branch_cancelled_recent_idx")
      .on(t.workspaceId, t.branchId, t.cancelledAt)
      .where(sql`${t.status} = 'CANCELLED' and ${t.acceptedAt} is not null`),
    check(
      "orders_status_ck",
      sql`${t.status} in ('PENDING','ACCEPTED','PREPARING','READY','SERVED','COMPLETED','REJECTED','CANCELLED')`,
    ),
    check("orders_priority_ck", sql`${t.priority} in ('NORMAL','HIGH','RUSH')`),
  ],
);

/** Order lines with order-time snapshots of name, variant and price. */
export const orderItems = pgTable(
  "order_items",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    menuItemId: uuid("menu_item_id").references(() => menuItems.id, { onDelete: "set null" }),
    variantId: uuid("variant_id").references(() => menuVariants.id, { onDelete: "set null" }),
    categoryName: text("category_name"),
    itemName: text("item_name").notNull(),
    variantName: text("variant_name"),
    dietary: text("dietary").$type<DietaryType>(),
    baseUnitPrice: money("base_unit_price").notNull(),
    addonsUnitTotal: money("addons_unit_total").notNull().default(0),
    unitPrice: money("unit_price").notNull(),
    quantity: integer("quantity").notNull(),
    lineTotal: money("line_total").notNull(),
    notes: text("notes"),
    status: text("status").notNull().default("PENDING"),
    sortOrder: integer("sort_order").notNull().default(0),
    ...timestamps,
  },
  (t) => [
    index("order_items_order_idx").on(t.orderId),
    index("order_items_menu_item_idx").on(t.workspaceId, t.menuItemId),
    check("order_items_quantity_ck", sql`${t.quantity} between 1 and 99`),
  ],
);

export const orderItemAddons = pgTable(
  "order_item_addons",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    orderItemId: uuid("order_item_id")
      .notNull()
      .references(() => orderItems.id, { onDelete: "cascade" }),
    addonId: uuid("addon_id").references(() => addons.id, { onDelete: "set null" }),
    groupName: text("group_name").notNull(),
    addonName: text("addon_name").notNull(),
    price: money("price").notNull(),
  },
  (t) => [index("order_item_addons_item_idx").on(t.orderItemId)],
);

export const orderStatusHistory = pgTable(
  "order_status_history",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    fromStatus: text("from_status"),
    toStatus: text("to_status").notNull(),
    actorType: text("actor_type").$type<"USER" | "GUEST" | "SYSTEM">().notNull(),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    reason: text("reason"),
    createdAt: tstz("created_at").notNull().defaultNow(),
  },
  (t) => [index("order_status_history_order_idx").on(t.orderId, t.createdAt)],
);

// ---------------------------------------------------------------- Billing

export const bills = pgTable(
  "bills",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    restaurantId: uuid("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "cascade" }),
    tableId: uuid("table_id")
      .notNull()
      .references(() => diningTables.id),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => tableSessions.id),
    billNumber: integer("bill_number").notNull(),
    status: text("status").notNull().default("ISSUED"),
    paymentStatus: text("payment_status").notNull().default("UNPAID"),
    currency: text("currency").notNull(),
    subtotal: money("subtotal").notNull(),
    discountType: text("discount_type"),
    discountValue: integer("discount_value"),
    discountReason: text("discount_reason"),
    discountAmount: money("discount_amount").notNull().default(0),
    serviceChargeBps: bps("service_charge_bps").notNull().default(0),
    serviceChargeAmount: money("service_charge_amount").notNull().default(0),
    pricesIncludeTax: boolean("prices_include_tax").notNull(),
    /** Snapshot of tax lines at issue time: [{ name, rateBps, amount }]. */
    taxBreakdown: jsonb("tax_breakdown")
      .$type<{ name: string; rateBps: number; amount: number }[]>()
      .notNull(),
    taxTotal: money("tax_total").notNull(),
    grandTotal: money("grand_total").notNull(),
    amountPaid: money("amount_paid").notNull().default(0),
    amountRefunded: money("amount_refunded").notNull().default(0),
    balanceDue: money("balance_due").notNull(),
    issuedBy: uuid("issued_by").references(() => users.id, { onDelete: "set null" }),
    issuedAt: tstz("issued_at").notNull().defaultNow(),
    closedAt: tstz("closed_at"),
    voidedAt: tstz("voided_at"),
    voidedBy: uuid("voided_by").references(() => users.id, { onDelete: "set null" }),
    voidReason: text("void_reason"),
    version: version(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("bills_branch_number_uq").on(t.branchId, t.billNumber),
    // One live (non-void) bill per table session.
    uniqueIndex("bills_session_live_uq")
      .on(t.sessionId)
      .where(sql`${t.status} <> 'VOID'`),
    index("bills_branch_status_idx").on(t.workspaceId, t.branchId, t.paymentStatus, t.issuedAt),
    // Open bills of a branch (cashier queue, polled): stays small however many bills are closed.
    index("bills_branch_open_idx")
      .on(t.workspaceId, t.branchId, t.issuedAt)
      .where(sql`${t.status} = 'ISSUED'`),
    check("bills_status_ck", sql`${t.status} in ('ISSUED','CLOSED','VOID')`),
    check(
      "bills_payment_status_ck",
      sql`${t.paymentStatus} in ('UNPAID','PARTIALLY_PAID','PAID','REFUNDED')`,
    ),
    check(
      "bills_amounts_ck",
      sql`${t.grandTotal} >= 0 and ${t.balanceDue} >= 0 and ${t.amountPaid} >= 0`,
    ),
  ],
);

export const billItems = pgTable(
  "bill_items",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    billId: uuid("bill_id")
      .notNull()
      .references(() => bills.id, { onDelete: "cascade" }),
    orderId: uuid("order_id").references(() => orders.id, { onDelete: "set null" }),
    orderItemId: uuid("order_item_id").references(() => orderItems.id, { onDelete: "set null" }),
    orderNumber: integer("order_number"),
    name: text("name").notNull(),
    variantName: text("variant_name"),
    addonsSummary: text("addons_summary"),
    quantity: integer("quantity").notNull(),
    unitPrice: money("unit_price").notNull(),
    lineTotal: money("line_total").notNull(),
  },
  (t) => [index("bill_items_bill_idx").on(t.billId)],
);

/** Append-only payment ledger (payments and refunds). Voids keep the row. */
export const payments = pgTable(
  "payments",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "cascade" }),
    billId: uuid("bill_id")
      .notNull()
      .references(() => bills.id, { onDelete: "cascade" }),
    kind: text("kind").$type<"PAYMENT" | "REFUND">().notNull().default("PAYMENT"),
    method: text("method").$type<PaymentMethod>().notNull(),
    amount: money("amount").notNull(),
    /** Cash tendered (for change calculation); informational. */
    tendered: money("tendered"),
    reference: text("reference"),
    note: text("note"),
    status: text("status").$type<"CONFIRMED" | "VOIDED">().notNull().default("CONFIRMED"),
    idempotencyKey: text("idempotency_key").notNull(),
    recordedBy: uuid("recorded_by").references(() => users.id, { onDelete: "set null" }),
    voidedBy: uuid("voided_by").references(() => users.id, { onDelete: "set null" }),
    voidedAt: tstz("voided_at"),
    voidReason: text("void_reason"),
    createdAt: tstz("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("payments_branch_idempotency_uq").on(t.branchId, t.idempotencyKey),
    index("payments_bill_idx").on(t.billId),
    index("payments_branch_created_idx").on(t.workspaceId, t.branchId, t.createdAt),
    check("payments_amount_ck", sql`${t.amount} > 0`),
    check("payments_kind_ck", sql`${t.kind} in ('PAYMENT','REFUND')`),
    check("payments_method_ck", sql`${t.method} in ('CASH','UPI','CARD','OTHER')`),
  ],
);

/** Payment audit trail: every create/void with before/after balances. */
export const paymentHistory = pgTable(
  "payment_history",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    billId: uuid("bill_id")
      .notNull()
      .references(() => bills.id, { onDelete: "cascade" }),
    paymentId: uuid("payment_id").references(() => payments.id, { onDelete: "set null" }),
    action: text("action")
      .$type<"RECORDED" | "REFUNDED" | "VOIDED" | "BILL_ISSUED" | "BILL_VOIDED" | "BILL_CLOSED">()
      .notNull(),
    amount: money("amount"),
    balanceBefore: money("balance_before"),
    balanceAfter: money("balance_after"),
    paymentStatusAfter: text("payment_status_after"),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: tstz("created_at").notNull().defaultNow(),
  },
  (t) => [index("payment_history_bill_idx").on(t.billId, t.createdAt)],
);

/** Uploaded files (menu images, logos) tracked for storage limits and cleanup. */
export const storedFiles = pgTable(
  "stored_files",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    purpose: text("purpose").notNull(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: tstz("created_at").notNull().defaultNow(),
    deletedAt: tstz("deleted_at"),
  },
  (t) => [
    uniqueIndex("stored_files_key_uq").on(t.key),
    index("stored_files_workspace_idx").on(t.workspaceId),
  ],
);
