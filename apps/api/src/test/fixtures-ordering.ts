import {
  addonGroups,
  addons,
  diningTables,
  menuItems,
  menuVariants,
  tableQrTokens,
} from "@ros/database/providers/postgres/schema";
import type { Container } from "@/composition/container";
import { newQrToken } from "@ros/application/modules/tables/qr-tokens";

import {
  createWorkspaceAs,
  insertRestaurantWithBranch,
  signUpUser,
  type TestUser,
} from "./fixtures";

/** Direct-insert fixtures for the ordering module's integration tests. */

export async function insertMenuItem(
  c: Container,
  input: {
    workspaceId: string;
    restaurantId: string;
    categoryId: string;
    name: string;
    price: number;
    isAvailable?: boolean;
    dietary?: "VEG" | "NON_VEG" | "EGG" | "VEGAN";
    variants?: { name: string; price: number; isAvailable?: boolean }[];
    addonGroups?: {
      name: string;
      minSelect: number;
      maxSelect: number;
      addons: { name: string; price: number; isAvailable?: boolean }[];
    }[];
  },
): Promise<{ itemId: string; variantIds: string[]; groups: { id: string; addonIds: string[] }[] }> {
  const [item] = await c.db
    .insert(menuItems)
    .values({
      workspaceId: input.workspaceId,
      restaurantId: input.restaurantId,
      categoryId: input.categoryId,
      name: input.name,
      price: input.price,
      dietary: input.dietary ?? "VEG",
      isAvailable: input.isAvailable ?? true,
    })
    .returning({ id: menuItems.id });
  const itemId = item!.id;
  const variantIds: string[] = [];
  for (const [i, v] of (input.variants ?? []).entries()) {
    const [row] = await c.db
      .insert(menuVariants)
      .values({
        workspaceId: input.workspaceId,
        itemId,
        name: v.name,
        price: v.price,
        isAvailable: v.isAvailable ?? true,
        sortOrder: i,
      })
      .returning({ id: menuVariants.id });
    variantIds.push(row!.id);
  }
  const groups: { id: string; addonIds: string[] }[] = [];
  for (const g of input.addonGroups ?? []) {
    const [group] = await c.db
      .insert(addonGroups)
      .values({
        workspaceId: input.workspaceId,
        itemId,
        name: g.name,
        minSelect: g.minSelect,
        maxSelect: g.maxSelect,
      })
      .returning({ id: addonGroups.id });
    const addonIds: string[] = [];
    for (const [i, a] of g.addons.entries()) {
      const [row] = await c.db
        .insert(addons)
        .values({
          workspaceId: input.workspaceId,
          groupId: group!.id,
          name: a.name,
          price: a.price,
          isAvailable: a.isAvailable ?? true,
          sortOrder: i,
        })
        .returning({ id: addons.id });
      addonIds.push(row!.id);
    }
    groups.push({ id: group!.id, addonIds });
  }
  return { itemId, variantIds, groups };
}

export async function insertTableWithQr(
  c: Container,
  input: { workspaceId: string; restaurantId: string; branchId: string; name?: string },
): Promise<{ tableId: string; token: string }> {
  const [table] = await c.db
    .insert(diningTables)
    .values({
      workspaceId: input.workspaceId,
      restaurantId: input.restaurantId,
      branchId: input.branchId,
      name: input.name ?? `T${Math.floor(Math.random() * 1_000_000)}`,
    })
    .returning({ id: diningTables.id });
  const { token, tokenHash, tokenCiphertext } = await newQrToken(c.env.APP_SECRET);
  await c.db.insert(tableQrTokens).values({
    workspaceId: input.workspaceId,
    branchId: input.branchId,
    tableId: table!.id,
    tokenHash,
    tokenCiphertext,
  });
  return { tableId: table!.id, token };
}

export interface OrderingWorld {
  owner: TestUser;
  workspaceId: string;
  restaurantId: string;
  branchId: string;
  categoryId: string;
  table: { tableId: string; token: string };
  /** ₹250 paneer tikka, no options. */
  simpleItemId: string;
  /** Pizza: variants Regular ₹300 / Large ₹450; toppings group min 0 max 2 (₹50, ₹40, ₹30). */
  pizza: { itemId: string; variantIds: string[]; groupId: string; addonIds: string[] };
  /** Unavailable item. */
  soldOutItemId: string;
}

/** A workspace (trial, with QR ordering) with a branch, a small menu and one QR table. */
export async function createOrderingWorld(
  c: Container,
  name = "Ordering Owner",
): Promise<OrderingWorld> {
  const owner = await signUpUser(name);
  const ws = await createWorkspaceAs(owner, `${name} Workspace`);
  const { restaurantId, branchId, categoryId } = await insertRestaurantWithBranch(c, ws.id);
  const base = { workspaceId: ws.id, restaurantId, categoryId };
  const simple = await insertMenuItem(c, { ...base, name: "Paneer Tikka", price: 25_000 });
  const pizza = await insertMenuItem(c, {
    ...base,
    name: "Margherita Pizza",
    price: 30_000,
    variants: [
      { name: "Regular", price: 30_000 },
      { name: "Large", price: 45_000 },
    ],
    addonGroups: [
      {
        name: "Toppings",
        minSelect: 0,
        maxSelect: 2,
        addons: [
          { name: "Olives", price: 5_000 },
          { name: "Jalapeño", price: 4_000 },
          { name: "Extra cheese", price: 3_000 },
        ],
      },
    ],
  });
  const soldOut = await insertMenuItem(c, {
    ...base,
    name: "Seasonal Special",
    price: 40_000,
    isAvailable: false,
  });
  const table = await insertTableWithQr(c, { workspaceId: ws.id, restaurantId, branchId });
  return {
    owner,
    workspaceId: ws.id,
    restaurantId,
    branchId,
    categoryId,
    table,
    simpleItemId: simple.itemId,
    pizza: {
      itemId: pizza.itemId,
      variantIds: pizza.variantIds,
      groupId: pizza.groups[0]!.id,
      addonIds: pizza.groups[0]!.addonIds,
    },
    soldOutItemId: soldOut.itemId,
  };
}
